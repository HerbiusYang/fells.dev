// Browser-generated HTTP/CSP diagnostics are distinct from an application's
// explicit console.error calls. Keep both so an expected 401 cannot hide one.
export async function observeSecurity(context) {
  const applicationErrors = [], pageErrors = [], browserErrors = [], violations = [], responses = [];
  await context.exposeBinding('__fellsTestConsoleError', (_source, values) => { applicationErrors.push(values); });
  await context.exposeBinding('__fellsTestCSPViolation', (_source, value) => { violations.push(value); });
  await context.addInitScript(() => {
    const original = console.error.bind(console);
    console.error = (...values) => {
      void window.__fellsTestConsoleError(values.map(value => String(value)));
      original(...values);
    };
    window.__fellsTestCSPViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      const value = { blockedURI: event.blockedURI, directive: event.effectiveDirective, disposition: event.disposition };
      window.__fellsTestCSPViolations.push(value);
      void window.__fellsTestCSPViolation(value);
    });
  });
  context.on('page', page => {
    page.on('pageerror', error => { pageErrors.push(error.message); });
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push({ text: message.text(), url: message.location().url });
    });
    page.on('response', response => {
      if (new URL(response.url()).pathname.startsWith('/api/')) responses.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
        cacheControl: response.headers()['cache-control'],
      });
    });
  });
  return { applicationErrors, pageErrors, browserErrors, violations, responses };
}

export function unexpectedBrowserErrors(errors, base, expectedUnauthorized = ['/api/app/bootstrap']) {
  return errors.filter(error => {
    // Exact resource URL plus exact HTTP status: never suppress application
    // errors, arbitrary 401s, 5xx responses or unrelated missing resources.
    const expectedURL = expectedUnauthorized.some(path => error.url === new URL(path, base).href);
    return !(expectedURL && /^Failed to load resource: the server responded with a status of 401\b/.test(error.text));
  });
}
