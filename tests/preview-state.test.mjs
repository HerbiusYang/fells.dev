import test from "node:test";
import assert from "node:assert/strict";
import { freshState, validateState, InvalidState, StateTooLarge, MAX_MESSAGE } from "../src/lib/preview-state.ts";

const fixture = () => ({ ...freshState(5), current: "ws-1", workspaces: [{ id: "ws-1", name: "Demo", region: "us-west", tz: "UTC", created: Date.now() }] });
const chat = () => ({ id: "chat-1", ws: "ws-1", title: "Demo", agent: "codex", model: "Sample", created: Date.now(), messages: [["you", "Hello"]] });

test("all supported state fields round trip, independently of the caller", () => {
  const state = fixture();
  state.chats.push(chat());
  state.files.push({ id: "folder-1", ws: "ws-1", parent: "", name: "Source", folder: true, size: 0, modified: Date.now() });
  state.schedules.push({ id: "job-1", ws: "ws-1", name: "Demo", prompt: "Review", agent: "codex", cadence: 2, time: "09:00", paused: true });
  state.keys.push({ id: "key-1", name: "Demo", limit: 10, created: Date.now(), last4: "abcd" });
  state.profile.avatar = "data:image/jpeg;base64,YQ==";
  const result = validateState(state);
  assert.deepEqual(result, state);
  result.chats[0].messages[0][1] = "Changed";
  assert.equal(state.chats[0].messages[0][1], "Hello");
});

test("environment secrets and unknown/prototype fields cannot enter persisted output", () => {
  const state = JSON.parse(JSON.stringify(fixture()).replace('"onboarded":false', '"onboarded":false,"__proto__":{"polluted":true}'));
  state.env = { "ws-1": [["TOKEN", "dummy-secret"]] };
  state.profile.token = "dummy-secret";
  const result = validateState(state);
  assert.equal(JSON.stringify(result).includes("dummy-secret"), false);
  assert.equal(Object.hasOwn(result, "__proto__"), false);
  assert.equal({}.polluted, undefined);
});

test("attribute-breaking IDs and reserved object keys are rejected in every collection", () => {
  for (const id of ['x"><img src=x onerror=alert(1)>', "__proto__", "constructor", "prototype", "x/y", ""]) {
    for (const collection of ["workspaces", "chats", "files", "schedules", "keys"]) {
      const state = fixture();
      if (collection === "workspaces") state.workspaces[0].id = id;
      else state[collection].push({ ...chat(), id });
      assert.throws(() => validateState(state), InvalidState, `${collection}: ${id}`);
    }
  }
});

test("invalid nested values, dates, references and duplicate IDs fail closed", () => {
  for (const modify of [
    s => s.profile = null, s => s.theme = '" onmouseover="alert(1)', s => s.profile.avatar = "https://example.invalid/tracker",
    s => s.profile.avatar = "data:image/svg+xml,<svg/>", s => s.credits.bonus = Infinity,
    s => s.workspaces[0].tz = "Not/AZone", s => s.workspaces[0].created = 9e15,
    s => s.workspaces.push(s.workspaces[0]), s => s.current = "missing", s => s.answers = [],
    s => s.chats.push({ ...chat(), ws: "missing" }), s => s.chats.push({ ...chat(), messages: [null] }),
  ]) {
    const state = fixture(); modify(state);
    assert.throws(() => validateState(state), InvalidState);
  }
});

test("folder cycles and cross-workspace references cannot hang the renderer", () => {
  for (const parent of ["folder-1", "missing"]) {
    const state = fixture();
    state.files.push({ id: "folder-1", ws: "ws-1", parent, name: "Bad", folder: true, size: 0, modified: Date.now() });
    assert.throws(() => validateState(state), InvalidState);
  }
});

test("individual and aggregate input limits reject data before writing", () => {
  const state = fixture();
  state.chats.push({ ...chat(), messages: [["you", "x".repeat(MAX_MESSAGE + 1)]] });
  assert.throws(() => validateState(state), InvalidState);
  state.chats[0].messages = Array.from({ length: 40 }, () => ["you", "x".repeat(MAX_MESSAGE)]);
  assert.throws(() => validateState(state), StateTooLarge);
});
