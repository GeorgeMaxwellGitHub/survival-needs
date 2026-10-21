// Tests the module hooks against Foundry stubs (Foundry itself is not started).
import test from "node:test";
import assert from "node:assert/strict";

const handlers = new Map();
const settings = { enabled: true, postCards: true, soonHours: 4, restHours: 24, restSaveDc: 10 };
const messages = [];
const updates = [];

globalThis.Hooks = {
  once: (name, fn) => handlers.set(`once:${name}`, fn),
  on: (name, fn) => handlers.set(name, fn)
};

const world = { time: 0 };
const state = { activeGm: "gm1", party: null };
globalThis.game = {
  user: { id: "gm1", isGM: true },
  users: { get activeGM() { return { id: state.activeGm }; } },
  modules: new Map(),
  settings: { register() {}, get: (id, key) => settings[key] },
  i18n: { localize: (k) => k, format: (k, d) => `${k} ${JSON.stringify(d ?? {})}` },
  time: { get worldTime() { return world.time; } },
  actors: { get party() { return state.party; }, get: (id) => state.party?.system.playerCharacters.find((a) => a.id === id), [Symbol.iterator]: function* () {} }
};
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.ChatMessage = {
  create: async (data) => { messages.push(data); return data; },
  getWhisperRecipients: () => [{ id: "gm1" }]
};
globalThis.foundry = {};

await import("../scripts/survival-needs.mjs");

const HOUR = 3600;
function makeActor(id, name, { race = null } = {}) {
  const actor = {
    id, name, uuid: `Actor.${id}`, type: "character", flags: {}, statuses: new Set(),
    system: { attributes: { exhaustion: 0 }, abilities: { con: { mod: 0 } }, details: { race } },
    update: async (data) => {
      updates.push([id, data]);
      for (const [path, value] of Object.entries(data)) {
        const parts = path.split(".");
        let o = actor;
        for (const p of parts.slice(0, -1)) o = o[p] ??= {};
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else o[last] = value;
      }
    }
  };
  return actor;
}
const setParty = (...actors) => { state.party = { name: "Party", system: { playerCharacters: actors } }; };

test("a tracked character starts its timers at the current game time, with no cards", async () => {
  messages.length = 0;
  const a = makeActor("a1", "Elwin");
  setParty(a);
  world.time = 1000 * HOUR;
  await import("../scripts/survival-needs.mjs");
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  assert.deepEqual(a.flags["survival-needs"].last, { food: 1000 * HOUR, water: 1000 * HOUR, rest: 1000 * HOUR });
  assert.equal(messages.length, 0);
});

test("a card is whispered to the GM once when food comes due, and not again on the next tick", async () => {
  messages.length = 0;
  const a = makeActor("a2", "Brin");
  a.flags["survival-needs"] = { last: { food: 0, water: 23 * HOUR, rest: 23 * HOUR } };
  setParty(a);
  world.time = 24 * HOUR;
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].whisper, ["gm1"]);
  assert.deepEqual(messages[0].flags["survival-needs"].card, { actorId: "a2", need: "food" });
  assert.match(messages[0].content, /data-sn-action="intake"/);
  assert.match(messages[0].content, /data-sn-action="penalty"/);
  assert.doesNotMatch(messages[0].content, /data-sn-action="(save|announce)"/);
  assert.match(messages[0].content, /@UUID\[Actor\.a2\]\{Brin\}/);
  assert.match(messages[0].content, /Card\.LimitLeft.*\{\\"d\\":2,\\"h\\":0\}/);
  assert.doesNotMatch(messages[0].content, /<h3/);
  await tick();
  assert.equal(messages.length, 1);
  assert.equal(a.flags["survival-needs"].notified.food, "due:0");
});

