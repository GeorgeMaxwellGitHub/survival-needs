import { escapeHtml, guessIntakeKind, planConsumption } from "./logic.mjs";

function stockOf(item) {
  const max = Number(item.system?.uses?.max) || 0;
  if (max > 0) return `${item.system.uses.value ?? 0}/${max}`;
  return `×${Number(item.system?.quantity) || 0}`;
}

/** Consumables of the "Food" type the character carries, those that match the need first. */
export function intakeCandidates(actor, need) {
  const items = [...actor.items].filter((i) => i.type === "consumable" && i.system?.type?.value === "food");
  const rows = items.map((item) => ({
    item,
    available: !!planConsumption({ quantity: item.system?.quantity, usesMax: item.system?.uses?.max, usesSpent: item.system?.uses?.spent }),
    matches: guessIntakeKind(item.name) === need
  }));
  return rows.sort((a, b) => (b.matches - a.matches) || a.item.name.localeCompare(b.item.name));
}

/**
 * Asks which item the character eats or drinks.
 * @returns {Promise<{item: Item|null, removeExhaustion: boolean}|null>}  null when the dialog was cancelled.
 */
export async function pickIntake(actor, need) {
  const rows = intakeCandidates(actor, need);
  const preselected = rows.find((r) => r.matches && r.available);
  const t = (key, data) => game.i18n.format(`SURVIVAL_NEEDS.Dialog.${key}`, data);

  const radios = rows.map(({ item, available }) => {
    const checked = item === preselected?.item ? " checked" : "";
    const disabled = available ? "" : " disabled";
    return `<label class="survival-needs-choice"><input type="radio" name="item" value="${escapeHtml(item.id)}"${checked}${disabled}>`
      + `<img src="${escapeHtml(item.img)}" alt=""><span>${escapeHtml(item.name)}</span><em>${escapeHtml(stockOf(item))}</em></label>`;
  }).join("");
  const none = `<label class="survival-needs-choice"><input type="radio" name="item" value=""${preselected ? "" : " checked"}>`
    + `<span>${escapeHtml(t("NoItem"))}</span></label>`;
  const content = `<div class="survival-needs-dialog"><p>${escapeHtml(t(`Hint.${need}`, { actor: actor.name }))}</p>`
    + `${radios}${none}`
    + `<label class="survival-needs-remove"><input type="checkbox" name="remove"><span>${escapeHtml(t(`Remove.${need}`))}</span></label></div>`;

  return foundry.applications.api.DialogV2.prompt({
    rejectClose: false,
    modal: true,
    window: { title: t(`Title.${need}`, { actor: actor.name }), icon: need === "water" ? "fa-solid fa-glass-water" : "fa-solid fa-utensils" },
    content,
    ok: {
      label: t("Confirm"),
      callback: (event, button) => {
        const form = button.form;
        const id = form.elements.item?.value ?? "";
        return { item: id ? actor.items.get(id) ?? null : null, removeExhaustion: !!form.elements.remove?.checked };
      }
    }
  });
}
