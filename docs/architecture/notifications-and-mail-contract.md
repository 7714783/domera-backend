# Notifications & Mail Contract (INIT-014)

> Active. Effective 2026-04-28. Source of truth for the unified delivery channel.

## 1. Mental model

Single pipeline:

```
Domain event (outbox)
       ↓
NotificationRule match  (eventType + isActive + tenantScope)
       ↓
RecipientResolver       (assignee | role | manual)
       ↓
NotificationDelivery    (one row per channel × recipient)
       ↓
Channel adapter         (mailer | inapp inbox | push devices)
       ↓
Status update + audit   (sent | failed → dead-letter)
```

**Rule of thumb:** If a domain module wants someone alerted, it publishes an event. It does NOT call the mailer, write to the inbox table, or invoke push. Notifications module owns the channel.

## 2. Owned entities

| Model | Table | Owner | Notes |
|---|---|---|---|
| `Notification` | `notifications` | notifications | Legacy in-app inbox (kept for FE compat). |
| `NotificationRule` | `notification_rules` | notifications | System (tenantId IS NULL) + tenant-custom. No RLS — application gate. |
| `NotificationTemplate` | `notification_templates` | notifications | Handlebars subset, multi-locale. |
| `NotificationDelivery` | `notification_deliveries` | notifications | Per-attempt journal. RLS-scoped. |
| `NotificationPreference` | `notification_preferences` | notifications | Per-recipient mute. RLS-scoped. |
| `EmailInboundEvent` | `email_inbound_events` | notifications | Raw + parsed inbound payloads. RLS-scoped. |
| `EmailSuppression` | `email_suppressions` | notifications | Hard bounces + complaints + unsubscribes. RLS-scoped (with global rows). |

`ssot-ownership.test.mjs` enforces all of the above.

## 3. Event catalogue (subscribed)

| Event | Producer | Default rule action |
|---|---|---|
| `ppm.task.assigned` | ppm | email + inapp + push to assignee |
| `task.assigned` | tasks/ppm | same as above |
| `task.due_soon` | ppm | email reminder to assignee |
| `incident.assigned` | reactive | push + inapp + email (high priority) |
| `incident.created` | reactive | inapp to triage role |
| `service_request.assigned` | reactive | email + inapp |
| `approval.request.pending` | approvals | email + inapp to approver role; SLA 4h escalation |
| `approval.requested` | approvals | alias of above |
| `approval.decided` | approvals | email to requester |
| `approval.escalated` | approvals | email to escalation role |
| `document.requested` | documents | email to manual recipient (contractor); reply with attachment is parsed by inbound |
| `document.uploaded` | documents | inapp to requester |
| `invoice.awaiting_confirmation` | vendor-invoices | email + inapp to finance role; SLA 8h escalation |
| `invoice.confirmed` | vendor-invoices | inapp to requester |
| `role.assigned` | role-assignments | email + inapp to assignee |
| `role.revoked` | role-assignments | inapp to assignee |
| `team_member.created` | team | inapp to creator |
| `cleaning.assigned` | cleaning | email + inapp to assignee |
| `cleaning.completed` | cleaning | inapp to requester |

## 4. Hard rules

1. **No direct cross-module writes** to any notification table. Domain modules publish events; the notifications subscriber creates deliveries.
2. **No approve-by-email-reply** for money. Approval emails contain a secure link only (login + MFA required). The `mailer-routing.test.mjs` gate forbids approval templates that say "reply to approve".
3. **Inbound webhook signature is mandatory.** `/v1/mail/inbound/:provider` calls `MailerAdapter.verifyInboundSignature(headers, rawBody)`. On failure: row stored with `signatureValid=false`, controller returns 401.
4. **Cross-tenant attachment linkage is impossible.** `EmailInboundEvent.tenantId` is resolved from the To: address (`inbound+<slug>@…`), and `linkedEntityExists` validates the linked case belongs to that tenant.
5. **Email suppression list is consulted BEFORE every email delivery row creation.** Hard bounces + complaints never fire twice.
6. **Idempotency: every delivery row has `dedupKey = "<eventId>:<recipient>:<channel>"`.** Replays of the same outbox event create at most one delivery per (recipient, channel).
7. **Audit-stamped:** every successful email writes `audit.write` with `action='email.sent'`, sensitive=true for finance/security templates.
8. **Worker is in-process (v1).** Polls `notification_deliveries` every 5s, batch 25, retries with exponential backoff up to 5 attempts. Dead-lettered rows (`status='failed'`) emit `notification.failed` event for ops dashboards.

## 5. Provider adapters

Selected at boot via `EMAIL_PROVIDER`:

| Value | Adapter | Use |
|---|---|---|
| `noop` | `NoopMailer` | Dev / CI — logs only, never sends. Default. |
| **`resend`** | **`ResendMailer`** | **Production default.** REST API + svix-signed webhooks. Requires `RESEND_API_KEY` (`re_…`) and `RESEND_WEBHOOK_SECRET` (`whsec_…`). Zero SDK — uses Node 20 global fetch. |
| `smtp` | `SmtpMailer` | Generic SMTP (postfix relay, Mailgun SMTP, etc.). Requires `SMTP_HOST/PORT/USER/PASS`. nodemailer is an optional dep. |
| `ses` | `SesMailer` | AWS SES. Requires `AWS_REGION` + (optional) `AWS_SES_FROM_ARN`. SDK is an optional dep — if absent, falls back to no-op with a warning. |

