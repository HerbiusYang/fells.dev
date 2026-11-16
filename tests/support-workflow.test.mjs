import test from 'node:test';
import assert from 'node:assert/strict';
import { inboxConversations, supportCaseTypes, supportOrderNextStep, supportOrderTransitions, supportRefundRemaining, SUPPORT_INBOX_PAGE, SUPPORT_MESSAGE_PAGE } from '../src/lib/support-workflow.ts';
import { supportExperienceCopy } from '../src/i18n/support-experience.ts';
import { supportRequestError } from '../src/lib/support-ui.ts';
import { APIError } from '../src/lib/app-http.ts';
import { supportErrorCopy } from '../src/i18n/support-errors.ts';

const message = (sender, created, text = '') => ({ id: String(created), sender, created, text });
const conversation = (id, messages = [], extra = {}) => ({ id, user: { id, name: '客户', email: `${id}@example.test` }, status: 'open', agentReadAt: 0, userReadAt: 0, updatedAt: 100, messages, ...extra });
const order = extra => ({ product: 'allowance', status: 'quoted', amountMicro: 20000000, refundedMicro: 0, refundPendingMicro: 0, ...extra });

test('inbox excludes idle visitors and finished history while preserving explicit access to all records', () => {
  const items = [conversation('idle'), conversation('closed', [message('user', 1)], { status: 'resolved' }), conversation('active', [message('user', 2)])];
  assert.deepEqual(inboxConversations(items, 'open', '', 'zh-CN').map(item => item.id), ['active']);
  assert.equal(inboxConversations(items, 'all', '', 'zh-CN').length, 3);
  assert.deepEqual(inboxConversations(items, 'resolved', '', 'zh-CN').map(item => item.id), ['closed']);
  assert.equal(items[0].id, 'idle', 'filtering never reorders or deletes source records');
  assert.equal(SUPPORT_INBOX_PAGE, 40); assert.equal(SUPPORT_MESSAGE_PAGE, 30);
});
test('older unread customer requests precede recent answered requests and search covers Chinese messages and orders', () => {
  const unread = conversation('unread', [message('user', 10, '中文问题')], { updatedAt: 10 });
  const waiting = conversation('waiting', [message('user', 20)], { updatedAt: 20, agentReadAt: 20 });
  const answered = conversation('answered', [message('agent', 100)], { updatedAt: 100 });
  const linked = conversation('order', [{ ...message('agent', 2), orderTitle: '原订单套餐' }]);
  const items = [answered, waiting, unread, linked];
  assert.deepEqual(inboxConversations(items, 'open', '', 'zh').map(item => item.id), ['unread', 'waiting', 'answered', 'order']);
  assert.deepEqual(inboxConversations(items, 'unread', '', 'zh').map(item => item.id), ['unread']);
  assert.equal(inboxConversations(items, 'all', ' 中文 ', 'zh')[0].id, 'unread');
  assert.equal(inboxConversations(items, 'all', '原订单', 'zh')[0].id, 'order');
  assert.equal(inboxConversations(items, 'all', 'ANSWERED@EXAMPLE.TEST', 'zh')[0].id, 'answered');
  assert.equal(inboxConversations(items, 'open', '不存在', 'zh').length, 0);
  assert.equal(inboxConversations([conversation('old', [], {status:'resolved',updatedAt:1}),conversation('new', [], {status:'resolved',updatedAt:2})], 'resolved', '', 'en')[0].id, 'new');
});
test('original order gates activation and compensation while pending activation prevents duplicate issuance', () => {
  const paid = order({ status: 'awaiting_fulfillment', paymentTopupId: '101', purchaseConfirmation: { state: 'confirmed' } });
  assert.deepEqual(supportCaseTypes(paid), ['activation', 'refund']);
  assert.deepEqual(supportCaseTypes({...paid,hasPendingActivationCase:true}), ['refund']);
  assert.deepEqual(supportCaseTypes({...paid,fulfilled:true}), ['compensation', 'refund']);
  assert.deepEqual(supportCaseTypes(order({product:'other',fulfilled:true})), ['refund']);
  for (const extra of [{purchaseConfirmation:null},{paymentTopupId:''},{status:'quoted'},{purchaseConfirmation:{state:'required'}}]) assert.deepEqual(supportCaseTypes({...paid,...extra}), ['refund']);
});
test('next steps distinguish quote consent, actual payment, activation and customer acceptance', () => {
  assert.equal(supportOrderNextStep(order({purchaseConfirmation:{state:'required'}})), 'consentNeeded');
  assert.equal(supportOrderNextStep(order({})), 'paymentNeeded');
  assert.equal(supportOrderNextStep(order({status:'quoted',purchaseConfirmation:{state:'confirmed'}})), 'preparePaymentNext');
  assert.equal(supportOrderNextStep(order({status:'awaiting_payment',paymentTopupId:'101'})), 'paymentNeeded');
  assert.equal(supportOrderNextStep(order({status:'awaiting_fulfillment',paymentTopupId:'101'})), 'activationNext');
  assert.equal(supportOrderNextStep(order({hasPendingActivationCase:true})), 'pendingActivation');
  assert.equal(supportOrderNextStep(order({fulfilled:true})), 'acceptanceNext');
  assert.equal(supportOrderNextStep(order({fulfilled:true,status:'refunding'})), 'refundNext');
  assert.equal(supportOrderNextStep(order({fulfilled:true,status:'needs_review'})), 'reviewNext');
  assert.equal(supportOrderNextStep(order({status:'completed',afterSalesStatus:'needs_review'})), 'reviewNext');
  assert.equal(supportOrderNextStep(order({product:'other',paymentTopupId:'101'})), 'manualNext');
  assert.equal(supportOrderNextStep(order({quoteReconfirmation:{state:'pending'}})), 'consentNeeded');
  for (const status of ['completed','cancelled','refunded','partially_refunded']) assert.equal(supportOrderNextStep(order({status})), 'completed');
});
test('refund limits subtract both settled and pending refunds and never become negative', () => {
  assert.equal(supportRefundRemaining(order({refundedMicro:3000000,refundPendingMicro:2000000})), 15000000);
  assert.equal(supportRefundRemaining(order({refundedMicro:20000001})), 0);
  assert.equal(supportRefundRemaining({amountMicro:1}), 1);
});
test('status choices preserve terminal orders and never offer an unsupported direct state jump', () => {
  for (const status of ['cancelled','refunded']) assert.deepEqual(supportOrderTransitions(order({status})), [status]);
  assert.equal(supportOrderTransitions(order({status:'quoted'})).includes('completed'), false);
  for (const status of ['quoted','awaiting_payment','awaiting_fulfillment','completed','needs_review','refunding','partially_refunded']) {
    const allowed = supportOrderTransitions(order({status})); assert.equal(allowed[0], status); assert.equal(new Set(allowed).size, allowed.length);
  }
});
test('all supported locales include the complete workflow and Chinese aliases resolve to Chinese', () => {
  const english = supportExperienceCopy('en');
  for (const lang of ['zh','zh-CN','zh-Hans','zh-hant','zh-TW','zh-HK','ja-JP','ko-KR','es-ES','en','unsupported']) {
    const copy = supportExperienceCopy(lang); assert.deepEqual(Object.keys(copy), Object.keys(english));
    assert.ok(Object.values(copy).every(value => typeof value === 'string' && value.trim()));
  }
  assert.equal(supportExperienceCopy('zh-CN').tickets,'订单与工单');
  assert.equal(supportExperienceCopy('zh-TW').tickets,'訂單與工單');
});
test('structured support errors use Chinese actions while preserving server status and conflict semantics', () => {
  for(const lang of ['zh-CN','zh-TW','ja','ko','es'])for(const status of [400,403,404,408,409,422,429,503]){
    const error=new APIError(status,'Untranslated server diagnostic','synthetic_error');
    const message=supportRequestError(error,lang,'fallback');assert.ok(message&&!message.includes('Untranslated'));
    assert.equal(error.status,status);assert.equal(error.message,'Untranslated server diagnostic');
  }
  assert.equal(supportRequestError(new APIError(409,'unknown','operation_pending'),'zh','fallback'),supportErrorCopy('zh').pending);
  assert.equal(supportRequestError(new APIError(409,'unknown','operation_in_progress'),'zh','fallback'),supportErrorCopy('zh').pending);
  assert.equal(supportRequestError(new APIError(503,'unknown','unknown_outcome'),'zh','fallback'),supportErrorCopy('zh').pending);
  for(const [code,key] of [['seat_sold_out','capacity'],['plan_unavailable','plan'],['insufficient_balance','funds'],['quote_expired_or_mismatch','quote']]) assert.equal(supportRequestError(new APIError(409,'English diagnostic',code),'zh','fallback'),supportErrorCopy('zh')[key]);
  assert.equal(supportRequestError(new APIError(503,'维护提示','service_maintenance'),'zh','fallback'),'维护提示');
  assert.equal(supportRequestError(new APIError(503,'','service_maintenance'),'zh','fallback'),supportErrorCopy('zh').unavailable);
  assert.equal(supportRequestError(new APIError(401,'请重新登录','unauthorized'),'zh','fallback'),'请重新登录');
  assert.equal(supportRequestError(new APIError(418,'','other'),'zh','fallback'),'fallback');
  assert.equal(supportRequestError(new APIError(400,'Specific error'),'en','fallback'),'Specific error');
  assert.equal(supportRequestError(new APIError(400,''),'en','fallback'),'fallback');
  assert.equal(supportRequestError(new Error(),'zh','fallback'),'fallback');
  assert.equal(supportErrorCopy('unknown').invalid,supportErrorCopy('en').invalid);
});
