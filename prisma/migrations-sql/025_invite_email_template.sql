-- 025_invite_email_template.sql
-- GROWTH-001 NS-22 — wire invite.created event to email delivery.
--
-- Adds one notification template (invite.created) and one notification
-- rule (manual recipient strategy → recipientEmails from payload). The
-- invites module's outbox publish carries the plaintext token in
-- payload.token and a pre-built acceptUrl; the template substitutes
-- both into the email body.
--
-- Tenant-immutable system row (tenantId IS NULL, isCustom=false). Same
-- shape as the 8 starter templates in 020_notifications_unified.sql.
-- Idempotent — ON CONFLICT DO NOTHING on (key, channel, locale).

INSERT INTO "notification_templates" ("id", "tenantId", "isCustom", "key", "channel", "locale", "subject", "bodyText", "bodyHtml", "variables", "category", "description")
VALUES
  (gen_random_uuid()::text, NULL, FALSE, 'invite.created', 'email', 'en',
    'You are invited to Domera ({{roleKey}})',
    'Hi,\n\nYou have been invited to join a Domera workspace as {{roleKey}}.\n\nAccept here (single-use, expires in 72h):\n{{acceptUrl}}\n\nIf the link is broken, paste the token below into the accept-invite page:\n{{token}}\n\n— Domera',
    '<p>Hi,</p><p>You have been invited to join a Domera workspace as <b>{{roleKey}}</b>.</p><p><a href="{{acceptUrl}}">Accept invite</a> — single-use, expires in 72 hours.</p><p style="font-size:12px;color:#777">If the link is broken, paste this token into the accept-invite page:<br/><code>{{token}}</code></p>',
    ARRAY['roleKey','acceptUrl','token'],
    'people',
    'Sent to a new invitee. Manual recipient strategy — payload.recipientEmails carries the address since the user has no TeamMember row yet.')
ON CONFLICT DO NOTHING;

INSERT INTO "notification_rules" ("id", "tenantId", "isCustom", "name", "description", "eventType", "channels", "templateKey", "recipientStrategy", "priority", "slaSeconds", "isActive")
VALUES
  (gen_random_uuid()::text, NULL, FALSE, 'Invite created',
    'Email the invitee a single-use accept-invite link. recipientEmails populated from payload.',
    'invite.created', ARRAY['email'],
    'invite.created', 'manual', 'normal', NULL, TRUE)
ON CONFLICT DO NOTHING;
