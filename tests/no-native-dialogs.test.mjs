import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import ts from 'typescript';

const nativeNames = new Set(['alert', 'confirm', 'prompt']);
const browserGlobals = new Set(['window', 'globalThis', 'self']);

function isBrowserGlobal(node) {
  if (ts.isIdentifier(node)) return browserGlobals.has(node.text);
  return ts.isPropertyAccessExpression(node) && isBrowserGlobal(node.expression)
    && browserGlobals.has(node.name.text);
}

function nativeCall(node) {
  if (ts.isIdentifier(node)) return nativeNames.has(node.text);
  if (ts.isPropertyAccessExpression(node)) return isBrowserGlobal(node.expression) && nativeNames.has(node.name.text);
  return ts.isElementAccessExpression(node) && isBrowserGlobal(node.expression)
    && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)
    && nativeNames.has(node.argumentExpression.text);
}

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile() && ['.ts', '.tsx', '.js', '.mjs', '.astro', '.html'].includes(extname(path))) result.push(path);
  }
  return result;
}

test('shipped web scripts contain no browser-native alert, confirm or prompt calls', async () => {
  const violations = [];
  for (const path of [...await files('src'), ...await files('public')]) {
    const text = await readFile(path, 'utf8');
    const blocks = /\.(?:astro|html)$/.test(path)
      ? [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(match => !/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(match[1])).map(match => match[2])
      : [text];
    for (const block of blocks) {
      const source = ts.createSourceFile(path, block, ts.ScriptTarget.Latest, true,
        extname(path) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      function visit(node) {
        if (ts.isCallExpression(node) && nativeCall(node.expression)) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          violations.push(`${path}:${position.line + 1}: ${node.expression.getText(source)}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.deepEqual(violations, []);
});
