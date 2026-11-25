import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const locales = ['', '/zh', '/zh-hant', '/ja', '/ko', '/es'];

// Static hosts apply every matching _headers rule; a splat matches any characters
// and duplicate header names are joined with a comma.
function staticHeaders(text, path) {
  const rules = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (!line.startsWith(' ')) { rules.push({ pattern: line.trim(), headers: [] }); continue; }
    const field = /^ {2}([A-Za-z-]+): (.+)$/.exec(line);
    assert.ok(field, `plain "Name: value" header line: ${JSON.stringify(line)}`);
    rules.at(-1).headers.push([field[1], field[2]]);
  }
  const headers = {};
  for (const rule of rules) {
    const pattern = new RegExp('^' + rule.pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    if (!pattern.test(path)) continue;
    for (const [name, value] of rule.headers) headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

test('private documents are never stored by a cache and every response limits powerful features', () => {
  const text = read('public/_headers');
  for (const prefix of locales) for (const section of ['app', 'checkout', 'support']) for (const rest of ['/', '/start/', '/desk/']) {
    const path = `${prefix}/${section}${rest}`;
    const cache = staticHeaders(text, path)['Cache-Control'] ?? '';
    assert.ok(cache.split(',').map(value => value.trim()).includes('no-store'), `${path}: ${cache}`);
  }
  for (const path of ['/', '/zh/', '/market/', '/zh/market/', '/blog/post/', '/developer-api/', '/es/apps/', '/supporters/']) {
    assert.doesNotMatch(staticHeaders(text, path)['Cache-Control'] ?? '', /no-store/, path);
  }
  for (const path of ['/', '/app/', '/_astro/app.js', '/favicon.svg']) {
    assert.equal(staticHeaders(text, path)['Permissions-Policy'], 'camera=(), microphone=(), geolocation=()', path);
  }
  assert.equal(staticHeaders(text, '/_astro/app.js')['Cache-Control'], undefined, 'hashed assets keep the host default');
});

test('Nginx public-host templates return 404 for every fixed support page path, matching the edge Worker', () => {
  const worker = /const operatorPath = path => \/(.+)\/\.test\(path\);/.exec(read('edge/maintenance/worker.mjs'))[1].replace(/\\\//g, '/');
  for (const template of ['deploy/nginx-ip-http.conf', 'deploy/nginx-ip-https.conf']) {
    const config = read(template);
    const location = /^ {4}location ~ (\S+) \{ return 404; \}$/m.exec(config);
    assert.ok(location, template);
    assert.equal(location[1], worker, `${template} uses the Worker's operator path rule`);
    const site = config.indexOf('    location / { try_files');
    assert.ok(site > 0 && config.indexOf(location[0]) < site && config.lastIndexOf('server {', config.indexOf(location[0])) === config.lastIndexOf('server {', site), `${template} declares the rule in the site server block`);
    const pattern = new RegExp(location[1]);
    for (const path of ['/support', '/support/', '/support/desk/', '/zh/support/desk/', '/zh-hant/support', '/ja/support/', '/ko/support/desk/', '/es/support/x']) assert.ok(pattern.test(path), path);
    for (const path of ['/api/support', '/api/support/session', '/supporters/', '/zh/supportive/', '/app/support/', '/fr/support/']) assert.ok(!pattern.test(path), path);
  }
});

test('frontend CI uses actions pinned to full commit SHAs', () => {
  const uses = [...read('.github/workflows/frontend.yml').matchAll(/^\s*(?:- )?uses: (\S+)(.*)$/gm)];
  assert.ok(uses.length >= 4);
  for (const [, action, comment] of uses) {
    assert.match(action, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, action);
    assert.match(comment, /^ # v\d+\.\d+\.\d+$/, `${action} records its released version`);
  }
});
