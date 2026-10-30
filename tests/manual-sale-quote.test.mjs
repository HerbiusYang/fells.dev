import test from 'node:test';
import assert from 'node:assert/strict';
import { supportQuoteMarkup } from '../src/scripts/support-order-quote.ts';
import { manualSalesWords } from '../src/i18n/manual-sales.ts';
const base={id:'synthetic-order',title:'<img src=x onerror=alert(1)>',product:'token_plan',amountMicro:2000000,allowanceUsdMicro:0,serviceDays:30,status:'quoted',tier:4,planCode:'synthetic',quoteSnapshot:{tokenPlan:{name:'<Synthetic>',quota_usd_micro:3000000,burst_usd_micro:6000000}},purchaseConfirmation:{state:'required',quoteHash:'a'.repeat(64)}};
for(const locale of ['en','zh','zh-hant','ja','ko','es'])test(`manual quote requires customer consent without claiming activation ${locale}`,()=>{
 const required=supportQuoteMarkup(base,locale,'customer');assert.match(required,/data-order-confirm-purchase="synthetic-order"/);assert.ok(required.includes(manualSalesWords(locale).confirmRule));assert.match(required,/&lt;Synthetic&gt;/);assert.doesNotMatch(required,/<img|onerror=/);
 const operator=supportQuoteMarkup(base,locale,'operator');assert.doesNotMatch(operator,/data-order-confirm-purchase=/);
 const confirmed=supportQuoteMarkup({...base,purchaseConfirmation:{...base.purchaseConfirmation,state:'confirmed',confirmedAt:'2026-10-30T00:00:00Z'}},locale,'customer');assert.ok(confirmed.includes(manualSalesWords(locale).quoteConfirmed));assert.doesNotMatch(confirmed,/data-order-confirm-purchase=/);
});
test('historical orders do not gain a manufactured new-sale consent',()=>assert.doesNotMatch(supportQuoteMarkup({...base,purchaseConfirmation:undefined},'en','customer'),/data-purchase-quote/));