test("an overdue food card shows the owed exhaustion in red and that the limit has run out", async () => {
  messages.length = 0;
  const a = makeActor("a7", "Fen");
  a.flags["survival-needs"] = { last: { food: 0, water: 96 * HOUR, rest: 96 * HOUR } };
  setParty(a);
  world.time = 96 * HOUR;
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  const food = messages.find((m) => m.flags["survival-needs"].card.need === "food");
  assert.match(food.content, /survival-needs-owed/);
  assert.match(food.content, /Card\.LimitReached/);
});

test("names are escaped in the card", async () => {
  messages.length = 0;
  const a = makeActor("a3", "<b>Evil</b>");
  a.flags["survival-needs"] = { last: { food: 0, water: 24 * HOUR, rest: 24 * HOUR } };
  setParty(a);
  world.time = 24 * HOUR;
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  assert.ok(!messages[0].content.includes("<b>Evil"));
  assert.ok(messages[0].content.includes("@UUID[Actor.a3]{&lt;b&gt;Evil&lt;/b&gt;}"));
});

test("a race that needs no food or water gets no food or water cards but still needs rest", async () => {
  messages.length = 0;
  const a = makeActor("a4", "Gear", { race: { name: "Кованый", system: { identifier: "warforged" } } });
  a.flags["survival-needs"] = { last: { food: 0, water: 0, rest: 0 } };
  setParty(a);
  world.time = 30 * HOUR;
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  assert.deepEqual(messages.map((m) => m.flags["survival-needs"].card.need), ["rest"]);
});

test("only the active GM posts cards", async () => {
  messages.length = 0;
  const a = makeActor("a5", "Cora");
  a.flags["survival-needs"] = { last: { food: 0, water: 0, rest: 0 } };
  setParty(a);
  world.time = 30 * HOUR;
  state.activeGm = "gm2";
  const { tick } = await import("../scripts/survival-needs.mjs");
  await tick();
  state.activeGm = "gm1";
  assert.equal(messages.length, 0);
});

test("finishing a long rest restarts the rest timer; a short rest does not", () => {
  const a = makeActor("a6", "Dov");
  a.flags["survival-needs"] = { last: { rest: 0 }, levels: { rest: 1 }, notified: { rest: "overdue" } };
  world.time = 40 * HOUR;
  const hook = handlers.get("dnd5e.restCompleted");
  hook(a, { longRest: false }, { type: "short" });
  assert.equal(a.flags["survival-needs"].last.rest, 0);
  hook(a, { longRest: true }, { type: "long" });
  return new Promise((resolve) => setImmediate(() => {
    assert.equal(a.flags["survival-needs"].last.rest, 40 * HOUR);
    assert.equal(a.flags["survival-needs"].notified?.rest, undefined);
    resolve();
  }));
});

test("card buttons are bound once and only for the GM", () => {
  const listeners = [];
  const button = { dataset: { snAction: "penalty" }, addEventListener: (type, fn) => listeners.push([type, fn]) };
  const html = { querySelectorAll: () => [button] };
  const message = { flags: { "survival-needs": { card: { actorId: "a1", need: "food" } } } };
  const hook = handlers.get("renderChatMessageHTML");
  hook(message, html);
  hook(message, html);
  assert.equal(listeners.length, 1);
  game.user.isGM = false;
  const other = { dataset: { snAction: "penalty" }, addEventListener: () => assert.fail("bound for a player") };
  hook(message, { querySelectorAll: () => [other] });
  game.user.isGM = true;
});

test("the scene control button and the group sheet entry are GM-only", () => {
  const controls = { tokens: { tools: {} } };
  handlers.get("getSceneControlButtons")(controls);
  assert.ok(controls.tokens.tools["survival-needs-dashboard"]);

  const menu = [];
  handlers.get("getHeaderControlsApplicationV2")({ document: { documentName: "Actor", type: "group" } }, menu);
  assert.equal(menu.length, 1);
  handlers.get("getHeaderControlsApplicationV2")({ document: { documentName: "Actor", type: "group" } }, menu);
  assert.equal(menu.length, 1);
  handlers.get("getHeaderControlsApplicationV2")({ document: { documentName: "Actor", type: "character" } }, menu);
  assert.equal(menu.length, 1);
});
