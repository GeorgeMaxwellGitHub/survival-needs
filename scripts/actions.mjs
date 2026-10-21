import { ID, STATUS, evaluateActor, exhaustionOf, getConfig } from "./state.mjs";
import {
  DAY_HOURS, WATER_SAVE_DC, cycleOverride, durationParts, escapeHtml, exhaustionToAdd, foodLimitDays
} from "./logic.mjs";

const gmWhisper = () => ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
const flagPath = (...parts) => `flags.${ID}.${parts.join(".")}`;
const clearPath = (group, need) => `flags.${ID}.${group}.-=${need}`;

/** "5 h" or "2 d 3 h". */
export function formatDuration(hours) {
  const { days, hours: h } = durationParts(hours);
  return days ? game.i18n.format("SURVIVAL_NEEDS.Time.DaysHours", { d: days, h }) : game.i18n.format("SURVIVAL_NEEDS.Time.Hours", { h });
}

function say(content, extra = {}) {
  return ChatMessage.create({ content, speaker: { alias: game.i18n.localize("SURVIVAL_NEEDS.Title") }, ...extra });
}

async function removeStatus(actor, need) {
  const id = STATUS[need];
  if (id && actor.statuses?.has(id)) await actor.toggleStatusEffect(id, { active: false });
}

/* -------------------------------------------- */
/*  State changes                                */
/* -------------------------------------------- */

/**
 * The character ate or drank: restarts the timer, clears the dnd5e status and optionally takes back one exhaustion
 * level this module gave for the same need. Using up the item is dnd5e's own job (see dispatch.mjs).
 * @param {Actor} actor
 * @param {"food"|"water"} need
 * @param {{item?: Item|null, removeExhaustion?: boolean}} [options]  item: the item that was used, if any.
 */
export async function markIntake(actor, need, { item = null, removeExhaustion = false } = {}) {
  const update = {
    [flagPath("last", need)]: game.time.worldTime,
    [flagPath("applied", need)]: 0,
    [clearPath("notified", need)]: null
  };
  let removed = 0;
  if (removeExhaustion) {
    const owed = actor.flags?.[ID]?.levels?.[need] ?? 0;
    removed = Math.min(owed, exhaustionOf(actor), 1);
    if (removed) {
      update["system.attributes.exhaustion"] = exhaustionOf(actor) - removed;
      update[flagPath("levels", need)] = owed - removed;
    }
  }
  await actor.update(update);
  await removeStatus(actor, need);

  // An item use already posts dnd5e's own card; only say something when there is nothing else to see.
  if (item && !removed) return;
  const key = need === "food" ? "Ate" : "Drank";
  let text = game.i18n.format(`SURVIVAL_NEEDS.Chat.${key}`, { actor: escapeHtml(actor.name) });
  if (removed) text += ` ${game.i18n.localize("SURVIVAL_NEEDS.Chat.ExhaustionRemoved")}`;
  await say(`<p>${text}</p>`);
}

/** A long rest was finished: restarts the rest timer. */
export async function markRested(actor, { silent = false } = {}) {
  await actor.update({
    [flagPath("last", "rest")]: game.time.worldTime,
    [flagPath("levels", "rest")]: 0,
    [clearPath("notified", "rest")]: null
  });
  if (!silent) await say(`<p>${game.i18n.format("SURVIVAL_NEEDS.Chat.Rested", { actor: escapeHtml(actor.name) })}</p>`);
}

/** Starts the timers of a need from now without any chat message (used for newly tracked characters). */
export function startUpdate(need, now) {
  return { [flagPath("last", need)]: now };
}

/**
 * Gives the penalty for a need: exhaustion (two levels for water when already exhausted) and, for food and water,
 * the dnd5e status.
 */
