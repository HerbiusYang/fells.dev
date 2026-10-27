import test from 'node:test';
import assert from 'node:assert/strict';
import { accountFunding } from '../src/lib/account-funding.ts';

const gross = { micro: 23000000, plan_micro: 10000000, comp_micro: 3000000 };
test('spendable snapshot preserves zero, signed debt and disjoint reserved/pending totals', () => {
  const fields = { available_micro: 7000000, available_plan_micro: 2000000, available_comp_micro: 1000000, reserved_micro: 14000000, pending_micro: 2000000 };
  assert.deepEqual(accountFunding({ ...gross, ...fields }), { explicit: true, gross: 23000000, total: 7000000, plan: 2000000, compensation: 1000000, independent: 4000000, nonPlan: 5000000, reserved: 14000000, pending: 2000000 });
  assert.equal(accountFunding({ ...gross, ...fields, available_micro: 0, available_plan_micro: 0, available_comp_micro: 0 }).total, 0);
  assert.equal(accountFunding({ ...gross, ...fields, available_micro: -150001, available_plan_micro: 0, available_comp_micro: 0 }).independent, -150001);
  assert.equal(accountFunding({ micro: -150001 }).nonPlan, -150001);
});
test('missing, partial and malformed availability use the entire legacy snapshot', () => {
  for (const fields of [{}, { available_micro: 0 }, { available_micro: 0, available_plan_micro: 0, available_comp_micro: null }, { available_micro: 0, available_plan_micro: '0', available_comp_micro: 0 }, { available_micro: NaN, available_plan_micro: 0, available_comp_micro: 0 }]) {
    const funds = accountFunding({ ...gross, ...fields });
    assert.equal(funds.explicit, false); assert.equal(funds.total, 23000000); assert.equal(funds.plan, 10000000); assert.equal(funds.compensation, 3000000); assert.equal(funds.nonPlan, 13000000); assert.equal(funds.independent, 10000000);
  }
  assert.equal(accountFunding().total, 0);
});
