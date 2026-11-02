import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupWithTimeout, ownBrowserContext } from './helpers/security-lifecycle.mjs';

const helper = new URL('./helpers/security-lifecycle.mjs', import.meta.url).href;
const scenarios = {
  success: `record('success', {}, async t => { t.after(async () => { await pause(10); cleanupDone = true; }); });`,
  bodyFailure: `record('body failure', {}, async () => { throw new Error('synthetic body failure'); });`,
  hookFailure: `record('hook failure', {}, async t => { t.after(async () => { await pause(10); throw new Error('synthetic cleanup failure'); }); });`,
  hookTimeout: `record('hook timeout', {}, async t => { t.after(() => pause(150), { timeout: 50 }); });`,
  lateBody: `record('late body', { timeout: 50 }, async () => { await pause(150); lateFinished = true; });
    record('follower', {}, async () => { await pause(200); });`,
  ownedAbort: `record('aborted owned context', { timeout: 50 }, async t => {
    const released = Promise.withResolvers();
    const close = ownBrowserContext({
      unrouteAll() { unrouteCalls++; return released.promise; },
      async close() { closeCalls++; released.resolve(); await pause(10); cleanupDone = true; },
    }, { signal: t.signal, timeoutMs: 500 });
    t.after(() => close());
    await pause(150); lateFinished = true;
  }); record('follower', {}, async () => { await pause(200); });`,
  teardownFailure: `record('successful body', {}, async () => {});`,
};

