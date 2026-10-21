import { ID } from "./state.mjs";
import { applyPenalty, markIntake, markRested, rollSave, toggleOverride } from "./actions.mjs";
import { pickIntake } from "./dialog.mjs";

/**
 * Runs a button action from the dashboard or a chat card. The GM is the only one who changes characters.
 * @param {"intake"|"rested"|"penalty"|"save"|"toggle"} kind
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
        if (!choice) break;
        // Using the item goes through dnd5e itself (its usage dialog, charges, quantity and chat card). The timer is
        // restarted only if the use went through; a cancelled dialog or an empty item leaves everything as it was.
        if (choice.item && !(await choice.item.use())) break;
        await markIntake(actor, need, choice);
        break;
      }
      case "rested": await markRested(actor); break;
      case "penalty": await applyPenalty(actor, need); break;
      case "save": await rollSave(actor, need); break;
      case "toggle": await toggleOverride(actor, need); break;
      default: console.warn(`${ID} | unknown action`, kind);
    }
  } catch (err) {
    console.error(`${ID} | action ${kind} failed`, err);
    ui.notifications.error(game.i18n.localize("SURVIVAL_NEEDS.Notify.Failed"));
  }
}
