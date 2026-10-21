/**
 * Pure module logic with no Foundry calls, so it can be unit-tested.
 * Times are in seconds of game time (game.time.worldTime); the durations the rules talk about are in hours.
 */

export const NEEDS = ["food", "water", "rest"];
export const HOUR = 3600;
export const DAY_HOURS = 24;
/** Constitution save DC for drinking only half the daily water ration. */
export const WATER_SAVE_DC = 15;
export const MAX_EXHAUSTION = 6;

export const DEFAULT_CONFIG = Object.freeze({ soonHours: 4, restHours: 24, restSaveDc: 10 });

const RANK = { untracked: -1, exempt: -1, ok: 0, soon: 1, due: 2, overdue: 3 };

/** Numeric severity of a level (untracked and exempt count as "nothing to report"). */
export function levelRank(level) {
  return RANK[level] ?? -1;
}

/** Days a character can go without food: Constitution modifier + 3, at least 1. */
export function foodLimitDays(conMod) {
  return Math.max(1, 3 + (Number(conMod) || 0));
}

/** Hours between two game times; never negative (the clock can be turned back). */
export function hoursSince(now, then) {
  return Math.max(0, (Number(now) - Number(then)) / HOUR);
}

/** Splits a duration into whole days and hours for display. */
export function durationParts(hours) {
  const total = Math.max(0, Math.floor(Number(hours) || 0));
  return { days: Math.floor(total / DAY_HOURS), hours: total % DAY_HOURS, total };
}

/**
 * Works out how far one need is overdue.
 *
 * food:  reminder after a day without food; the Constitution-based grace period (3 + Con modifier days) ends at
 *        "overdue"; after it every further full day is one exhaustion level.
 * water: reminder after a day without drinking; every full day without drinking is one exhaustion level
 *        (drinking less than half the ration is an automatic level, half the ration is a DC 15 Con save).
 * rest:  reminder after `restHours` without a long rest; every further full hour is a Con save.
 *
 * @param {"food"|"water"|"rest"} need
 * @param {object} data
 * @param {number} data.now
 * @param {number|undefined} data.last        Game time of the last meal / drink / long rest.
 * @param {number} [data.conMod]
 * @param {number} [data.applied]             Penalties already applied since the last meal / drink (food, water).
 * @param {boolean} [data.exempt]
 * @param {{soonHours:number, restHours:number}} [data.config]
 * @returns {{need: string, level: string, hours: number, pending: number, saves: number}}
 *   pending: penalties due and not yet applied (food, water); saves: hourly saves owed (rest).
 */
export function evaluateNeed(need, { now, last, conMod = 0, applied = 0, exempt = false, config = DEFAULT_CONFIG } = {}) {
  const base = { need, level: "ok", hours: 0, pending: 0, saves: 0 };
  if (exempt) return { ...base, level: "exempt" };
  if (!Number.isFinite(last)) return { ...base, level: "untracked" };

  const cfg = { ...DEFAULT_CONFIG, ...config };
  const hours = hoursSince(now, last);
  const result = { ...base, hours };
  const dueAt = need === "rest" ? cfg.restHours : DAY_HOURS;
  let overdueAt;
  if (need === "food") overdueAt = foodLimitDays(conMod) * DAY_HOURS;
  else if (need === "water") overdueAt = 2 * DAY_HOURS;
  else overdueAt = cfg.restHours + 1;

  if (hours >= overdueAt) result.level = "overdue";
  else if (hours >= dueAt) result.level = "due";
  else if (hours >= dueAt - cfg.soonHours) result.level = "soon";

  const days = Math.floor(hours / DAY_HOURS);
  if (need === "food") result.pending = Math.max(0, days - foodLimitDays(conMod) - applied);
  else if (need === "water") result.pending = Math.max(0, days - applied);
  else result.saves = Math.max(0, Math.floor(hours - cfg.restHours));
  return result;
}

/** Hours a need can go before it is overdue: the food limit (3 + Con days), a day of water, the rest limit. */
export function graceHours(need, { conMod = 0, config = DEFAULT_CONFIG } = {}) {
  if (need === "food") return foodLimitDays(conMod) * DAY_HOURS;
  if (need === "water") return DAY_HOURS;
  return { ...DEFAULT_CONFIG, ...config }.restHours;
}

/**
 * What the dashboard's fill bar shows for a need.
 * Within the grace period the bar fills once, from green through yellow to red. Past it the bar starts over and
 * fills once per day in red-orange, a shade darker for every full day already overdue.
 * @param {"food"|"water"|"rest"} need
 * @param {{level: string, hours: number}} state  Result of evaluateNeed.
 * @param {{conMod?: number, config?: object}} [options]
 * @returns {{phase: "grace"|"over", fill: number, hue: number, sat: number, light: number}|null}  null: no bar.
 */
