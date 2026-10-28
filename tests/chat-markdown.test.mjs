import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChatMarkdown } from '../src/lib/chat-markdown.ts';
import { chatProgressWords, chatElapsed } from '../src/i18n/chat-progress.ts';
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
    for (const key of ['pending', 'running', 'unknown', 'completed', 'failed', 'elapsed', 'latest']) assert.ok(words[key]);
    assert.ok(chatSearchWords(language).charges);
  }
  assert.equal(chatElapsed(10_000, 75_000), '1:05');
  assert.equal(chatElapsed(10_000, 5_000), '0:00');
});