async function run(t, scenario) {
  const directory = await mkdtemp(join(tmpdir(), 'fells-security-lifecycle-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'case.test.mjs'), evidence = join(directory, 'evidence.json');
  await writeFile(file, `import test, { after } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { ownBrowserContext, writeSecurityEvidence } from ${JSON.stringify(helper)};
const cases = []; let registered = 0, cleanupDone = false, lateFinished = false, closeCalls = 0, unrouteCalls = 0;
function record(name, options, fn) { registered++; test(name, options, async t => { cases.push({ name, context: t }); await fn(t); }); }
${scenarios[scenario]}
after(async () => {
  const failure = new Error('synthetic suite teardown failure');
  try {
    await writeSecurityEvidence({ cases, registered, expected: registered,
      metadata: { schemaVersion: 1, cleanupDone, lateFinished, closeCalls, unrouteCalls,
        caseErrors: cases.map(({ context }) => ({ code: context.error?.code,
          failureType: context.error?.failureType, message: context.error?.message,
          cause: typeof context.error?.cause === 'string' ? context.error.cause : null })) },
      teardown: async () => { if (${JSON.stringify(scenario)} === 'teardownFailure') throw failure; },
      persist: document => writeFile(${JSON.stringify(evidence)}, JSON.stringify(document)),
    });
  } catch (error) {
    if (${JSON.stringify(scenario)} === 'teardownFailure' && error !== failure) throw new Error('original cleanup error was replaced');
    throw error;
  }
});
`);
  // This is an independent runner: Node otherwise treats an inherited
  // NODE_TEST_CONTEXT as a recursive run and skips the child files entirely.
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  delete environment.NODE_TEST_WORKER_ID;
  const result = await new Promise(resolve => execFile(process.execPath,
    ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-timeout=2000', file],
    { env: environment, timeout: 10000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.equal(Boolean(result.error?.killed), false, result.stdout + result.stderr);
  assert.equal(result.error?.signal || null, null, result.stdout + result.stderr);
  return { ...result, document: JSON.parse(await readFile(evidence, 'utf8')) };
}

for (const scenario of Object.keys(scenarios)) test('security evidence follows actual Node lifecycle: ' + scenario, async t => {
  const result = await run(t, scenario), report = result.document;
  if (scenario === 'success') {
    assert.equal(result.error, null, result.stdout + result.stderr);
    assert.equal(report.status, 'passed'); assert.equal(report.testsPassed, 1);
    assert.equal(report.cleanupDone, true, 'the successful after hook finished before evidence was written');
  } else {
    assert.equal(result.error?.code, 1, result.stdout + result.stderr);
    assert.equal(report.status, 'failed');
    if (scenario === 'teardownFailure') {
      assert.equal(report.testsPassed, 1, 'the case itself passed while the suite cleanup failed');
      assert.equal(report.teardown.status, 'failed');
      assert.match(result.stdout, /synthetic suite teardown failure/);
      assert.doesNotMatch(result.stdout, /original cleanup error was replaced/);
    } else {
      assert.equal(report.testsFailed, 1);
      assert.equal(report.results[0].status, 'failed');
      // Node reports the hook wrapper in TAP and retains the timeout in t.error.cause.
      if (scenario === 'hookTimeout') assert.deepEqual(report.caseErrors[0], {
        code: 'ERR_TEST_FAILURE', failureType: 'hookFailed', message: 'failed running after hook',
        cause: 'test timed out after 50ms',
      });
      if (scenario === 'lateBody' || scenario === 'ownedAbort') {
        assert.equal(report.lateFinished, true, 'the cancelled body really returned before the final evidence');
        assert.equal(report.results[1].status, 'passed');
        assert.match(result.stdout, /# cancelled 1/);
      }
      if (scenario === 'ownedAbort') {
        assert.equal(report.cleanupDone, true, 'the after hook waited for abort-started cleanup');
        assert.equal(report.closeCalls, 1); assert.equal(report.unrouteCalls, 1);
      }
    }
  }
  assert.equal(report.testsSkipped, 0);
});

test('owned context starts unroute and close together and shares one result with abort and after', async () => {
  const controller = new AbortController();
  const unrouteStarted = Promise.withResolvers(), closeStarted = Promise.withResolvers();
  let unrouteCalls = 0, closeCalls = 0;
  const close = ownBrowserContext({
    unrouteAll(options) { assert.equal(options.behavior, 'ignoreErrors'); unrouteCalls++; unrouteStarted.resolve(); return closeStarted.promise; },
    close() { closeCalls++; closeStarted.resolve(); return unrouteStarted.promise; },
  }, { signal: controller.signal, timeoutMs: 1000 });
  const pending = close(); controller.abort();
  assert.equal(close(), pending);
  await pending;
  assert.equal(close(), pending); assert.equal(unrouteCalls, 1); assert.equal(closeCalls, 1);
});

test('owned context permits TargetClosed from unroute only when real close succeeds', async () => {
  const expected = new Error('browserContext.unrouteAll: Target page, context or browser has been closed');
  await ownBrowserContext({ unrouteAll() { throw expected; }, async close() {} })();
  const failure = new Error('actual context close failure');
  const close = ownBrowserContext({ unrouteAll() { throw expected; }, close() { throw failure; } });
  await assert.rejects(close(), error => error === failure);
});

test('owned context retains the installed coverage collector and propagates its original error', async () => {
  let realCloseCalls = 0, collected = false;
  const failure = new Error('coverage could not be written');
  const context = { async unrouteAll() {}, async close() { realCloseCalls++; } };
  const close = ownBrowserContext(context);
  const realClose = context.close.bind(context);
  context.close = async () => { try { collected = true; throw failure; } finally { await realClose(); } };
  await assert.rejects(close(), error => error === failure);
  assert.equal(collected, true); assert.equal(realCloseCalls, 1);
});

test('owned context propagates an unexpected interception error after successful close', async () => {
  const failure = new Error('interception protocol failed');
  await assert.rejects(ownBrowserContext({ unrouteAll() { throw failure; }, async close() {} })(), error => error === failure);
});

for (const blocked of ['unroute', 'close']) test(`owned context fails a blocked ${blocked} and waits for one browser shutdown`, async () => {
  const controller = new AbortController(), released = Promise.withResolvers();
  let shutdowns = 0, stopped = false, unrouteCalls = 0, closeCalls = 0;
  const close = ownBrowserContext({
    unrouteAll() { unrouteCalls++; return blocked === 'unroute' ? released.promise : Promise.resolve(); },
    close() { closeCalls++; return blocked === 'close' ? released.promise : Promise.resolve(); },
  }, { signal: controller.signal, timeoutMs: 20, onFailure: async () => {
    shutdowns++; released.resolve(); stopped = true;
  } });
  controller.abort(); const pending = close(); assert.equal(close(), pending);
  await assert.rejects(pending, error => error.code === 'FELLS_TEST_CLEANUP_TIMEOUT');
  assert.equal(stopped, true); assert.equal(shutdowns, 1);
  assert.equal(unrouteCalls, 1); assert.equal(closeCalls, 1);
  await assert.rejects(close(), error => error.code === 'FELLS_TEST_CLEANUP_TIMEOUT');
  assert.equal(shutdowns, 1, 'reusing the failed cleanup cannot turn it into success or repeat browser shutdown');
});

test('a stuck browser shutdown remains bounded and keeps both context and browser failures', async () => {
  const contextReleased = Promise.withResolvers(), browserReleased = Promise.withResolvers();
  const close = ownBrowserContext({ async unrouteAll() {}, close: () => contextReleased.promise }, {
    timeoutMs: 20,
    onFailure: () => cleanupWithTimeout(() => browserReleased.promise, 'Synthetic browser shutdown', 20),
  });
  try {
    await assert.rejects(close(), error => error instanceof AggregateError && error.errors.length === 2 &&
      error.errors.every(failure => failure.code === 'FELLS_TEST_CLEANUP_TIMEOUT') && error.cause === error.errors[0]);
  } finally { contextReleased.resolve(); browserReleased.resolve(); }
});

test('a rejected close preserves its original error while interception is still blocked', async () => {
  const released = Promise.withResolvers(), failure = new Error('original coverage close failure');
  let shutdowns = 0;
  const close = ownBrowserContext({ unrouteAll: () => released.promise, close() { throw failure; } }, {
    timeoutMs: 20, onFailure: async error => {
      assert.equal(error, failure, 'failure is observed before the cleanup deadline can replace it');
      shutdowns++; released.resolve();
    },
  });
  await assert.rejects(close(), error => error === failure);
  assert.equal(shutdowns, 1);
});
