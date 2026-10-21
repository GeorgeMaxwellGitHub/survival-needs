import { DEFAULT_CONFIG, NEEDS, evaluateNeed, isExempt, raceExemptions } from "./logic.mjs";

export const ID = "survival-needs";
/** Status effects dnd5e ships for the two needs it knows about (they also stop a long rest from reducing exhaustion). */
export const STATUS = { food: "malnutrition", water: "dehydration" };

/** World settings that tune the timers. */
export function getConfig() {
  const read = (key) => {
    const value = Number(game.settings.get(ID, key));
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_CONFIG[key];
  };
  return { soonHours: read("soonHours"), restHours: Math.max(1, read("restHours")), restSaveDc: read("restSaveDc") };
}

/** Characters the module watches: the members of dnd5e's primary party, or every player-owned character without one. */
export function trackedActors() {
  const party = game.actors?.party;
  if (party) return [...(party.system?.playerCharacters ?? [])];
  return [...(game.actors ?? [])].filter((a) => a.type === "character" && a.hasPlayerOwner);
}

export function exhaustionOf(actor) {
  return Number(actor.system?.attributes?.exhaustion) || 0;
}

function raceNames(actor) {
  const race = actor.system?.details?.race;
  return race && typeof race === "object" ? [race.name, race.system?.identifier] : [];
}

/**
 * Everything the dashboard, the chat cards and the timer need to know about one character.
 * @param {Actor} actor
 * @param {number} now  Current game time in seconds.
 */
export function evaluateActor(actor, now) {
  const flags = actor.flags?.[ID] ?? {};
  const race = raceExemptions(raceNames(actor));
  const conMod = Number(actor.system?.abilities?.con?.mod) || 0;
  const config = getConfig();
  const needs = {};
  for (const need of NEEDS) {
    const exempt = isExempt(need, flags.override?.[need], race);
    needs[need] = evaluateNeed(need, {
      now,
      last: flags.last?.[need],
      conMod,
      applied: flags.applied?.[need] ?? 0,
      exempt,
      config
    });
  }
  return { actor, needs, conMod, exhaustion: exhaustionOf(actor), flags, auto: race };
}