export function needMeter(need, state, options = {}) {
  if (state.level === "exempt" || state.level === "untracked") return null;
  const grace = graceHours(need, options);
  const hours = Math.max(0, state.hours);
  if (hours < grace) {
    const fill = hours / grace;
    return { phase: "grace", fill, hue: Math.round(120 * (1 - fill)), sat: 65, light: 42 };
  }
  const over = hours - grace;
  const cycle = (over % DAY_HOURS) / DAY_HOURS;
  const days = Math.floor(over / DAY_HOURS);
  return { phase: "over", fill: Math.max(0.04, cycle), hue: Math.round(25 * (1 - cycle)), sat: 80, light: Math.max(28, 44 - 6 * Math.min(days, 3)) };
}

function parseKey(key) {
  if (!key) return null;
  const [level, pending] = String(key).split(":");
  return { rank: levelRank(level), pending: Number(pending) || 0 };
}

/**
 * Decides whether a chat card is needed for a need that has just been evaluated.
 * A card is posted once when the need becomes due, again when it becomes overdue, and (food, water) again for every
 * further penalty. The returned key is stored on the actor so the same state is never announced twice.
 * @param {"food"|"water"|"rest"} need
 * @param {{level: string, pending: number}} state  Result of evaluateNeed.
 * @param {string|undefined} notified               Key stored from the previous time.
 * @returns {{notify: boolean, key: string|null}}   key null: clear the stored key.
 */
export function planNotification(need, state, notified) {
  const rank = levelRank(state.level);
  if (rank < RANK.due) return { notify: false, key: null };
  const key = need === "rest" ? state.level : `${state.level}:${state.pending}`;
  const prev = parseKey(notified);
  if (!prev) return { notify: true, key };
  if (rank > prev.rank || (need !== "rest" && rank === prev.rank && state.pending > prev.pending)) {
    return { notify: true, key };
  }
  if (rank < prev.rank || (need !== "rest" && state.pending < prev.pending)) return { notify: false, key };
  return { notify: false, key: notified };
}

/**
 * How many exhaustion levels a penalty adds. Going without water adds two when the character is already exhausted.
 * @param {"food"|"water"|"rest"} need
 * @param {number} current  Current exhaustion level.
 * @returns {number}        Levels to add, limited so the total does not exceed 6.
 */
export function exhaustionToAdd(need, current) {
  const have = Math.max(0, Number(current) || 0);
  const add = need === "water" && have >= 1 ? 2 : 1;
  return Math.max(0, Math.min(MAX_EXHAUSTION, have + add) - have);
}

/** Lower-cases and folds "ё" into "е" so Russian names match regardless of spelling. */
export function normalizeName(text) {
  return String(text ?? "").toLowerCase().replaceAll("ё", "е").trim();
}

// Races whose rules say they need no food or water (checked against the race item name and identifier).
const NO_FOOD_AND_WATER = ["кованый", "автогном", "маген", "возрожденный", "warforged", "autognome", "reborn"];

/**
 * Which needs a race does not have.
 * @param {(string|undefined|null)[]} names  Race item name and identifier.
 * @returns {{food: boolean, water: boolean}}
 */
export function raceExemptions(names = []) {
  const hay = names.map(normalizeName).filter(Boolean);
  const none = hay.some((n) => NO_FOOD_AND_WATER.some((k) => n.includes(k)));
  return { food: none, water: none };
}

/**
 * Whether a need is skipped for a character: the GM override wins, otherwise the race decides. Everyone needs rest.
 * @param {"food"|"water"|"rest"} need
 * @param {boolean|undefined} override                 true: not needed, false: needed, undefined: automatic.
 * @param {{food: boolean, water: boolean}} race
 */
export function isExempt(need, override, race) {
  if (typeof override === "boolean") return override;
  return need === "rest" ? false : !!race?.[need];
}

/** Next value of the GM override when the toggle is clicked: automatic → not needed → needed → automatic. */
export function cycleOverride(override) {
  if (override === undefined || override === null) return true;
  return override === true ? false : undefined;
}

/** Guesses whether a "Food"-type consumable is something to drink. The dialog lets the GM pick either way. */
export function guessIntakeKind(name) {
  return /вод[аыуе]|бурд|фляг|напит|\bэль\b|вино|water|flask|canteen|\bale\b|wine|drink/i.test(String(name ?? "")) ? "water" : "food";
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** Escapes text for use in an HTML string (item and character names may contain markup). */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}
