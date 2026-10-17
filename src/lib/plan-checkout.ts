export type PlanKind = "token" | "subscription" | "upgrade";
export interface PlanPurchase {
  kind: PlanKind; title: string; key: string; body: Record<string,string|number>;
  days: number; months: number; quotaMicro?: number; burstMicro?: number;
  sourceName?: string; creditMicro?: number; chargeMicro: number; maxChargeMicro: number;
  enableKeys?: boolean; queued?: boolean; newUserOnly?: boolean; startsAt?: number; expiresAt?: number;
}
export function planPriceCeiling(monthly: number, months: number): number | null {
  return Number.isSafeInteger(monthly) && monthly >= 0 && Number.isSafeInteger(months) && months >= 1 && months <= 24 && Number.isSafeInteger(monthly*months) ? monthly*months : null;
}
export function validPlanPurchase(value: unknown): value is PlanPurchase {
  if (!value || typeof value !== "object") return false;
  const p=value as PlanPurchase,whole=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
  if (!["token","subscription","upgrade"].includes(p.kind)||typeof p.title!=="string"||!p.title||p.title.length>300||! /^[a-f0-9-]{36}$/.test(p.key)||!p.body||typeof p.body!=="object"||!whole(p.days)||p.days<=0||!whole(p.chargeMicro)||!whole(p.maxChargeMicro)||p.maxChargeMicro<p.chargeMicro||p.body.max_charge_micro!==p.maxChargeMicro) return false;
  if (p.kind==="token") return typeof p.body.plan==="string"&&p.body.plan.length>0&&!("ref" in p.body)&&typeof p.body.terms_hash==="string"&&/^[a-f0-9]{64}$/.test(p.body.terms_hash)&&whole(p.quotaMicro)&&whole(p.burstMicro);
  return whole(p.body.pool_id)&&Number(p.body.pool_id)>0&&whole(p.body.tier)&&Number(p.body.tier)>0&&planPriceCeiling(0,Number(p.body.months))!==null&&(p.kind!=="upgrade"||whole(p.body.from_pool)&&Number(p.body.from_pool)>0);
}

/** Reconciliation is a server-owned receipt, never permission to submit again. */
export function validPlanReceipt(value: unknown, p: PlanPurchase, userId: number): boolean {
  if (!value || typeof value!=="object") return false;
  const r=value as Record<string,unknown>, positive=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
  if (r.subscription && typeof r.subscription==="object") {
    const sub=r.subscription as Record<string,unknown>;
    return positive(sub.id) && (p.kind==="token" ? sub.plan_code===p.body.plan : sub.pool_id===p.body.pool_id && sub.tier===p.body.tier);
  }
  if(r.ok!==true||r.reconciled!==true||typeof r.operation_id!=="string"||! /^[a-f0-9-]{36}$/.test(r.operation_id)||typeof r.business_ref!=="string"||!r.receipt||typeof r.receipt!=="object")return false;
  const e=r.receipt as Record<string,unknown>,cash=e.cashMicro??0;
  if(e.reference!==r.business_ref||!positive(e.subscriptionId)||!Number.isSafeInteger(cash)||Number(cash)<0||Number(cash)>p.maxChargeMicro)return false;
  if(p.kind==="token")return e.kind==="token_plan"&&r.business_ref===`tplan:${userId}:${r.operation_id}`&&e.planCode===p.body.plan&&(e.allowanceMicro??0)===p.quotaMicro&&(e.burstAllowanceMicro??0)===p.burstMicro&&positive(e.periodStart)&&positive(e.periodEnd)&&Number(e.periodEnd)>Number(e.periodStart);
  return e.kind==="subscription"&&new RegExp(`^seat:${e.subscriptionId}:[1-9][0-9]*(?::d[1-9][0-9]*)?$`).test(r.business_ref);
}
