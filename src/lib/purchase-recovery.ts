import { manualSalesWords } from '../i18n/manual-sales.ts';
export interface PurchaseOperation {
  operation_id: string; kind: string; route: string; created_at: string;
  status: 'pending'|'completed'|'rejected'; outcome: string; poll_only: true;
  evidence: { cash_micro?: number; allowance_micro?: number; period_start?: number; period_end?: number; subscription_id?: number; topup_id?: number };
  ceiling_micro?: number; acknowledged: boolean;
}
export function parsePurchaseOperation(value: unknown): PurchaseOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid operation receipt');
  const v=value as PurchaseOperation;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.operation_id) || v.poll_only!==true || !['pending','completed','rejected'].includes(v.status) || typeof v.outcome!=='string' || typeof v.kind!=='string' || typeof v.route!=='string' || !v.route.startsWith('POST /api/app/') && !v.route.startsWith('/api/app/') || typeof v.created_at!=='string' || !Number.isFinite(Date.parse(v.created_at)) || typeof v.acknowledged!=='boolean' || !v.evidence || typeof v.evidence!=='object' || Array.isArray(v.evidence)) throw Error('Invalid operation receipt');
  for (const key of ['cash_micro','allowance_micro','period_start','period_end','subscription_id','topup_id'] as const) {
    const number = v.evidence[key];
    if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) throw Error('Invalid operation receipt');
  }
  if (v.ceiling_micro !== undefined && (!Number.isSafeInteger(v.ceiling_micro) || v.ceiling_micro < 0)) throw Error('Invalid operation receipt');
  return v;
}
export function purchaseOperationStatus(value: PurchaseOperation, language: string): string {
  const w=manualSalesWords(language);
  return value.status==='completed'?w.completed:value.status==='rejected'?w.rejected:w.pending;
}
