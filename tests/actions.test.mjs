// Tests the actions that change characters against Foundry stubs.
import test from "node:test";
import assert from "node:assert/strict";

const messages = [];
globalThis.game = {
  user: { isGM: true },
  settings: { get: (id, key) => ({ restSaveDc: 10 })[key] },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` },
  time: { worldTime: 500 }
};
globalThis.ChatMessage = { create: async (d) => { messages.push(d); return d; }, getWhisperRecipients: () => [] };
globalThis.ui = { notifications: { warn() {}, error() {} } };

const { applyPenalty, markIntake, toggleOverride, rollSave } = await import("../scripts/actions.mjs");

function actor({ exhaustion = 0, statuses = [], flags = {} } = {}) {
  const log = { updates: [], toggles: [], saves: [] };
  return {
    log, name: "Elwin", flags: { "survival-needs": flags }, statuses: new Set(statuses),
    system: { attributes: { exhaustion }, abilities: { con: { mod: 0 } } },
    update: async (d) => { log.updates.push(d); },
    toggleStatusEffect: async (id, opts) => { log.toggles.push([id, opts]); },
    rollSavingThrow: async (cfg) => { log.saves.push(cfg); }
  };
}

test("hunger penalty: +1 exhaustion, malnutrition status, counters", async () => {
  const a = actor({ exhaustion: 1 });
  await applyPenalty(a, "food");
  assert.deepEqual(a.log.updates[0], {
    "flags.survival-needs.levels.food": 1,
    "flags.survival-needs.applied.food": 1,
    "system.attributes.exhaustion": 2
  });
  assert.deepEqual(a.log.toggles, [["malnutrition", { active: true }]]);
});

test("thirst penalty on an already exhausted character gives two levels", async () => {
  const a = actor({ exhaustion: 1 });
  await applyPenalty(a, "water");
  assert.equal(a.log.updates[0]["system.attributes.exhaustion"], 3);
  assert.deepEqual(a.log.toggles, [["dehydration", { active: true }]]);
});

test("rest penalty gives exhaustion without any status", async () => {
  const a = actor();
  await applyPenalty(a, "rest");
  assert.equal(a.log.updates[0]["system.attributes.exhaustion"], 1);
  assert.equal(a.log.toggles.length, 0);
  assert.ok(!("flags.survival-needs.applied.rest" in a.log.updates[0]));
});

test("the status is not toggled again when the character already has it", async () => {
  const a = actor({ statuses: ["malnutrition"] });
  await applyPenalty(a, "food");
  assert.equal(a.log.toggles.length, 0);
});

test("eating restarts the timer, clears the status and uses up a ration", async () => {
  const a = actor({ statuses: ["malnutrition"] });
  const item = { name: "Rations", system: { quantity: 2, uses: { max: 1, spent: 0 } }, update: async function (d) { this.updated = d; } };
  await markIntake(a, "food", { item });
  assert.deepEqual(item.updated, { "system.quantity": 1, "system.uses.spent": 0 });
  assert.equal(a.log.updates[0]["flags.survival-needs.last.food"], 500);
  assert.equal(a.log.updates[0]["flags.survival-needs.applied.food"], 0);
  assert.equal(a.log.updates[0]["flags.survival-needs.notified.-=food"], null);
  assert.deepEqual(a.log.toggles, [["malnutrition", { active: false }]]);
  assert.match(messages.at(-1).content, /AteItem/);
});

test("eating can take back one exhaustion level the module gave for hunger, but never more than it gave", async () => {
  const a = actor({ exhaustion: 3, flags: { levels: { food: 1 } } });
  await markIntake(a, "food", { removeExhaustion: true });
  assert.equal(a.log.updates[0]["system.attributes.exhaustion"], 2);
  assert.equal(a.log.updates[0]["flags.survival-needs.levels.food"], 0);

  const b = actor({ exhaustion: 3, flags: { levels: { food: 0 } } });
  await markIntake(b, "food", { removeExhaustion: true });
  assert.ok(!("system.attributes.exhaustion" in b.log.updates[0]));
});

test("the override toggle cycles automatic, not needed, needed, automatic", async () => {
  const a = actor();
  await toggleOverride(a, "food");
  assert.deepEqual(a.log.updates[0], { "flags.survival-needs.override.food": true });
  const b = actor({ flags: { override: { food: true } } });
  await toggleOverride(b, "food");
  assert.deepEqual(b.log.updates[0], { "flags.survival-needs.override.food": false });
  const c = actor({ flags: { override: { food: false } } });
  await toggleOverride(c, "food");
  assert.deepEqual(c.log.updates[0], { "flags.survival-needs.override.-=food": null });
});

test("saves use DC 15 for water and the configured DC for rest", async () => {
  const a = actor();
  await rollSave(a, "water");
  await rollSave(a, "rest");
  assert.deepEqual(a.log.saves, [{ ability: "con", target: 15 }, { ability: "con", target: 10 }]);
});
