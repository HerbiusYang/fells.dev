import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { splitThemeDocument, resolveThemeAssets } from "../src/lib/theme-document.ts";

test("theme documents retain their language, styles and inline interactions", () => {
  for (const theme of ["synara", "apple-launch"]) {
    const source = readFileSync(new URL(`../templates/${theme}/index.html`, import.meta.url), "utf8");
    const parts = splitThemeDocument(source);
    assert.ok(parts.head.includes("<style>"));
    assert.ok(parts.body.includes("<script>"));
    assert.ok(parts.body.includes("<main"));
    assert.ok(parts.lang);
  }
});

test("invalid theme documents fail rather than generating empty previews", () => {
  assert.throws(() => splitThemeDocument("<head></head>"), /head and a body/);
  assert.deepEqual(splitThemeDocument("<html lang='ja'><head></head><body>Preview</body></html>"), { head: "", body: "Preview", lang: "ja" });
});

test("standalone theme inline scripts remain valid JavaScript", () => {
  for (const theme of ["synara", "apple-launch"]) {
    const source = readFileSync(new URL(`../templates/${theme}/index.html`, import.meta.url), "utf8");
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length);
    for (const [, code] of scripts) assert.doesNotThrow(() => new Script(code));
  }
});

test("theme fragment links point to existing sections", () => {
  for (const theme of ["synara", "apple-launch"]) {
    const source = readFileSync(new URL(`../templates/${theme}/index.html`, import.meta.url), "utf8");
    const ids = new Set([...source.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
    for (const [, fragment] of source.matchAll(/href=["']#([^"']+)["']/g)) {
      assert.ok(ids.has(fragment), `${theme} has no section for #${fragment}`);
    }
  }
});

test("all Apple image references resolve to build-managed assets", () => {
  const source = readFileSync(new URL("../templates/apple-launch/index.html", import.meta.url), "utf8");
  const names = [...new Set([...source.matchAll(/\bassets\/([\w-]+\.webp)\b/g)].map((match) => match[1]))];
  const assets = Object.fromEntries(names.map((name) => {
    assert.ok(readFileSync(new URL(`../templates/apple-launch/assets/${name}`, import.meta.url)).length);
    return [name, `/_astro/${name}`];
  }));
  const resolved = resolveThemeAssets(source, assets);
  assert.equal(/\bassets\/[\w-]+\.webp\b/.test(resolved), false);
  for (const url of Object.values(assets)) assert.ok(resolved.includes(url));
  assert.throws(() => resolveThemeAssets(source, {}), /Missing theme asset/);
});
