-- 020_notifications_unified.sql
--
-- INIT-014 — Unified Notifications + Mailer foundation.
--
-- Tables:
--   notification_rules        — declarative trigger contract
--   notification_templates    — Handlebars subject + body
--   notification_deliveries   — per-attempt journal across channels
--   notification_preferences  — per-recipient opt-outs
--   email_inbound_events      — raw webhook payloads + parsed shape
--   email_suppressions        — hard bounces / complaints / unsubscribes
--
-- Tenant-scoped tables get RLS + tenant_isolation policy. The two
-- "catalogue" tables (notification_rules and notification_templates)
-- mix system rows (tenantId IS NULL) with tenant rows; like the `roles`
-- table, RLS would hide the system rows from every tenant — so we keep
-- them OUT of RLS and gate writes at the application layer.
--
-- Idempotent.

-- ── notification_rules ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_rules" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT,
  "isCustom"            BOOLEAN NOT NULL DEFAULT FALSE,
  "name"                TEXT NOT NULL,
  "description"         TEXT,
  "eventType"           TEXT NOT NULL,
  "channels"            TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "templateKey"         TEXT,
  "recipientStrategy"   TEXT NOT NULL DEFAULT 'assignee',
  "roleKey"             TEXT,
  "buildingScope"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "priority"            TEXT NOT NULL DEFAULT 'normal',
  "slaSeconds"          INTEGER,
  "escalateToRoleKey"   TEXT,
  "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "notification_rules_tenant_event_idx"
  ON "notification_rules" ("tenantId", "eventType", "isActive");

-- ── notification_templates ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_templates" (
  "id"          TEXT PRIMARY KEY,
  "tenantId"    TEXT,
  "isCustom"    BOOLEAN NOT NULL DEFAULT FALSE,
  "key"         TEXT NOT NULL,
  "channel"     TEXT NOT NULL,
  "locale"      TEXT NOT NULL DEFAULT 'en',
  "subject"     TEXT,
  "bodyHtml"    TEXT,
  "bodyText"    TEXT,
  "variables"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "category"    TEXT NOT NULL DEFAULT 'platform',
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_templates_unique"
  ON "notification_templates" ("tenantId", "key", "channel", "locale");
CREATE INDEX IF NOT EXISTS "notification_templates_lookup_idx"
  ON "notification_templates" ("key", "channel", "locale");

