// ════════════════════════════════════════════════════════════════════
// itemMasterService — payload mappers + persistence helpers for the
// Item Master page (items + packaging_units).
//
// Why this exists:
//   - Rule 6/9 (CLAUDE_RULES.md): UI must not embed payload-shaping
//     business logic. Pages only orchestrate.
//   - QA #135: ItemMasterPage.saveItem was sending `desc` to the
//     `items` table. The column is `description` (matches the form
//     field, the equipment service, and `it.description` fallbacks
//     elsewhere). Centralising the write here keeps the column name
//     in one place so we don't drift again.
//
// All Supabase access goes through DbApi (lib/api.js → /api/db/*).
// No direct Supabase REST calls from the UI.
// ════════════════════════════════════════════════════════════════════
import { DbApi } from "../lib/api";

const ITEMS_TABLE = "items";
const PKG_TABLE   = "packaging_units";

/** Read helper that tolerates legacy rows where the column was once `desc`. */
export function readItemDescription(it) {
  if (!it) return "";
  return it.description || it.desc || "";
}

export function readPkgDescription(p) {
  if (!p) return "";
  return p.description || p.desc || "";
}

/**
 * Build the items table row payload from the edit-form state.
 * Note the column is `description`, not `desc` (#135).
 */
export function buildItemRow(form) {
  return {
    id:               (form.id || "").toUpperCase(),
    description:      (form.description || "").toUpperCase(),
    customer:         (form.customer || "").toUpperCase(),
    item_class:       form.class || "General",
    nmfc:             (form.nmfc || "").toUpperCase(),
    fclass:           form.freight_class || "70",
    weight_unit:      parseFloat(form.weight_unit) || 0,
    value_unit:       parseFloat(form.value_unit)  || 0,
    len:              parseFloat(form.len) || 0,
    wid:              parseFloat(form.wid) || 0,
    hgt:              parseFloat(form.hgt) || 0,
    units_per_pallet: parseInt(form.units_per_pallet, 10) || 1,
    pkg:              form.pkg || "Carton",
    stack:            parseInt(form.stack, 10) || 1,
    hazmat:           !!form.hazmat,
    fragile:          !!form.fragile,
    temp_ctrl:        !!form.temp_ctrl,
    top_load:         !!form.top_load,
    un:               form.un || "",
    haz_class:        form.haz_class || "",
    status:           form.status || "Active",
  };
}

/**
 * Build the packaging_units row payload. Same column-name rule
 * as items: `description`, not `desc` (#135).
 */
export function buildPackagingRow(form) {
  return {
    id:          (form.id || "").toUpperCase(),
    description: (form.description || form.desc || "").toUpperCase(),
    type:        form.type || "Carton",
    material:    form.material || "Corrugated",
    len:         parseFloat(form.len) || 0,
    wid:         parseFloat(form.wid) || 0,
    hgt:         parseFloat(form.hgt) || 0,
    tare:        parseFloat(form.tare) || 0,
    max_load:    parseFloat(form.max_load) || 0,
    stack:       parseInt(form.stack, 10) || 1,
    returnable:  !!form.returnable,
    nested:      !!form.nested,
    hazmat:      !!form.hazmat,
    cost:        parseFloat(form.cost) || 0,
    supplier:    form.supplier || "",
    status:      form.status || "Active",
  };
}

/** Save (create or update) an item row. */
export async function saveItem({ form, originalId }) {
  if (!form?.id) throw new Error("Item ID is required");
  if (!form?.description) throw new Error("Description is required");
  const row = buildItemRow(form);
  if (originalId) {
    return DbApi.patch(ITEMS_TABLE, originalId, row);
  }
  return DbApi.upsert(ITEMS_TABLE, row);
}

/** Duplicate an item with a new id. */
export async function duplicateItem(item) {
  const newId = `${item.id}-COPY`;
  const row = { ...item, id: newId };
  delete row.created_at;
  delete row.updated_at;
  return DbApi.upsert(ITEMS_TABLE, row);
}

export async function setItemStatus(id, status) {
  return DbApi.patch(ITEMS_TABLE, id, { status });
}

/** Save (create or update) a packaging unit row. */
export async function savePackaging({ form, originalId }) {
  if (!form?.id) throw new Error("Packaging code is required");
  if (!form?.description && !form?.desc) {
    throw new Error("Description is required");
  }
  const row = buildPackagingRow(form);
  if (originalId) {
    return DbApi.patch(PKG_TABLE, originalId, row);
  }
  return DbApi.upsert(PKG_TABLE, row);
}

export async function setPackagingStatus(id, status) {
  return DbApi.patch(PKG_TABLE, id, { status });
}
