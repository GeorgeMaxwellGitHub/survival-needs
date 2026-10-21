import test from "node:test";
import assert from "node:assert/strict";
import {
  HOUR, cycleOverride, durationParts, escapeHtml, evaluateNeed, exhaustionToAdd, foodLimitDays, guessIntakeKind,
  hoursSince, isExempt, levelRank, planNotification, raceExemptions
} from "../scripts/logic.mjs";

const h = (n) => n * HOUR;

test("food limit is 3 + Con modifier days, at least 1", () => {
  assert.equal(foodLimitDays(0), 3);
  assert.equal(foodLimitDays(2), 5);
  assert.equal(foodLimitDays(-1), 2);
  assert.equal(foodLimitDays(-5), 1);
});

test("hoursSince never goes negative and durationParts splits days", () => {
  assert.equal(hoursSince(h(5), h(2)), 3);
  assert.equal(hoursSince(h(1), h(4)), 0);
  assert.deepEqual(durationParts(51.9), { days: 2, hours: 3, total: 51 });
});

test("food: ok, soon, due after a day, overdue when the Con-based limit is reached", () => {
  const at = (hours, extra = {}) => evaluateNeed("food", { now: h(hours), last: 0, conMod: 1, ...extra });
  assert.equal(at(10).level, "ok");
  assert.equal(at(20).level, "soon");
  assert.equal(at(24).level, "due");
  assert.equal(at(95).level, "due");
  assert.equal(at(96).level, "overdue");
  assert.equal(at(96).pending, 0, "the grace period has just ended: no penalty yet");
  assert.equal(at(120).pending, 1, "one full day past the limit");
  assert.equal(at(144).pending, 2);
  assert.equal(at(144, { applied: 1 }).pending, 1);
  assert.equal(at(144, { applied: 5 }).pending, 0);
});

test("water: due after a day, a penalty for every full day without drinking", () => {
  const at = (hours, applied = 0) => evaluateNeed("water", { now: h(hours), last: 0, applied });
  assert.equal(at(19).level, "ok");
  assert.equal(at(20).level, "soon");
  assert.equal(at(24).level, "due");
  assert.equal(at(24).pending, 1);
  assert.equal(at(48).level, "overdue");
  assert.equal(at(48).pending, 2);
  assert.equal(at(48, 1).pending, 1);
});

test("rest: due after 24 h, then one Con save per further hour", () => {
  const at = (hours, config) => evaluateNeed("rest", { now: h(hours), last: 0, config });
  assert.equal(at(23).level, "soon");
  assert.equal(at(24).level, "due");
  assert.equal(at(24).saves, 0);
  assert.equal(at(25).level, "overdue");
  assert.equal(at(25).saves, 1);
  assert.equal(at(30).saves, 6);
  assert.equal(at(30, { restHours: 36, soonHours: 4 }).level, "ok");
  assert.equal(at(36, { restHours: 36, soonHours: 4 }).level, "due");
});

test("exempt and untracked needs are not evaluated", () => {
  assert.equal(evaluateNeed("food", { now: h(500), last: 0, exempt: true }).level, "exempt");
  assert.equal(evaluateNeed("food", { now: h(500), last: undefined }).level, "untracked");
  assert.equal(levelRank("exempt"), -1);
  assert.ok(levelRank("overdue") > levelRank("due"));
});

test("a clock turned back does not produce negative time", () => {
  const state = evaluateNeed("water", { now: h(1), last: h(10) });
  assert.equal(state.hours, 0);
  assert.equal(state.level, "ok");
});

test("notifications: once when due, again when overdue, again for each new food penalty, never twice", () => {
  const due = { level: "due", pending: 0 };
  const overdue = { level: "overdue", pending: 0 };
  const first = planNotification("food", due, undefined);
  assert.deepEqual(first, { notify: true, key: "due:0" });
  assert.deepEqual(planNotification("food", due, first.key), { notify: false, key: "due:0" });
  const second = planNotification("food", overdue, "due:0");
  assert.deepEqual(second, { notify: true, key: "overdue:0" });
  assert.equal(planNotification("food", { level: "overdue", pending: 1 }, "overdue:0").notify, true);
  assert.equal(planNotification("food", { level: "overdue", pending: 1 }, "overdue:1").notify, false);
});

test("notifications: nothing below due, the stored key is cleared, and rest ignores extra saves", () => {
  assert.deepEqual(planNotification("water", { level: "ok", pending: 0 }, "due:1"), { notify: false, key: null });
  assert.deepEqual(planNotification("water", { level: "soon", pending: 0 }, undefined), { notify: false, key: null });
  assert.deepEqual(planNotification("rest", { level: "overdue", pending: 0, saves: 1 }, undefined), { notify: true, key: "overdue" });
  assert.equal(planNotification("rest", { level: "overdue", pending: 0, saves: 9 }, "overdue").notify, false);
});

test("notifications: when time is turned back the stored key follows without a card", () => {
  assert.deepEqual(planNotification("food", { level: "due", pending: 0 }, "overdue:2"), { notify: false, key: "due:0" });
});

test("exhaustion: water adds two when already exhausted, nothing past level 6", () => {
  assert.equal(exhaustionToAdd("food", 0), 1);
  assert.equal(exhaustionToAdd("water", 0), 1);
  assert.equal(exhaustionToAdd("water", 1), 2);
  assert.equal(exhaustionToAdd("food", 1), 1);
  assert.equal(exhaustionToAdd("water", 5), 1);
  assert.equal(exhaustionToAdd("rest", 6), 0);
});

test("races that need no food or water are recognised in Russian and English", () => {
  assert.deepEqual(raceExemptions(["Кованый"]), { food: true, water: true });
  assert.deepEqual(raceExemptions(["Кованый Мидгарда"]), { food: true, water: true });
  assert.deepEqual(raceExemptions(["Возрождённый"]), { food: true, water: true });
  assert.deepEqual(raceExemptions(["Автогном", "autognome"]), { food: true, water: true });
  assert.deepEqual(raceExemptions(["Warforged"]), { food: true, water: true });
  assert.deepEqual(raceExemptions(["Эльф высший", "high-elf"]), { food: false, water: false });
  assert.deepEqual(raceExemptions([undefined, null]), { food: false, water: false });
});

test("exemption: the GM override wins, rest is never skipped by race", () => {
  const warforged = { food: true, water: true };
  assert.equal(isExempt("food", undefined, warforged), true);
  assert.equal(isExempt("food", false, warforged), false);
  assert.equal(isExempt("water", true, { food: false, water: false }), true);
  assert.equal(isExempt("rest", undefined, warforged), false);
  assert.equal(cycleOverride(undefined), true);
  assert.equal(cycleOverride(true), false);
  assert.equal(cycleOverride(false), undefined);
});

test("items are guessed as water or food by name", () => {
  assert.equal(guessIntakeKind("Бурдюк / Waterskin"), "water");
  assert.equal(guessIntakeKind("Flask of ale"), "water");
  assert.equal(guessIntakeKind("Сухой паёк / Rations"), "food");
  assert.equal(guessIntakeKind("Орехи"), "food");
});

test("escapeHtml neutralises markup in names", () => {
  assert.equal(escapeHtml(`<img onerror="x">&'`), "&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(escapeHtml(undefined), "");
});
