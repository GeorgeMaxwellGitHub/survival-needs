// Tests the button actions against Foundry stubs.
import test from "node:test";
import assert from "node:assert/strict";

const warnings = [];
let picked = null;
globalThis.game = {
  user: { isGM: true },
  settings: { get: () => 10 },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` },
  time: { worldTime: 700 }
};
globalThis.ChatMessage = { create: async () => ({}), getWhisperRecipients: () => [] };
globalThis.ui = { notifications: { warn: (m) => warnings.push(m), error: (m) => warnings.push(m) } };
globalThis.foundry = { applications: { api: { DialogV2: { prompt: async () => picked } } } };

const { runAction } = await import("../scripts/dispatch.mjs");

const actor = () => {
  const log = [];
  return { log, name: "Elwin", flags: {}, statuses: new Set(), items: [], system: { attributes: { exhaustion: 0 } }, update: async (d) => { log.push(d); } };
};

test("eating goes through the item's own use, and the timer restarts when it succeeded", async () => {
  const a = actor();
  let used = 0;
  picked = { item: { name: "Rations", use: async () => { used++; return { message: {} }; } }, removeExhaustion: false };
  await runAction("intake", a, "food");
  assert.equal(used, 1);
  assert.equal(a.log[0]["flags.survival-needs.last.food"], 700);
});

test("a cancelled or failed item use leaves the timer alone", async () => {
  const a = actor();
  picked = { item: { name: "Waterskin", use: async () => undefined }, removeExhaustion: false };
  await runAction("intake", a, "water");
  assert.equal(a.log.length, 0);
});

test("a closed dialog does nothing, and 'no item' just marks the time", async () => {
  const a = actor();
  picked = null;
  await runAction("intake", a, "food");
  assert.equal(a.log.length, 0);
  picked = { item: null, removeExhaustion: false };
  await runAction("intake", a, "food");
  assert.equal(a.log[0]["flags.survival-needs.last.food"], 700);
});

test("players cannot run actions", async () => {
  game.user.isGM = false;
  const a = actor();
  picked = { item: null, removeExhaustion: false };
  await runAction("intake", a, "food");
  game.user.isGM = true;
  assert.equal(a.log.length, 0);
});

test("the rested button opens dnd5e's long rest dialog instead of just marking the time", async () => {
  const a = actor();
  let rests = 0;
  a.longRest = async () => { rests++; return {}; };
  await runAction("rested", a, "rest");
  assert.equal(rests, 1);
  assert.equal(a.log.length, 0, "the timer restarts from dnd5e's restCompleted hook, not here");
});
