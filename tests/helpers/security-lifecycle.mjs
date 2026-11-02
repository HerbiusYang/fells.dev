const cleanupTimeoutCode = 'FELLS_TEST_CLEANUP_TIMEOUT';

export async function cleanupWithTimeout(operation, label, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} did not finish within ${timeoutMs}ms`);
        error.code = cleanupTimeoutCode;
        reject(error);
      }, timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

// The owner must await close() from its after hook, including when abort has
// already started it. The observed abort rejection is never the test verdict.
export function ownBrowserContext(context, { signal, onFailure, timeoutMs = 10000 } = {}) {
  let closing;
  const close = () => {
    if (!closing) closing = cleanupWithTimeout(async () => {
      // Removing interception can itself wait for browser protocol work. Start
      // the real close concurrently so neither operation holds the other open.
      // Resolve context.close at call time to retain the coverage collector.
      const unrouting = Promise.resolve().then(() => context.unrouteAll({ behavior: 'ignoreErrors' }))
        .then(() => ({ status: 'fulfilled' }), reason => ({ status: 'rejected', reason }));
      // Observe interception errors immediately, but do not let a stalled
      // unroute replace an already-rejected close/coverage error with a timeout.
      await Promise.resolve().then(() => context.close());
      const unroute = await unrouting;
      if (unroute.status === 'rejected' && !String(unroute.reason?.message).includes('Target page, context or browser has been closed')) throw unroute.reason;
    }, 'Browser context cleanup', timeoutMs).catch(async error => {
      if (onFailure) {
        try { await onFailure(error); }
        catch (failure) { throw new AggregateError([error, failure], 'Context cleanup and browser shutdown failed', { cause: error }); }
      }
      throw error;
    }).finally(() => signal?.removeEventListener('abort', abort));
    return closing;
  };
  const abort = () => { void close().catch(() => {}); };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return close;
}

// Call from the suite's after hook, after Node has finalized every case and its
// cleanup hooks. A body returning is not evidence that the test passed.
export async function writeSecurityEvidence({ cases, registered, expected, metadata, teardown, persist }) {
  let teardownFailed = false, teardownError;
  try { await teardown(); }
  catch (error) { teardownFailed = true; teardownError = error; }
  const results = cases.map(({ name, context }) => ({ name,
    status: context.passed === true && context.error === null ? 'passed' : 'failed' }));
  const testsPassed = results.filter(result => result.status === 'passed').length;
  const testsFailed = results.filter(result => result.status === 'failed').length;
  const document = { ...metadata,
    status: !teardownFailed && registered === expected && testsPassed === expected && testsFailed === 0 ? 'passed' : 'failed',
    testsPassed, testsFailed, testsSkipped: registered - results.length, results,
    teardown: { status: teardownFailed ? 'failed' : 'passed' } };
  try { await persist(document); }
  finally { if (teardownFailed) throw teardownError; }
  return document;
}
