// Smoke-tests the dashboard rendering with a minimal DOM and Foundry stubs.
import test from "node:test";
import assert from "node:assert/strict";

class Node_ {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ""; this._text = ""; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? "").join(""); }
}
globalThis.document = { createElement: (tag) => new Node_(tag) };

class FakeApp { constructor() { this.rendered = false; } async render() { this.rendered = true; this.html = await this._renderHTML(); this.content = new Node_("div"); this._replaceHTML(this.html, this.content); } async close() {} }
globalThis.foundry = { applications: { api: { ApplicationV2: FakeApp } } };

const actor = (id, name, flags = {}, extra = {}) => ({
  id, name, img: "a.png", type: "character", flags: { "survival-needs": flags }, sheet: { render() {} },
  system: { attributes: { exhaustion: 2 }, abilities: { con: { mod: 0 } }, details: {} }, ...extra
});
const members = [actor("1", "<b>Elwin</b>", { last: { food: 0, water: 0, rest: 0 } }), actor("2", "Brin", { last: { food: 80 * 3600, water: 80 * 3600, rest: 80 * 3600 } })];
globalThis.game = {
  settings: { get: (id, key) => ({ soonHours: 4, restHours: 24, restSaveDc: 10 })[key] },
  i18n: { localize: (k) => k, format: (k, d) => k + (d ? JSON.stringify(d) : "") },
  time: { worldTime: 100 * 3600 },
  actors: { party: { name: "The Party", system: { playerCharacters: members } }, get: (id) => members.find((m) => m.id === id) }
};

const { buildBoard, openDashboard } = await import("../scripts/dashboard.mjs");

const walk = (node, fn) => { fn(node); for (const c of node.children ?? []) walk(c, fn); };
const collect = (node, pred) => { const out = []; walk(node, (n) => { if (pred(n)) out.push(n); }); return out; };

test("the board has a header row and a row per party member, each with three need cells", () => {
  const board = buildBoard(game.time.worldTime);
  const rows = board.children.filter((c) => c.className === "survival-needs-row");
  assert.equal(rows.length, 2);
  assert.equal(collect(board, (n) => /survival-needs-cell/.test(n.className)).length, 6);
});

test("levels show in the cells: 100 h without anything is overdue for Elwin, 20 h is soon for Brin", () => {
  const board = buildBoard(game.time.worldTime);
  const levels = collect(board, (n) => /survival-needs-cell/.test(n.className)).map((n) => n.className.match(/level-(\w+)/)[1]);
  assert.deepEqual(levels, ["overdue", "overdue", "overdue", "soon", "soon", "soon"]);
});

test("action buttons per need: food has no save button, water and rest do", () => {
  const board = buildBoard(game.time.worldTime);
  const kinds = (need) => collect(board, (n) => n.attrs?.["data-sn"] && n.attrs["data-need"] === need && n.attrs["data-actor-id"] === "1").map((n) => n.attrs["data-sn"]);
  assert.deepEqual(kinds("food"), ["intake", "penalty", "toggle"]);
  assert.deepEqual(kinds("water"), ["intake", "save", "penalty", "toggle"]);
  assert.deepEqual(kinds("rest"), ["rested", "save", "penalty", "toggle"]);
});

test("character names are text, never markup", () => {
  const board = buildBoard(game.time.worldTime);
  const names = collect(board, (n) => n.tag === "strong");
  assert.equal(names[0]._text, "<b>Elwin</b>");
});

test("exempt needs show only the override toggle", () => {
  members[0].flags["survival-needs"].override = { food: true };
  const board = buildBoard(game.time.worldTime);
  const kinds = collect(board, (n) => n.attrs?.["data-sn"] && n.attrs["data-need"] === "food" && n.attrs["data-actor-id"] === "1").map((n) => n.attrs["data-sn"]);
  assert.deepEqual(kinds, ["toggle"]);
});

test("the dashboard opens", async () => {
  await openDashboard();
});