export async function applyPenalty(actor, need) {
  const current = exhaustionOf(actor);
  const add = exhaustionToAdd(need, current);
  const owed = actor.flags?.[ID]?.levels?.[need] ?? 0;
  const applied = actor.flags?.[ID]?.applied?.[need] ?? 0;
  const update = { [flagPath("levels", need)]: owed + add };
  if (need !== "rest") update[flagPath("applied", need)] = applied + 1;
  if (add) update["system.attributes.exhaustion"] = current + add;
  await actor.update(update);
  const id = STATUS[need];
  if (id && !actor.statuses?.has(id)) await actor.toggleStatusEffect(id, { active: true });
  await say(`<p>${game.i18n.format(`SURVIVAL_NEEDS.Chat.Penalty.${need}`, { actor: escapeHtml(actor.name), n: add, level: current + add })}</p>`);
}

/** Rolls the Constitution save of a need: DC 15 for half a water ration, the configured DC for missed rest. */
export function rollSave(actor, need) {
  const target = need === "water" ? WATER_SAVE_DC : getConfig().restSaveDc;
  return actor.rollSavingThrow({ ability: "con", target });
}

/** Cycles the GM override of a need: automatic → not needed → needed → automatic. */
export function toggleOverride(actor, need) {
  const next = cycleOverride(actor.flags?.[ID]?.override?.[need]);
  return actor.update({ [next === undefined ? clearPath("override", need) : flagPath("override", need)]: next ?? null });
}

/* -------------------------------------------- */
/*  Chat card for the GM                         */
/* -------------------------------------------- */

const CARD_BUTTONS = {
  food: ["intake", "penalty"],
  water: ["intake", "penalty"],
  rest: ["rested", "penalty"]
};

/** A clickable link to the character, safe to put into message HTML. */
function actorLink(actor) {
  const name = escapeHtml(String(actor.name).replace(/[[\]{}]/g, ""));
  return `@UUID[${actor.uuid}]{${name}}`;
}

/** Posts a card to the GM with the buttons to deal with a need that has come due. */
export function postNeedCard(actor, need, state) {
  const t = (key, data) => game.i18n.format(`SURVIVAL_NEEDS.Card.${key}`, data);
  const dc = need === "water" ? WATER_SAVE_DC : getConfig().restSaveDc;
  const lines = [`<p class="survival-needs-title">${t(`Title.${need}`, { actor: actorLink(actor) })}</p>`];
  lines.push(`<p>${t(`Since.${need}`, { time: formatDuration(state.hours) })}`
    + (need === "food" ? ` ${foodLimitLine(actor, state, t)}` : "") + "</p>");
  if (state.pending) lines.push(`<p class="survival-needs-owed">${t("Pending", { n: state.pending })}</p>`);
  if (need === "water") lines.push(`<p class="survival-needs-hint">${t("Hint.water", { dc })}</p>`);
  if (need === "rest") lines.push(`<p class="survival-needs-hint">${t(state.saves ? "Hint.restSaves" : "Hint.rest", { n: state.saves, dc })}</p>`);

  const buttons = CARD_BUTTONS[need].map((action) => {
    const key = action === "rested" ? "rested" : `${action}.${need}`;
    return `<button type="button" data-sn-action="${action}">${escapeHtml(t(`Button.${key}`))}</button>`;
  });
  const content = `<div class="survival-needs-card">${lines.join("")}<div class="survival-needs-buttons">${buttons.join("")}</div></div>`;
  return ChatMessage.create({
    content,
    whisper: gmWhisper(),
    speaker: { alias: game.i18n.localize("SURVIVAL_NEEDS.Title") },
    flags: { [ID]: { card: { actorId: actor.id, need } } }
  });
}

/** How long until the character's time without food runs out (3 + Con modifier days), worked out for the GM. */
function foodLimitLine(actor, state, t) {
  const left = foodLimitDays(actor.system?.abilities?.con?.mod) * DAY_HOURS - state.hours;
  return left > 0 ? t("LimitLeft", { time: formatDuration(left) }) : t("LimitReached");
}

/** Re-evaluates a character: used by the dashboard and the card buttons to show the current state. */
export function currentState(actor) {
  return evaluateActor(actor, game.time.worldTime);
}
