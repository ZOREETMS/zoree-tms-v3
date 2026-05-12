// ════════════════════════════════════════════════════════════════════
// itemMasterPayload — PURE builders and readers for the items +
// packaging_units row shapes.
//
// Split out from itemMasterService.js so these can be unit-tested
// without dragging in the DbApi import (which itself depends on
// Vite's import.meta.env and so won't load under plain Node). The
// service module re-exports these for backward compatibility with
// existing callers.
//
// QA #135: the items table column is `description`. The legacy code
// wrote `desc`, which produced "DB update failed (400) – Could not
// find the 'desc' column in the schema cache". Centralising the
// payload shape here ensures the column name lives in one place.
//
// 2026-05-11: extended that same fix-class. The mapper used to write
// item_class / fclass / len / wid / hgt while the items table has
// columns class / freight_class / length / width / height. Renamed
// here. Companion migration 20260511_items_add_stack_un_haz_class.sql
// added the missing stack / un / haz_class columns the form has
// always written.
// ════════════════════════════════════════════════════════════════════

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
 *
 * Column-name rule: the keys here MUST match the actual `items` table
 * schema. Same bug-class as QA #135 (`desc` → `description`):
 *   - the form's internal field names (form.class, form.freight_class,
 *     form.len, form.wid, form.hgt) are stable for UI binding, but the
 *     DB columns are `class`, `freight_class`, `length`, `width`,
 *     `height`. This mapper bridges the two.
 *   - `stack`, `un`, `haz_class` are real columns as of migration
 *     20260511_items_add_stack_un_haz_class.sql.
 * Any drift here surfaces as PostgREST `PGRST204` ("Could not find
 * the 'X' column of 'items' in the schema cache") on save.
 */
export function buildItemRow(form) {
  return {
    id:               (form.id || "").toUpperCase(),
    description:      (form.description || "").toUpperCase(),
    customer:         (form.customer || "").toUpperCase(),
    class:            form.class || "General",
    nmfc:             (form.nmfc || "").toUpperCase(),
    freight_class:    form.freight_class || "70",
    weight_unit:      parseFloat(form.weight_unit) || 0,
    value_unit:       parseFloat(form.value_unit)  || 0,
    length:           parseFloat(form.len) || 0,
    width:            parseFloat(form.wid) || 0,
    height:           parseFloat(form.hgt) || 0,
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
