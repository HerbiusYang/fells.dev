import test from 'node:test';
import assert from 'node:assert/strict';
import { supportRecoveryCopy } from '../src/i18n/support-recovery.ts';
import { supportDisputeForm } from '../src/lib/support-lifecycle.ts';

test('all supported customer languages explain retained drafts and operation backlog without exposing implementation details', () => {
  for (const lang of ['en','zh-CN','zh-TW','ja','ko','es']) {
    const copy=supportRecoveryCopy(lang);
    assert.equal(Object.keys(copy).length,11);
    for(const value of Object.values(copy))assert.ok(value.trim());
    const markup=supportDisputeForm('order','original-order',lang,{reason:'Lost <service> & proof',unavailable:true});
    assert.match(markup,/data-dispute-refresh/);
    assert.match(markup,/Lost &lt;service&gt; &amp; proof/);
    assert.match(markup,/<details[^>]+open/);
    assert.match(markup,/textarea[^>]+readonly/);
    assert.match(markup,/type="submit" disabled/);
    assert.ok(markup.includes(copy.disputeUnavailable));
  }
  assert.deepEqual(supportRecoveryCopy('zh'),supportRecoveryCopy('zh-CN'));
  assert.deepEqual(supportRecoveryCopy('zh-hant'),supportRecoveryCopy('zh-TW'));
  assert.deepEqual(supportRecoveryCopy('unknown'),supportRecoveryCopy('en'));
});