Switching providers is a one-line env change. Domain modules never see the provider type.

### Resend specifics

- **Outbound**: `POST https://api.resend.com/emails` with Bearer auth. The Resend message id (`re_…`) is stored in `notification_deliveries.providerMessageId`.
- **Inbound + status webhooks**: Resend signs every payload via svix. Headers `svix-id`, `svix-timestamp`, `svix-signature` are verified against `RESEND_WEBHOOK_SECRET`:
  1. `payload = ${svix-id}.${svix-timestamp}.${rawBody}`.
  2. `expected = base64( HMAC-SHA256( decode_base64(secret), payload ) )`.
  3. `svix-signature` is a space-separated list of `v1,<base64>` candidates — any constant-time match wins.
  4. Replays older than 5 minutes are rejected (svix default tolerance).
- **Raw body capture**: Nest is bootstrapped with `rawBody: true` in `main.ts`, so `req.rawBody` carries the original byte sequence the proxy received. Re-stringifying via `JSON.stringify` would change key order / whitespace and BREAK the signature — the controller passes `req.rawBody.toString('utf8')` to the verifier.
- **Inbound envelope**: Resend wraps incoming mail as `{ type: 'email.received', data: {...} }`. The controller unwraps the `data` field for normalisation; subject, body, attachments are read from `data.*`.
- **Tenant routing**: convention `inbound+<workspaceSlug>@<your-domain>` resolves to `tenantId` in `EmailInboundEvent`. Set up Resend's inbound endpoint to forward replies; the local-part decides the workspace.
- **Bounce/complaint hook**: Resend emits `email.bounced` and `email.complained` events through the same webhook. Phase 2 wires them to `EmailSuppression` writes; today they land as raw `EmailInboundEvent` rows for forensics.

## 6. Inbound flow

1. Provider POSTs to `/v1/mail/inbound/:provider` (e.g. `/v1/mail/inbound/ses`).
2. Controller stores raw payload + verifies signature via the matching adapter.
3. Service writes `EmailInboundEvent` with the parsed shape (from / to / subject / body / attachment count).
4. Subject is parsed for `[case:<id>]` / `[approval:<id>]` / `[work_order:<id>]` / `[cleaning_request:<id>]`. If found and `linkedEntityExists` confirms tenant match, `linkedKind/linkedId` are set, status='linked'.
5. Attachments > 25MB → `status='virus_blocked'` (size proxy until provider-side AV is wired).
6. Documents are saved through the documents module (separate write path) — NOT directly from the notifications service. This keeps SSOT: documents owns its own table.

## 7. UI surface

- `/admin/notifications` — 4 tabs:
  - Deliveries (journal with filters)
  - Rules (catalogue, read-only v1)
  - Templates (catalogue, read-only v1; grouped by category)
  - Test email (form → POST `/v1/notifications/test-email`)
- `/admin/team/[id]` — per-member preferences section (mute per template + channel) — phase 2.
- Custom rules / templates editor — phase 2.

## 8. Configuration matrix

Required in production (`assertProdEnv` flags violations):

| Var | Severity | Notes |
|---|---|---|
| `EMAIL_PROVIDER` | soft | `noop` in prod is a soft warning — emails won't send. Set to `smtp` or `ses`. |
| `EMAIL_FROM` | soft | unset → defaults to `notifications@domerahub.com`. Set per workspace domain. |
| `SMTP_HOST` | soft | required when `EMAIL_PROVIDER=smtp`. |
| `INBOUND_EMAIL_SECRET` | soft | required when not using SES (which has SNS-signed messages). |
| `NOTIFY_POLL_INTERVAL_MS` | — | default 5000. |
| `NOTIFY_BATCH_SIZE` | — | default 25. |
| `NOTIFY_DISABLE` | — | `1` disables the worker (CI / migration windows). |

## 9. Test gates

| Gate | What it defends |
|---|---|
| `notification-contract.test.mjs` | Every system rule references an existing template; template variables match placeholders in body. |
| `mailer-routing.test.mjs` | High-stakes events (assigned/requested/decided) all have rules; no approve-by-reply phrasing. |
| `inbound-email-security.test.mjs` | Service stores raw payload before accepting; cross-tenant linkage refused; controller throws 401 on bad signature. |
| `event-contract.test.mjs` | INIT-014 events appear in the catalogue with proper producer/consumers/payloadShape. |
| `ssot-ownership.test.mjs` | Only notifications module writes to notification_*. PPM in-app inbox dual-write listed transitionally. |
| `module-boundaries.test.mjs` | `notifications` is in UNIVERSAL set (@Global) so any module can call the dispatcher. |

## 10. Phase 2 (out of scope here)

- Custom rule + template CRUD UI with safe HTML sanitisation.
- Real Expo / FCM push integration.
- SES bounce-handler webhook with SNS signature verification.
- Per-category preference UI on team member detail.
- Multi-locale (RU/HE) seeded templates.
- Unsubscribe link in footer (CAN-SPAM compliance).
- BullMQ + Redis as the queue backend (replaces in-process polling).
- Scheduled emails (cron — PPM "due in 7d" reminders).
- Digest mode (batch low-priority alerts every N hours).
