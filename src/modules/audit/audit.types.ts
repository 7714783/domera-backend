export type AuditEntityType = string;

export interface AuditEntry {
  id: string;
  tenantId: string;
  timestamp: string;
  actor: string;
  role: string;
  action: string;
  entity: string;
  entityType: AuditEntityType;
  building: string;
  ip: string;
  sensitive: boolean;
}
