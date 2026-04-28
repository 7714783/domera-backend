# Module RFC — `notifications`

## 1. Why this module exists

INIT-014 — Unified Notifications + Mailer.

Before this module, every domain service that wanted to alert someone reached for its own email/in-app side door (or didn't notify at all). That violates SSOT (multiple writers to a "notification" concept) and creates compliance risk: there's no single audit trail for "who got told what when".

`notifications` is the sole owner of the delivery contract. Domain modules publish events; this module subscribes via the OutboxRegistry, looks up rules, resolves recipients, renders templates, dispatches across channels (in-app / push / email), and writes a journal row per attempt with retry + dead-letter semantics.

## 2. Scope and non-scope

### In scope
- `NotificationRule` catalogue (system + tenant-custom).
- `NotificationTemplate` catalogue (Handlebars subset, multi-locale).
- `NotificationDelivery` per-attempt journal with retry/backoff/dead-letter.
- `NotificationPreference` per-recipient mute/opt-out (per template OR category, per channel).
- Mailer adapter with three providers: noop (dev), SMTP, SES.
- Outbox subscriber on canonical events (assigned, requested, decided, escalated, etc.).
- Inbound email webhook (`/v1/mail/inbound/:provider`) with signature verification + attachment-to-Document linking via `[case:<id>]` subject tag.
- Email suppression list (hard bounces, complaints, manual unsubscribe).
- In-app inbox surface (`/v1/notifications`) — read-only feed for the calling user.
- Push device alias (`/v1/notifications/devices`) — mobile-app-friendly path; underlying `Device` table stays owned by `devices` module.

### Out of scope
- The push provider integration (Expo / FCM) — wired as a stub; production wires the actual push call in a follow-up.
- Approve-by-email-reply for money: explicitly forbidden. Approval emails ALWAYS contain a secure link; reply-with-attachment only works for document-requests.
- IMAP polling. We only accept inbound via signed provider webhooks.
- BullMQ / Redis queue. Current worker is in-process polling; ready to swap.

## 3. Owned entities

| Model | Table | Notes |
|---|---|---|
| `Notification` | `notifications` | legacy in-app inbox; kept for backwards compat |
| `NotificationRule` | `notification_rules` | system rows tenantId IS NULL; tenant-custom override |
| `NotificationTemplate` | `notification_templates` | Handlebars-style; tenant override per (key, channel, locale) |
| `NotificationDelivery` | `notification_deliveries` | per-attempt journal; dedupKey unique |
| `NotificationPreference` | `notification_preferences` | mute/opt-out; tenant-scoped, RLS |
| `EmailInboundEvent` | `email_inbound_events` | raw payload + linkage; signature audit-trail |
| `EmailSuppression` | `email_suppressions` | hard bounces / complaints; tenant + global |

## 4. Tenant scope

Tenant-scoped + RLS: `notification_deliveries`, `notification_preferences`, `email_inbound_events`, `email_suppressions`. RLS policies in migration 020.

Mixed (system + tenant rows, no RLS): `notification_rules`, `notification_templates`. Like `roles` — application layer guards writes (RolesService analogue).

## 5. Events

### Subscribed (consumer)
`ppm.task.assigned · task.assigned · task.due_soon · incident.assigned · incident.created · service_request.assigned · approval.request.pending · approval.requested · approval.decided · approval.escalated · document.requested · document.uploaded · invoice.awaiting_confirmation · invoice.confirmed · role.assigned · role.revoked · team_member.created · cleaning.assigned · cleaning.completed`

### Published (producer)
`notification.delivered` (audit event, sensitive=true for finance/security templates)
`notification.failed` (after dead-letter)
`email.inbound.received` (every webhook hit, signed or not)

## 6. Permissions

- `notifications.read_inbox` — all authenticated users (their own).
- `notifications.manage_rules` — workspace_owner, workspace_admin.
- `notifications.manage_templates` — workspace_owner, workspace_admin.
- `notifications.send_test` — workspace_owner, workspace_admin.
- `notifications.read_journal` — workspace_owner, workspace_admin, auditor.

Inbound webhook is unauthenticated by JWT — gated by provider signature + per-tenant `INBOUND_EMAIL_SECRET` (header `x-domera-inbound-key`).

## 7. Surface

- `GET    /v1/notifications` — in-app inbox for the caller
- `POST   /v1/notifications/:id/read`
- `POST   /v1/notifications/devices` (alias for /v1/devices)
- `DELETE /v1/notifications/devices/:id`
- `POST   /v1/notifications/test-email`
- `GET    /v1/notifications/deliveries?status=&channel=`
- `GET    /v1/notifications/rules`
- `GET    /v1/notifications/templates`
- `GET    /v1/notifications/preferences?teamMemberId=`
- `POST   /v1/notifications/preferences` (upsert one)
- `POST   /v1/mail/inbound/:provider` (webhook — signature gated)

Internal service API: `NotificationsService.dispatchEvent(event, mailer)` is called by the OutboxRegistry handler. The dispatcher worker calls `processPending(mailer, batchSize)` every 5s.

## 8. Configuration (env)

| Var | Purpose | Default |
|---|---|---|
| `EMAIL_PROVIDER` | `noop` / **`resend`** (default prod) / `smtp` / `ses` | `noop` |
| `EMAIL_FROM` | From address | `notifications@domerahub.com` |
| `RESEND_API_KEY` | Resend API key (`re_…`) — required when provider=resend | — |
| `RESEND_WEBHOOK_SECRET` | svix-style secret (`whsec_…`) for inbound signature | — |
| `SMTP_HOST/PORT/USER/PASS/SECURE` | SMTP transport | — |
| `AWS_REGION/AWS_SES_FROM_ARN` | SES transport | — |
| `INBOUND_EMAIL_SECRET` | Shared secret fallback for SMTP relay inbound | — |
| `NOTIFY_POLL_INTERVAL_MS` | Worker tick | `5000` |
| `NOTIFY_BATCH_SIZE` | Rows per tick | `25` |
| `NOTIFY_DISABLE` | `1` to disable worker entirely (tests) | unset |

`assertProdEnv()` rejects production boots with:
- **HARD**: `EMAIL_PROVIDER=resend` AND `RESEND_API_KEY` unset (every send would fail).
- **SOFT** (escalatable): `EMAIL_PROVIDER=noop` in prod; `RESEND_WEBHOOK_SECRET` unset (inbound svix verification disabled); `EMAIL_FROM` unset.

### Resend setup
1. Resend dashboard → API Keys → create with `Full access` for sending. Stamp on Railway/Vercel as `RESEND_API_KEY` (`re_…`).
2. Resend dashboard → Webhooks → add endpoint `https://<api-host>/v1/mail/inbound/resend` → enable `email.received` (and `email.bounced` / `email.complained` for the suppression flow). Copy the signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.
3. Domain → verify SPF/DKIM/DMARC records Resend prints. Set `EMAIL_FROM` to a verified domain address (e.g. `notifications@<your-domain>`).
4. For inbound replies you want routed to a case → forward `inbound+<workspaceSlug>@<your-domain>` to Resend's inbound parser; the controller resolves tenant by the local-part of the To: address.

Switching providers is one env change — no code edits.

## 9. Hard rules

1. Domain modules NEVER write to `notification_*` tables. They publish events.
2. Approve-by-email-reply is forbidden. Approval emails contain a secure link only.
3. Inbound email signature verification is mandatory; failure path stores the payload but rejects with 401.
4. Cross-tenant attachment linkage is impossible — the parser validates the linked entity belongs to the same tenant resolved from the To: address.
5. Email suppression list is consulted BEFORE every email delivery row creation.
6. Every successful email write writes an `audit.write` row with `action='email.sent'`.

## 10. Test gates added

- `notification-contract.test.mjs` — every system rule references an existing template; every template's `variables[]` matches its body's placeholders.
- `mailer-routing.test.mjs` — for each subscribed event, a system rule exists with at least one channel.
- `inbound-email-security.test.mjs` — controller path requires signature verification; service stores raw payload even on reject.
