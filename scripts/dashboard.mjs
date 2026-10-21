import { ID, evaluateActor, trackedActors } from "./state.mjs";
import { formatDuration } from "./actions.mjs";
import { runAction } from "./dispatch.mjs";
import { NEEDS } from "./logic.mjs";

const ICONS = { food: "fa-utensils", water: "fa-glass-water", rest: "fa-bed" };
const MAIN_ACTION = { food: "intake", water: "intake", rest: "rested" };

const t = (key, data) => game.i18n.format(`SURVIVAL_NEEDS.${key}`, data);

/** Builds an element; all text goes through textContent so item and character names cannot inject markup. */
function el(tag, { cls, text, attrs = {} } = {}, children = []) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function button(kind, need, actorId, icon, tooltip, extra = "") {
  const b = el("button", {
    cls: `survival-needs-btn ${extra}`.trim(),
    attrs: { type: "button", "data-action": "sn", "data-sn": kind, "data-need": need, "data-actor-id": actorId, "data-tooltip": tooltip, "aria-label": tooltip }
  });
  b.append(el("i", { cls: `fa-solid ${icon}` }));
  return b;
}

function needCell(row, need) {
  const state = row.needs[need];
  const actorId = row.actor.id;
  const cell = el("div", { cls: `survival-needs-cell level-${state.level}` });

  const head = el("div", { cls: "survival-needs-head" }, [el("span", { cls: "survival-needs-chip", text: t(`Level.${state.level}`) })]);
  if (state.level !== "exempt" && state.level !== "untracked") {
    head.append(el("span", { cls: "survival-needs-time", text: formatDuration(state.hours) }));
  }
  cell.append(head);

  const notes = [];
  if (state.pending) notes.push(t("Dashboard.Pending", { n: state.pending }));
  if (state.saves) notes.push(t("Dashboard.Saves", { n: state.saves }));
  if (notes.length) cell.append(el("div", { cls: "survival-needs-note", text: notes.join(" · ") }));

  const tools = el("div", { cls: "survival-needs-tools" });
  if (state.level !== "exempt") {
    tools.append(button(MAIN_ACTION[need], need, actorId, ICONS[need], t(`Dashboard.Action.${MAIN_ACTION[need]}.${need}`), "primary"));
    tools.append(button("announce", need, actorId, "fa-bullhorn", t(`Dashboard.Action.announce.${need}`)));
    if (need !== "food") tools.append(button("save", need, actorId, "fa-dice-d20", t(`Dashboard.Action.save.${need}`)));
    tools.append(button("penalty", need, actorId, "fa-triangle-exclamation", t(`Dashboard.Action.penalty.${need}`), "danger"));
  }
  const override = row.flags.override?.[need];
  const toggleTip = override === undefined
    ? t("Dashboard.Action.toggle.auto")
    : t(override ? "Dashboard.Action.toggle.exempt" : "Dashboard.Action.toggle.needed");
  tools.append(button("toggle", need, actorId, override === undefined ? "fa-wand-magic-sparkles" : override ? "fa-ban" : "fa-check", toggleTip));
  cell.append(tools);
  return cell;
}

function actorRow(row) {
  const actor = row.actor;
  const who = el("div", { cls: "survival-needs-who" }, [
    el("img", { attrs: { src: actor.img, alt: "" } }),
    el("div", {}, [
      el("strong", { text: actor.name }),
      el("div", { cls: "survival-needs-sub", text: t("Dashboard.Exhaustion", { n: row.exhaustion }) })
    ])
  ]);
  who.addEventListener("dblclick", () => actor.sheet?.render(true));
  return el("div", { cls: "survival-needs-row" }, [who, ...NEEDS.map((need) => needCell(row, need))]);
}

/** The dashboard contents: a header row and a row per tracked character. */
export function buildBoard(now) {
  const rows = trackedActors().map((actor) => evaluateActor(actor, now));
  const root = el("div", { cls: "survival-needs-board" });
  root.append(el("div", { cls: "survival-needs-row survival-needs-columns" }, [
    el("div", { text: t("Dashboard.Character") }),
    ...NEEDS.map((need) => el("div", { cls: "survival-needs-colhead" }, [el("i", { cls: `fa-solid ${ICONS[need]}` }), el("span", { text: t(`Need.${need}`) })]))
  ]));
  if (rows.length) root.append(...rows.map(actorRow));
  else root.append(el("p", { cls: "survival-needs-empty", text: t("Dashboard.Empty") }));
  root.append(el("p", { cls: "survival-needs-footer", text: game.actors?.party ? t("Dashboard.FooterParty", { party: game.actors.party.name }) : t("Dashboard.FooterNoParty") }));
  return root;
}

let DashboardClass = null;
let instance = null;

function dashboardClass() {
  if (DashboardClass) return DashboardClass;
  const { ApplicationV2 } = foundry.applications.api;
  DashboardClass = class SurvivalNeedsDashboard extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${ID}-dashboard`,
      classes: ["survival-needs-app"],
      window: { title: "SURVIVAL_NEEDS.Dashboard.Title", icon: "fa-solid fa-campground", resizable: true },
      position: { width: 860, height: "auto" },
      actions: { sn: SurvivalNeedsDashboard.#onAction }
    };

    static async #onAction(event, target) {
      const { sn, need, actorId } = target.dataset;
      await runAction(sn, game.actors.get(actorId), need);
    }

    async _renderHTML() {
      return buildBoard(game.time.worldTime);
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    async close(options) {
      instance = null;
      return super.close(options);
    }
  };
  return DashboardClass;
}

/** Opens the dashboard, or closes it when it is already open. */
export function toggleDashboard() {
  if (instance) return instance.close();
  instance = new (dashboardClass())();
  return instance.render({ force: true });
}

export function openDashboard() {
  if (!instance) instance = new (dashboardClass())();
  return instance.render({ force: true });
}

let timer = null;
/** Redraws the dashboard shortly after a change, if it is open. */
export function refreshDashboard() {
  if (!instance?.rendered) return;
  clearTimeout(timer);
  timer = setTimeout(() => instance?.rendered && instance.render(), 150);
}
