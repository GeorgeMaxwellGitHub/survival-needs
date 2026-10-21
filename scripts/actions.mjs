import { ID, STATUS, evaluateActor, exhaustionOf, getConfig } from "./state.mjs";
import {
  WATER_SAVE_DC, cycleOverride, durationParts, escapeHtml, exhaustionToAdd, foodLimitDays, planConsumption
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
 * The character ate or drank: restarts the timer, clears the dnd5e status, optionally uses up an item and takes
 * back one exhaustion level this module gave for the same need.
 * @param {Actor} actor
 * @param {"food"|"water"} need
 * @param {{item?: Item|null, removeExhaustion?: boolean}} [options]
 */
export async function markIntake(actor, need, { item = null, removeExhaustion = false } = {}) {
  const update = {
    [flagPath("last", need)]: game.time.worldTime,
    [flagPath("applied", need)]: 0,
    [clearPath("notified", need)]: null
  };
  let consumed = null;
  if (item) {
    consumed = planConsumption({ quantity: item.system?.quantity, usesMax: item.system?.uses?.max, usesSpent: item.system?.uses?.spent });
    if (consumed) await item.update(consumed.updates);
  }
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

  const key = need === "food" ? "Ate" : "Drank";
  let text = game.i18n.format(`SURVIVAL_NEEDS.Chat.${key}`, { actor: escapeHtml(actor.name) });
  if (item) {
    text = game.i18n.format(`SURVIVAL_NEEDS.Chat.${key}Item`, { actor: escapeHtml(actor.name), item: escapeHtml(item.name) });
    if (consumed) text += ` ${game.i18n.format(`SURVIVAL_NEEDS.Chat.Left.${consumed.unit}`, { n: consumed.left })}`;
    else text += ` ${game.i18n.localize("SURVIVAL_NEEDS.Chat.NothingLeft")}`;
  }
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

/** Tells the table (publicly) that a character needs something. */
export function announce(actor, need) {
  return say(`<p>${game.i18n.format(`SURVIVAL_NEEDS.Chat.Announce.${need}`, { actor: escapeHtml(actor.name) })}</p>`);
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
  food: ["intake", "penalty", "announce"],
  water: ["intake", "save", "penalty", "announce"],
  rest: ["rested", "save", "penalty", "announce"]
};

/** Posts a card to the GM with the buttons to deal with a need that has come due. */
export function postNeedCard(actor, need, state) {
  const t = (key, data) => game.i18n.format(`SURVIVAL_NEEDS.Card.${key}`, data);
  const name = escapeHtml(actor.name);
  const lines = [t(`Since.${need}`, { time: formatDuration(state.hours) })];
  if (need === "food") lines.push(t("Limit", { days: foodLimitDays(actor.system?.abilities?.con?.mod) }));
  if (state.pending) lines.push(t("Pending", { n: state.pending }));
  if (need === "rest" && state.saves) lines.push(t("Saves", { n: state.saves, dc: getConfig().restSaveDc }));

  const buttons = CARD_BUTTONS[need].map((action) => {
    const key = action === "intake" || action === "penalty" ? `${action}.${need}` : action;
    const label = t(`Button.${key}`, { dc: need === "water" ? WATER_SAVE_DC : getConfig().restSaveDc });
    return `<button type="button" data-sn-action="${action}">${escapeHtml(label)}</button>`;
  });
  const content = `<div class="survival-needs-card"><h3>${t(`Title.${need}`, { actor: name })}</h3>`
    + lines.map((l) => `<p>${l}</p>`).join("")
    + `<div class="survival-needs-buttons">${buttons.join("")}</div></div>`;
  return ChatMessage.create({
    content,
    whisper: gmWhisper(),
    speaker: { alias: game.i18n.localize("SURVIVAL_NEEDS.Title") },
    flags: { [ID]: { card: { actorId: actor.id, need } } }
  });
}

/** Re-evaluates a character: used by the dashboard and the card buttons to show the current state. */
export function currentState(actor) {
  return evaluateActor(actor, game.time.worldTime);
}
