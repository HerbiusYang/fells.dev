import type { SupportOrderHistory } from "./support-orders";
type SupportCaseType = "activation" | "compensation" | "refund";
type SupportCaseStatus = "open" | "executed" | "closed" | "cancelled" | "needs_review";
export interface SupportCase {
  id: string; orderId: string; conversationId: string; userId: string; caseType: SupportCaseType; status: SupportCaseStatus;
  reason: string; evidenceMessageId: string | null; evidenceAttachmentId: string | null; evidenceNote: string;
  requestedAllowanceMicro: number; requestedHours: number; refundMicro: number; enableApiKeys: boolean;
  assigneeId: string; assigneeName: string; dueAt: string | null; note: string; refundProof: string;
  refundProofMessageId: string | null; refundProofAttachmentId: string | null; version: number;
  receipt: { actionRef: string; ledgerRef: string; allowanceMicro: number; subscriptionId: number | null; subscriptionHours: number; cashRefundMicro: number; before: unknown; after: unknown } | null;
  history: SupportOrderHistory[]; createdAt: string; updatedAt: string; executedAt: string | null; closedAt: string | null;
}
export interface SupportCaseCreate {
  clientCaseId: string; caseType: SupportCaseType; reason: string; evidenceMessageId: string | null; evidenceAttachmentId: string | null; evidenceNote: string;
  requestedAllowanceMicro: number; requestedHours: number; refundMicro: number; enableApiKeys: boolean; assigneeId?: string; dueAt: string | null;
}
export interface SupportCasePatch { version: number; status?: SupportCaseStatus; assigneeId?: string; dueAt?: string | null; note?: string; refundProof?: string; refundProofMessageId?: string | null; refundProofAttachmentId?: string | null }
