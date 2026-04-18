export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'escalated';
export type ApprovalType = 'spend' | 'document' | 'compliance';

export interface ApprovalItem {
  id: string;
  tenantId: string;
  title: string;
  type: ApprovalType;
  amount: string | null;
  building: string;
  requester: string;
  step: number;
  totalSteps: number;
  status: ApprovalStatus;
  threshold: string | null;
  hint: string | null;
  createdAt: string;
}
