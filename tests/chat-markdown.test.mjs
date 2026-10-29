import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChatMarkdown } from '../src/lib/chat-markdown.ts';
import { chatProgressWords, chatElapsed, chatRunElapsed } from '../src/i18n/chat-progress.ts';
import { chatSearchWords } from '../src/i18n/chat-search.ts';

test('assistant Markdown supports paragraphs, emphasis, nested lists, code and safe links', () => {
  const html = renderChatMarkdown('**Claude** and *a reply*.\n\n- One\n- Two\n\n3. Third\n4. Fourth\n\n```js\nconst x = "<img>";\n```\n\nUse `code` and [the docs](https://example.test/docs?q=1&v=2).');
  for (const tag of ['<p>', '<strong>Claude</strong>', '<em>a reply</em>', '<ul>', '<ol start="3">', '<li>', '<pre><code>', '<code>code</code>']) assert.ok(html.includes(tag), tag);
  assert.match(html, /&lt;img&gt;/);
  assert.match(html, /href="https:\/\/example\.test\/docs\?q=1&amp;v=2"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
});

for (const attack of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,attack', 'vbscript:attack', 'file:///etc/passwd', 'blob:https://example.test/x', 'javascript&#58;alert(1)', 'javascript&colon;alert(1)']) {
  test(`Markdown does not create an executable link from ${attack}`, () => {
    const html = renderChatMarkdown(`[click](${attack})`);
    assert.doesNotMatch(html, /href="(?:javascript:|data:|vbscript:|file:|blob:)/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1]);
    assert.ok(hrefs.every(href => /^https?:\/\//.test(href)));
  });
}

test('raw HTML and images remain inert text and never emit tracking or DOM-clobbering elements', () => {
  const html = renderChatMarkdown('<script>alert(1)</script>\n\n<img src="https://tracker.test/pixel" onerror="alert(2)">\n\n<svg onload="alert(3)"></svg>\n\n![secret](https://tracker.test/image)\n\n<a id="fx" href="javascript:alert(4)">X</a>');
  assert.doesNotMatch(html, /<(?:script|img|svg|iframe|form|style|a\s+id)\b/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /secret/);
  assert.doesNotMatch(html, /<[^>]+\ssrc=/);
});

test('Markdown links cannot inject quoted attributes and code always stays escaped', () => {
  const html = renderChatMarkdown('[link](https://example.test/\"onclick=\"evil)\n\n`<img onerror=evil>`\n\n```\n</code></pre><script>evil()</script>\n```');
  assert.doesNotMatch(html, /<script|<img|\sonclick="|\sonerror="/);
  assert.match(html, /&lt;\/code&gt;/);
});

test('headings, quotes and explicit breaks stay within the allowed presentation elements', () => {
  const html = renderChatMarkdown('# A heading\n\n> A **quoted** reply\n\n---\n\nFirst  \nSecond');
  for (const tag of ['<h3>A heading</h3>', '<blockquote>', '<strong>quoted</strong>', '<hr>', '<br>']) assert.ok(html.includes(tag), tag);
  assert.doesNotMatch(html, /\sid=|\sstyle=/);
});

test('status copy covers real request phases in every locale and elapsed time is wall time only', () => {
  for (const language of ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'es']) {
    const words = chatProgressWords(language);
    for (const key of ['pending', 'running', 'unknown', 'completed', 'failed', 'elapsed', 'duration', 'latest']) assert.ok(words[key]);
    assert.ok(chatSearchWords(language).charges);
  }
  assert.equal(chatElapsed(10_000, 75_000), '1:05');
  assert.equal(chatElapsed(10_000, 5_000), '0:00');
});

test('only pending and running use a live clock; terminal duration requires both server timestamps', () => {
  for (const status of ['pending', 'running']) {
    assert.deepEqual(chatRunElapsed({ status, started_at: 10_000 }, 75_000), { live: true, startedAt: 10_000, text: '1:05' });
    assert.deepEqual(chatRunElapsed({ status, created: 20_000, updated: 30_000, started_at: 10_000 }, 75_000), { live: true, startedAt: 20_000, text: '0:55' }, 'server start takes precedence while the current wait remains live');
  }
  for (const status of ['unknown', 'failed', 'completed']) {
    const run = { status, created: 10_000, updated: 75_000, started_at: 1_000 };
    const frozen = { live: false, startedAt: 10_000, text: '1:05' };
    assert.deepEqual(chatRunElapsed(run, 300_000), frozen);
    assert.deepEqual(chatRunElapsed(run, 30_000_000), frozen, 'wall time after completion does not extend execution duration');
    for (const metadata of [{}, { created: 10_000 }, { updated: 75_000 }, { created: 10_000, updated: 9_000 }, { created: 0, updated: 75_000 }, { created: 10_000, updated: NaN }, { created: 10_000, updated: 75_000.5 }, { created: '10000', updated: 75_000 }]) {
      assert.equal(chatRunElapsed({ status, started_at: 1_000, ...metadata }, 300_000), null, 'a terminal run never estimates duration from a local marker or malformed metadata');
    }
  }
  assert.equal(chatRunElapsed({ status: 'pending', started_at: 80_000 }, 75_000), null);
  assert.equal(chatRunElapsed({ status: 'unknown', started_at: 10_000 }, 75_000), null);
  assert.doesNotMatch(chatProgressWords('en').unknown, /awaiting|waiting|generating/i);
});


test('assistant comparison tables and task statuses render without executable content', () => {
  const html = renderChatMarkdown('| Model | Price | Status |\n| :--- | ---: | :---: |\n| **A** | `$1` | [docs](https://example.test/a) |\n| <img src=x onerror=evil> | 2 | <script>bad</script> |\n\n~~Retired~~\n\n- [x] Done\n- [ ] Pending');
  for (const tag of ['<table>', '<thead>', '<tbody>', 'scope="col"', 'data-align="right"', 'data-align="center"', '<strong>A</strong>', '<del>Retired</del>', '[x] ', '[ ] ']) assert.ok(html.includes(tag), tag);
  assert.equal((html.match(/<th\b/g) ?? []).length, 3);
  assert.equal((html.match(/<td\b/g) ?? []).length, 6);
  assert.doesNotMatch(html, /<(?:img|script|input|form)\b|<[^>]+\s(?:style|onerror)=/i);
  assert.match(html, /&lt;img/); assert.match(html, /noopener noreferrer nofollow/);
});
