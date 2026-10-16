import type { SupportLifecycle } from "./support-lifecycle.ts";
import type { SupportOrderHistory } from "./support-orders.ts";
type SupportCaseType = "activation" | "compensation" | "refund";
type SupportCaseStatus = "open" | "executed" | "closed" | "cancelled" | "needs_review" | "reversed";
export interface SupportCase extends SupportLifecycle {
  id: string; orderId: string; conversationId: string; userId: string; caseType: SupportCaseType; status: SupportCaseStatus;
  correctsCaseId?: string;
  reasonCode?: "service_outage" | "delivery_error" | "billing_error" | "goodwill"; refund?: SupportRefund | null; reversalRef?: string; reversedAt?: string | null;
  reason: string; evidenceMessageId: string | null; evidenceAttachmentId: string | null; evidenceNote: string;
  requestedAllowanceMicro: number; requestedHours: number; requestedPlanPeriods: number; refundMicro: number; enableApiKeys: boolean;
  assigneeId: string; assigneeName: string; dueAt: string | null; note: string; refundProof: string;
  refundProofMessageId: string | null; refundProofAttachmentId: string | null; version: number;
  receipt: { actionRef: string; ledgerRef: string; allowanceMicro: number; subscriptionId: number | null; subscriptionHours: number; tokenPlanRef?: string; tokenPlanSubscriptionId?: number | null; tokenPlanPeriods?: number; cashRefundMicro: number; before: unknown; after: unknown } | null;
  history: SupportOrderHistory[]; createdAt: string; updatedAt: string; executedAt: string | null; closedAt: string | null;
}
export interface SupportCaseCreate {
  reasonCode?: "service_outage" | "delivery_error" | "billing_error" | "goodwill";
  correctsCaseId?: string;
  clientCaseId: string; caseType: SupportCaseType; reason: string; evidenceMessageId: string | null; evidenceAttachmentId: string | null; evidenceNote: string;
  requestedAllowanceMicro: number; requestedHours: number; requestedPlanPeriods: number; refundMicro: number; enableApiKeys: boolean; assigneeId?: string; dueAt: string | null;
}
export interface SupportCasePatch { version: number; status?: SupportCaseStatus; assigneeId?: string; dueAt?: string | null; note?: string; refundProof?: string; refundProofMessageId?: string | null; refundProofAttachmentId?: string | null }

interface SupportRefund {
  plan: { mode: "proportional" | "remaining" | "waive"; reason: string; proposedBy: string; approvedBy: string; approvedAt: string | null } | null;
  stage: "pending" | "unknown" | "failed" | "paid"; claimedStage: "" | "pending" | "unknown" | "failed" | "paid";
  channelAmountMicro?: number; channelCurrency?: "CNY";
  provider: string; account: string; refundId: string; executedBy: string; recordedBy: string; reviewedBy: string;
  reversalRef: string; reversedAt: string | null; recovery: { lossCashMicro?: number; guaranteeRecalledMicro?: number; guaranteeLossMicro?: number; [key: string]: unknown } | null;
}
export interface SupportRefundPlan { version: number; action: "propose" | "approve"; mode: "proportional" | "remaining" | "waive"; reason: string }
export interface SupportRefundChannel { version: number; amountMicro: number; currency: "CNY"; stage: "pending" | "unknown" | "failed" | "paid"; provider: string; account: string; refundId: string; note: string; proofMessageId?: string | null; proofAttachmentId?: string | null }
export interface SupportCaseReverse { acceptRewardLoss?: boolean; version: number; reason: string; evidenceMessageId?: string | null; evidenceAttachmentId?: string | null }
export interface SupportCompensationReport { month: string; items: { userId: string; allowanceMicro: number; hours: number; planPeriods: number; caseCount: number }[] }
