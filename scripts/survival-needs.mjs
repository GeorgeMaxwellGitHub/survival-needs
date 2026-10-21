import { ID, evaluateActor, trackedActors } from "./state.mjs";
import { markRested, postNeedCard, startUpdate } from "./actions.mjs";
import { runAction } from "./dispatch.mjs";
import { openDashboard, refreshDashboard, toggleDashboard } from "./dashboard.mjs";
import { DEFAULT_CONFIG, NEEDS, planNotification } from "./logic.mjs";

const TICK_DELAY_MS = 1000;
const OPEN_ACTION = `${ID}-dashboard`;

/* -------------------------------------------- */
/*  Settings and API                             */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const number = (key, initial) => game.settings.register(ID, key, {
    name: `SURVIVAL_NEEDS.Settings.${key}.Name`,
    hint: `SURVIVAL_NEEDS.Settings.${key}.Hint`,
    scope: "world",
    config: true,
    type: Number,
    default: initial
  });
  game.settings.register(ID, "enabled", {
    name: "SURVIVAL_NEEDS.Settings.enabled.Name",
    hint: "SURVIVAL_NEEDS.Settings.enabled.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(ID, "postCards", {
    name: "SURVIVAL_NEEDS.Settings.postCards.Name",
    hint: "SURVIVAL_NEEDS.Settings.postCards.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  number("soonHours", DEFAULT_CONFIG.soonHours);
  number("restHours", DEFAULT_CONFIG.restHours);
  number("restSaveDc", DEFAULT_CONFIG.restSaveDc);
});

Hooks.once("ready", () => {
  const module = game.modules.get(ID);
  if (module) module.api = { openDashboard, toggleDashboard, tick };
  if (isActiveGm()) scheduleTick();
});

/* -------------------------------------------- */
/*  Timer                                        */
/* -------------------------------------------- */

function isActiveGm() {
  return !!game.user?.isGM && game.users?.activeGM?.id === game.user.id;
}

let timer = null;
let running = false;
let again = false;

/** Waits a moment so a rest that advances the clock can reset its timer before anything is announced. */
function scheduleTick() {
  clearTimeout(timer);
  timer = setTimeout(tick, TICK_DELAY_MS);
}

/**
 * Starts the timers of newly tracked characters, and posts a card for every need that has just come due.
 * Only the active GM runs it, so cards are never posted twice.
 */
export async function tick() {
  if (!isActiveGm() || !game.settings.get(ID, "enabled")) return;
  if (running) { again = true; return; }
  running = true;
  try {
    const now = game.time.worldTime;
    const post = game.settings.get(ID, "postCards");
    for (const actor of trackedActors()) {
      try {
        let flags = actor.flags?.[ID] ?? {};
        const update = {};
        for (const need of NEEDS) {
          if (!Number.isFinite(flags.last?.[need])) Object.assign(update, startUpdate(need, now));
        }
        if (Object.keys(update).length) {
          await actor.update(update);
          flags = actor.flags?.[ID] ?? {};
        }

        const evaluated = evaluateActor(actor, now);
        const changes = {};
        const cards = [];
        for (const need of NEEDS) {
          const state = evaluated.needs[need];
          const notified = flags.notified?.[need];
          const plan = planNotification(need, state, notified);
          if (plan.key !== (notified ?? null)) {
            changes[`flags.${ID}.notified.${plan.key === null ? `-=${need}` : need}`] = plan.key;
          }
          if (plan.notify && post) cards.push([need, state]);
        }
        if (Object.keys(changes).length) await actor.update(changes);
        for (const [need, state] of cards) await postNeedCard(actor, need, state);
      } catch (err) {
        console.warn(`${ID} | could not check ${actor?.name}`, err);
      }
    }
  } catch (err) {
    console.warn(`${ID} | timer check failed`, err);
  } finally {
    running = false;
    if (again) { again = false; scheduleTick(); }
  }
  refreshDashboard();
}

Hooks.on("updateWorldTime", () => {
  try {
    if (isActiveGm()) scheduleTick();
    refreshDashboard();
  } catch (err) {
    console.warn(`${ID} | world time hook failed`, err);
  }
});

Hooks.on("updateActor", () => refreshDashboard());

// A finished long rest restarts the rest timer (dnd5e advances the clock before this hook fires).
Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
  try {
    const long = result?.longRest ?? config?.type === "long";
    if (!long || actor?.type !== "character" || !game.settings.get(ID, "enabled")) return;
    markRested(actor, { silent: true }).catch((err) => console.warn(`${ID} | could not restart the rest timer`, err));
  } catch (err) {
    console.warn(`${ID} | rest hook failed`, err);
  }
});

/* -------------------------------------------- */
/*  Chat cards                                   */
/* -------------------------------------------- */

function bindCard(message, html) {
  try {
    const card = message.flags?.[ID]?.card;
    if (!card || !game.user.isGM) return;
    // Show a tent instead of the GM's avatar in the message header.
    const avatar = html.querySelector?.(".message-header img");
    if (avatar) {
      const icon = document.createElement("i");
      icon.className = "fa-solid fa-campground survival-needs-avatar";
      avatar.replaceWith(icon);
    }
    for (const btn of html.querySelectorAll("[data-sn-action]")) {
      if (btn.dataset.snBound) continue;
      btn.dataset.snBound = "1";
      btn.addEventListener("click", () => runAction(btn.dataset.snAction, game.actors.get(card.actorId), card.need));
    }
  } catch (err) {
    console.warn(`${ID} | could not bind card buttons`, err);
  }
}
Hooks.on("renderChatMessageHTML", bindCard);

/* -------------------------------------------- */
/*  Entry points to the dashboard (GM)           */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  try {
    const tools = controls?.tokens?.tools;
    if (!tools || !game.user.isGM) return;
    tools[OPEN_ACTION] = {
      name: OPEN_ACTION,
      title: "SURVIVAL_NEEDS.Dashboard.Open",
      icon: "fa-solid fa-campground",
      button: true,
      visible: game.user.isGM,
      onChange: () => toggleDashboard()
    };
  } catch (err) {
    console.warn(`${ID} | could not add the scene control button`, err);
  }
});

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const doc = app.document;
  if (!game.user.isGM || doc?.documentName !== "Actor" || doc.type !== "group") return;
  if (controls.some((c) => c.action === OPEN_ACTION)) return;
  controls.push({
    icon: "fa-solid fa-campground",
    label: "SURVIVAL_NEEDS.Dashboard.Open",
    action: OPEN_ACTION,
    visible: () => game.user.isGM,
    onClick: () => openDashboard()
  });
});
