// Tests the item dialog's answer, reading it from a form that behaves like a real HTMLFormElement.
import test from "node:test";
import assert from "node:assert/strict";

let config = null;
globalThis.game = { i18n: { localize: (k) => k, format: (k) => k } };
globalThis.foundry = { applications: { api: { DialogV2: { prompt: async (c) => { config = c; return "shown"; } } } } };

const { pickIntake, intakeCandidates } = await import("../scripts/dialog.mjs");

const item = (id, name, extra = {}) => ({ id, name, img: "i.png", type: "consumable", system: { type: { value: "food" }, quantity: 3, uses: { max: 1, value: 1 } }, ...extra });
const actor = (items) => ({ name: "Elwin", items: { get: (id) => items.find((i) => i.id === id), [Symbol.iterator]: () => items[Symbol.iterator]() } });

// A real form's `elements` collection has its own item() method, so elements.item is a function, not a field.
const formWith = (fields) => ({ elements: { item() { return null; }, namedItem: (name) => fields[name] ?? null } });

test("the chosen item is read from the form (a field named 'item' would be shadowed by elements.item())", async () => {
  const items = [item("w1", "Бурдюк / Waterskin"), item("r1", "Сухой паёк / Rations")];
  await pickIntake(actor(items), "water");
  const answer = config.ok.callback({}, { form: formWith({ intake: { value: "w1" }, remove: { checked: true } }) });
  assert.equal(answer.item, items[0]);
  assert.equal(answer.removeExhaustion, true);
  assert.match(config.content, /name="intake"/);
  assert.doesNotMatch(config.content, /name="item"/);
});

test("'No item' and a missing form field both give no item", async () => {
  await pickIntake(actor([item("w1", "Waterskin")]), "water");
  assert.equal(config.ok.callback({}, { form: formWith({ intake: { value: "" } }) }).item, null);
  assert.equal(config.ok.callback({}, { form: formWith({}) }).item, null);
});

test("items matching the need come first and the first of them is preselected", async () => {
  const items = [item("r1", "Rations"), item("w1", "Waterskin")];
  assert.deepEqual(intakeCandidates(actor(items), "water").map((r) => r.item.id), ["w1", "r1"]);
  await pickIntake(actor(items), "water");
  assert.match(config.content, /value="w1" checked/);
});

test("names in the list are escaped and non-food items are left out", async () => {
  const items = [item("x", "<b>Bad</b>"), item("y", "Sword", { type: "weapon" })];
  await pickIntake(actor(items), "food");
  assert.ok(!config.content.includes("<b>Bad"));
  assert.ok(!config.content.includes("Sword"));
});
