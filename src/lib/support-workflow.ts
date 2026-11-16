import type { SupportConversation } from "./support-store.ts";
import type { SupportOrder } from "./support-orders.ts";
import type { SupportCase } from "./support-cases.ts";

export const SUPPORT_INBOX_PAGE = 40;
export const SUPPORT_MESSAGE_PAGE = 30;
export function inboxConversations(items: SupportConversation[], filter: string, query: string, lang: string) {
  const needle = query.trim().toLocaleLowerCase(lang);
  const unread = (item: SupportConversation) => item.messages.some(message => message.sender === "user" && message.created > item.agentReadAt);
  return items.filter(item => {
    if (filter === "open" && (item.status !== "open" || !item.messages.length)) return false;
    if (filter === "resolved" && item.status !== "resolved") return false;
    if (filter === "unread" && !unread(item)) return false;
    return !needle || [item.user.name, item.user.email, item.user.id, ...item.messages.map(message => `${message.text} ${message.orderTitle ?? ""}`)].some(value => value.toLocaleLowerCase(lang).includes(needle));
  }).sort((left, right) => filter === "resolved" ? right.updatedAt - left.updatedAt : Number(unread(right)) - Number(unread(left)) || Number(right.messages.at(-1)?.sender === "user") - Number(left.messages.at(-1)?.sender === "user") || right.updatedAt - left.updatedAt);
}

/** Presentation guidance only. The server authorizes every transition. */
export function supportOrderTransitions(order: SupportOrder): SupportOrder["status"][] {
  const transitions: Record<SupportOrder["status"], SupportOrder["status"][]> = {
    quoted: ["awaiting_payment", "cancelled", "needs_review"],
    awaiting_payment: ["awaiting_fulfillment", "cancelled", "needs_review"],
    awaiting_fulfillment: ["completed", "refunding", "needs_review"],
    needs_review: ["quoted", "awaiting_payment", "awaiting_fulfillment", "completed", "refunding", "cancelled"],
    completed: ["refunding", "needs_review"], refunding: ["refunded", "partially_refunded", "needs_review"],
    partially_refunded: ["refunding", "needs_review"], cancelled: [], refunded: [],
  };
  return [order.status, ...transitions[order.status]];
}
type SupportOrderStep = "completed" | "refundNext" | "reviewNext" | "manualNext" | "acceptanceNext" | "pendingActivation" | "consentNeeded" | "preparePaymentNext" | "activationNext" | "paymentNeeded";
export function supportOrderNextStep(order: SupportOrder): SupportOrderStep {
  if (order.status === "refunding") return "refundNext";
  if (order.status === "needs_review" || order.afterSalesStatus === "needs_review") return "reviewNext";
  if (["cancelled", "refunded", "completed", "partially_refunded"].includes(order.status)) return "completed";
  if (order.product === "other") return "manualNext";
  if (order.fulfilled) return "acceptanceNext";
  if (order.hasPendingActivationCase) return "pendingActivation";
  if (order.purchaseConfirmation?.state === "required" || order.quoteReconfirmation && order.quoteReconfirmation.state !== "confirmed") return "consentNeeded";
  if (order.status === "quoted" && order.purchaseConfirmation?.state === "confirmed") return "preparePaymentNext";
  return order.paymentTopupId && order.status === "awaiting_fulfillment" ? "activationNext" : "paymentNeeded";
}
export function supportRefundRemaining(order: SupportOrder): number {
  return Math.max(0, order.amountMicro - (order.refundedMicro ?? 0) - (order.refundPendingMicro ?? 0));
}
export function supportCaseTypes(order: SupportOrder): SupportCase["caseType"][] {
  const types: SupportCase["caseType"][] = [];
  if (order.product !== "other" && !order.fulfilled && !order.hasPendingActivationCase && order.purchaseConfirmation?.state === "confirmed" && !!order.paymentTopupId && order.status === "awaiting_fulfillment") types.push("activation");
  if (order.product !== "other" && order.fulfilled) types.push("compensation");
  types.push("refund");
  return types;
}