-- ── notification_deliveries ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id"                TEXT PRIMARY KEY,
  "tenantId"          TEXT NOT NULL,
  "ruleId"            TEXT,
  "templateKey"       TEXT,
  "eventId"           TEXT,
  "eventType"         TEXT,
  "channel"           TEXT NOT NULL,
  "recipientType"     TEXT NOT NULL,
  "recipientId"       TEXT,
  "recipientAddress"  TEXT,
  "subjectSnapshot"   TEXT,
  "bodySnapshot"      TEXT,
  "payloadSnapshot"   JSONB,
  "priority"          TEXT NOT NULL DEFAULT 'normal',
  "status"            TEXT NOT NULL DEFAULT 'pending',
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "maxAttempts"       INTEGER NOT NULL DEFAULT 5,
  "lastError"         TEXT,
  "providerMessageId" TEXT,
  "scheduledAt"       TIMESTAMP(3) NOT NULL DEFAULT now(),
  "sentAt"            TIMESTAMP(3),
  "acknowledgedAt"    TIMESTAMP(3),
  "dedupKey"          TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_dedup"
  ON "notification_deliveries" ("dedupKey") WHERE "dedupKey" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "notification_deliveries_pending_idx"
  ON "notification_deliveries" ("tenantId", "status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "notification_deliveries_channel_idx"
  ON "notification_deliveries" ("tenantId", "channel", "status");
CREATE INDEX IF NOT EXISTS "notification_deliveries_event_idx"
  ON "notification_deliveries" ("eventId");

-- ── notification_preferences ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT NOT NULL,
  "teamMemberId" TEXT NOT NULL,
  "scope"        TEXT NOT NULL,
  "scopeKey"     TEXT NOT NULL,
  "channel"      TEXT NOT NULL,
  "muted"        BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT now(),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_unique"
  ON "notification_preferences" ("teamMemberId", "scope", "scopeKey", "channel");
CREATE INDEX IF NOT EXISTS "notification_preferences_tenant_idx"
  ON "notification_preferences" ("tenantId", "teamMemberId");

-- ── email_inbound_events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_inbound_events" (
  "id"               TEXT PRIMARY KEY,
  "tenantId"         TEXT,
  "provider"         TEXT NOT NULL,
  "providerEventId"  TEXT,
  "signatureValid"   BOOLEAN NOT NULL DEFAULT FALSE,
  "fromAddress"      TEXT NOT NULL,
  "toAddress"        TEXT NOT NULL,
  "subject"          TEXT,
  "bodyText"         TEXT,
  "bodyHtml"         TEXT,
  "rawPayload"       JSONB NOT NULL,
  "attachmentCount"  INTEGER NOT NULL DEFAULT 0,
  "linkedKind"       TEXT,
  "linkedId"         TEXT,
  "status"           TEXT NOT NULL DEFAULT 'received',
  "error"            TEXT,
  "receivedAt"       TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "email_inbound_events_provider_event_idx"
  ON "email_inbound_events" ("providerEventId");
CREATE INDEX IF NOT EXISTS "email_inbound_events_tenant_status_idx"
  ON "email_inbound_events" ("tenantId", "status", "receivedAt");

-- ── email_suppressions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "email_suppressions" (
  "id"           TEXT PRIMARY KEY,
  "tenantId"     TEXT,
  "emailAddress" TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "source"       TEXT,
  "metadata"     JSONB,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_suppressions_unique"
  ON "email_suppressions" ("tenantId", "emailAddress");
CREATE INDEX IF NOT EXISTS "email_suppressions_address_idx"
  ON "email_suppressions" ("emailAddress");

-- ── RLS for tenant-scoped tables ──────────────────────────────────────
ALTER TABLE "notification_deliveries"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_deliveries"   FORCE  ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_preferences"  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "email_inbound_events"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_inbound_events"      FORCE  ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_suppressions"        FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "notification_deliveries";
CREATE POLICY tenant_isolation ON "notification_deliveries"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "notification_preferences";
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING ("tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "email_inbound_events";
CREATE POLICY tenant_isolation ON "email_inbound_events"
  USING ("tenantId" IS NULL OR "tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId"::text = current_setting('app.current_tenant_id', true));

DROP POLICY IF EXISTS tenant_isolation ON "email_suppressions";
CREATE POLICY tenant_isolation ON "email_suppressions"
  USING ("tenantId" IS NULL OR "tenantId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("tenantId" IS NULL OR "tenantId"::text = current_setting('app.current_tenant_id', true));

-- notification_rules / notification_templates intentionally NOT
-- RLS-protected — they mix system (tenantId IS NULL) and tenant rows.
-- See parallel exemption for `roles` in 019_team_rls_force.sql.

-- ── Seed system templates + rules ─────────────────────────────────────
-- 8 starter templates (email channel, en locale). Tenants can clone any
-- of these as a custom template; system rows are immutable from the API.

INSERT INTO "notification_templates" ("id", "tenantId", "isCustom", "key", "channel", "locale", "subject", "bodyText", "bodyHtml", "variables", "category", "description")
VALUES
  (gen_random_uuid()::text, NULL, FALSE, 'task.assigned', 'email', 'en',
    'Task assigned: {{taskTitle}}',
    'Hi {{recipientName}},\n\nA task has been assigned to you in {{buildingName}}:\n\n{{taskTitle}}\nDue: {{dueAt}}\n\nOpen: {{taskUrl}}\n\n— Domera',
    '<p>Hi {{recipientName}},</p><p>A task has been assigned to you in <b>{{buildingName}}</b>:</p><p><b>{{taskTitle}}</b><br/>Due: {{dueAt}}</p><p><a href="{{taskUrl}}">Open task</a></p>',
    ARRAY['recipientName','taskTitle','buildingName','dueAt','taskUrl'],
    'tech_support',
    'Sent to the assigned technician when a PPM/cleaning task lands on them.'),
  (gen_random_uuid()::text, NULL, FALSE, 'task.due_soon', 'email', 'en',
    'Task due soon: {{taskTitle}}',
    'Hi {{recipientName}},\n\nReminder — task "{{taskTitle}}" is due {{dueAt}}.\n\nOpen: {{taskUrl}}',
    '<p>Hi {{recipientName}},</p><p>Reminder — task <b>{{taskTitle}}</b> is due {{dueAt}}.</p><p><a href="{{taskUrl}}">Open task</a></p>',
    ARRAY['recipientName','taskTitle','dueAt','taskUrl'],
    'tech_support', NULL),
  (gen_random_uuid()::text, NULL, FALSE, 'incident.assigned', 'email', 'en',
    'Incident assigned: {{incidentTitle}}',
    '{{recipientName}}, an incident requires your attention in {{buildingName}}: {{incidentTitle}}. Open: {{incidentUrl}}',
    '<p>{{recipientName}}, an incident requires your attention in <b>{{buildingName}}</b>:</p><p><b>{{incidentTitle}}</b></p><p><a href="{{incidentUrl}}">Open incident</a></p>',
    ARRAY['recipientName','incidentTitle','buildingName','incidentUrl'],
    'security', NULL),
  (gen_random_uuid()::text, NULL, FALSE, 'approval.requested', 'email', 'en',
    'Approval requested: {{approvalTitle}} ({{amount}})',
    '{{recipientName}}, please review and approve: {{approvalTitle}}\nAmount: {{amount}}\nRequester: {{requesterName}}\n\nSecure link (login + MFA required): {{approvalUrl}}',
    '<p>{{recipientName}}, please review and approve: <b>{{approvalTitle}}</b></p><p>Amount: {{amount}}<br/>Requester: {{requesterName}}</p><p><a href="{{approvalUrl}}">Open in Domera</a> (login + MFA required)</p>',
    ARRAY['recipientName','approvalTitle','amount','requesterName','approvalUrl'],
    'finance',
    'Sent to approvers. Always uses a secure link — never approve-by-reply.'),
  (gen_random_uuid()::text, NULL, FALSE, 'approval.decided', 'email', 'en',
    'Approval {{decision}}: {{approvalTitle}}',
    '{{recipientName}}, your approval request "{{approvalTitle}}" was {{decision}} by {{deciderName}}. Reason: {{reason}}',
    '<p>{{recipientName}}, your approval request <b>{{approvalTitle}}</b> was <b>{{decision}}</b> by {{deciderName}}.</p><p>Reason: {{reason}}</p>',
    ARRAY['recipientName','approvalTitle','decision','deciderName','reason'],
    'finance', NULL),
  (gen_random_uuid()::text, NULL, FALSE, 'role.assigned', 'email', 'en',
    'You have a new role in {{workspaceName}}: {{roleName}}',
    '{{recipientName}}, you were granted the role "{{roleName}}" in {{workspaceName}} by {{delegatorName}}. Open: {{workspaceUrl}}',
    '<p>{{recipientName}}, you were granted the role <b>{{roleName}}</b> in {{workspaceName}} by {{delegatorName}}.</p><p><a href="{{workspaceUrl}}">Open workspace</a></p>',
    ARRAY['recipientName','roleName','workspaceName','delegatorName','workspaceUrl'],
    'people', NULL),
  (gen_random_uuid()::text, NULL, FALSE, 'document.requested', 'email', 'en',
    'Document requested: {{documentType}}',
    '{{recipientName}}, please send the following document for {{contextLabel}}: {{documentType}}.\nReply to this email and attach the file — it will be saved automatically.',
    '<p>{{recipientName}}, please send the following document for <b>{{contextLabel}}</b>:</p><p><b>{{documentType}}</b></p><p>Reply to this email and attach the file — it will be saved automatically and linked to the case.</p>',
    ARRAY['recipientName','documentType','contextLabel'],
    'legal',
    'Sent to a contractor when a case needs evidence/cert. Reply with attachment is parsed by inbound webhook.'),
  (gen_random_uuid()::text, NULL, FALSE, 'invoice.awaiting_confirmation', 'email', 'en',
    'Invoice awaiting confirmation: {{invoiceNumber}}',
    '{{recipientName}}, invoice {{invoiceNumber}} for {{amount}} from {{vendorName}} is waiting for your confirmation. Secure link (login + MFA): {{invoiceUrl}}',
    '<p>{{recipientName}}, invoice <b>{{invoiceNumber}}</b> for <b>{{amount}}</b> from {{vendorName}} is waiting for your confirmation.</p><p><a href="{{invoiceUrl}}">Open in Domera</a> (login + MFA required)</p>',
    ARRAY['recipientName','invoiceNumber','amount','vendorName','invoiceUrl'],
    'finance', NULL)
ON CONFLICT DO NOTHING;

-- ── Seed system rules ────────────────────────────────────────────────
-- Each rule wires a canonical event to a template + channel set + the
-- recipient resolution strategy. Tenants override by cloning.

INSERT INTO "notification_rules" ("id", "tenantId", "isCustom", "name", "description", "eventType", "channels", "templateKey", "recipientStrategy", "priority", "slaSeconds", "isActive")
VALUES
  (gen_random_uuid()::text, NULL, FALSE, 'PPM task assigned',
    'Notify the technician + manager via email + in-app + push when a PPM task lands.',
    'ppm.task.assigned', ARRAY['email','inapp','push'],
    'task.assigned', 'assignee', 'normal', NULL, TRUE),
  (gen_random_uuid()::text, NULL, FALSE, 'Approval requested',
    'Email approvers with a secure link; SLA escalation to building manager after 4h.',
    'approval.request.pending', ARRAY['email','inapp'],
    'approval.requested', 'role', 'high', 14400, TRUE),
  (gen_random_uuid()::text, NULL, FALSE, 'Document requested from contractor',
    'Email the contractor; they reply with attachment via inbound webhook.',
    'document.requested', ARRAY['email'],
    'document.requested', 'manual', 'normal', NULL, TRUE),
  (gen_random_uuid()::text, NULL, FALSE, 'Invoice awaiting confirmation',
    'Email the finance approver; SLA escalation to finance lead after 8h.',
    'invoice.awaiting_confirmation', ARRAY['email','inapp'],
    'invoice.awaiting_confirmation', 'role', 'high', 28800, TRUE),
  (gen_random_uuid()::text, NULL, FALSE, 'Role assigned',
    'In-app + email when a TeamMember receives a new role.',
    'role.assigned', ARRAY['email','inapp'],
    'role.assigned', 'manual', 'normal', NULL, TRUE),
  (gen_random_uuid()::text, NULL, FALSE, 'Incident assigned',
    'Push + in-app + email when an incident is dispatched to a responder.',
    'incident.assigned', ARRAY['push','inapp','email'],
    'incident.assigned', 'assignee', 'high', NULL, TRUE)
ON CONFLICT DO NOTHING;
