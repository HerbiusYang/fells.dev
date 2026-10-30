import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePurchaseOperation, purchaseOperationStatus } from '../src/lib/purchase-recovery.ts';
import { manualSalesWords } from '../src/i18n/manual-sales.ts';
const operation = {operation_id:'00000000-0000-4000-8000-000000000001',kind:'token_plan',route:'/api/app/plans/buy',created_at:'2026-10-30T00:00:00Z',status:'pending',outcome:'pending',poll_only:true,acknowledged:false,evidence:{cash_micro:2000000,allowance_micro:3000000}};
test('owner receipts reject malformed identities, replay permissions and incoherent evidence',()=>{
 assert.equal(parsePurchaseOperation(operation).operation_id,operation.operation_id);
 for (const patch of [{operation_id:'other-user'}, {poll_only:false}, {route:'https://attacker.test'}, {route:'/admin'}, {status:'success'}, {created_at:'never'}, {acknowledged:'true'}, {evidence:[]}, {evidence:{cash_micro:-1}}, {evidence:{allowance_micro:1.5}}, {ceiling_micro:Number.MAX_SAFE_INTEGER+1}]) assert.throws(()=>parsePurchaseOperation({...operation,...patch}),JSON.stringify(patch));
});
test('all receipt states and manual consent remain distinct in every supported language',()=>{
 for(const locale of ['en','zh','zh-hant','ja','ko','es']) {
  const copy=manualSalesWords(locale); assert.ok(Object.values(copy).every(value=>typeof value==='string'&&value.length>0));
  assert.equal(new Set(['pending','completed','rejected'].map(status=>purchaseOperationStatus({...operation,status},locale))).size,3);
  assert.notEqual(copy.quoteConfirmed,copy.completed,'quotation consent never claims activation');
 }
});
