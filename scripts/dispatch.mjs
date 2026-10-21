import { ID } from "./state.mjs";
import { announce, applyPenalty, markIntake, markRested, rollSave, toggleOverride } from "./actions.mjs";
import { pickIntake } from "./dialog.mjs";

/**
 * Runs a button action from the dashboard or a chat card. The GM is the only one who changes characters.
 * @param {"intake"|"rested"|"penalty"|"save"|"announce"|"toggle"} kind
 * @param {Actor} actor
 * @param {"food"|"water"|"rest"} need
 */
export async function runAction(kind, actor, need) {
  if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("SURVIVAL_NEEDS.Notify.GmOnly"));
  if (!actor) return ui.notifications.warn(game.i18n.localize("SURVIVAL_NEEDS.Notify.NoActor"));
  try {
    switch (kind) {
      case "intake": {
        const choice = await pickIntake(actor, need);
        if (choice) await markIntake(actor, need, choice);
        break;
      }
      case "rested": await markRested(actor); break;
      case "penalty": await applyPenalty(actor, need); break;
      case "save": await rollSave(actor, need); break;
      case "announce": await announce(actor, need); break;
      case "toggle": await toggleOverride(actor, need); break;
      default: console.warn(`${ID} | unknown action`, kind);
    }
  } catch (err) {
    console.error(`${ID} | action ${kind} failed`, err);
    ui.notifications.error(game.i18n.localize("SURVIVAL_NEEDS.Notify.Failed"));
  }
}
