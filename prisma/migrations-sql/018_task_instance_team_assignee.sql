-- 018_task_instance_team_assignee.sql
--
-- INIT-013 Phase 3 — TaskInstance gains assignedTeamMemberId so PPM can
-- auto-route through the role-assignments resolver. Legacy assignedUserId
-- fields on Incident/ServiceRequest stay until those modules migrate.
--
-- Idempotent.

ALTER TABLE "task_instances" ADD COLUMN IF NOT EXISTS "assignedTeamMemberId" TEXT;
ALTER TABLE "task_instances" ADD COLUMN IF NOT EXISTS "assignmentSource"     TEXT;
ALTER TABLE "task_instances" ADD COLUMN IF NOT EXISTS "assignmentReason"     TEXT;

CREATE INDEX IF NOT EXISTS "task_instances_assignedTeamMemberId_idx"
  ON "task_instances" ("assignedTeamMemberId");
