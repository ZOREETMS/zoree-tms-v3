// ════════════════════════════════════════════════════════════════════
// itemMasterService — persistence helpers for the Item Master page
// (items + packaging_units).
//
// Pure payload builders + read helpers live in itemMasterPayload.js
// (no DbApi import) so they can be unit-tested from plain Node. This
// module re-exports them so existing callers don't have to switch
// import paths, and adds the side-effecting save / duplicate / status
// helpers on top.
//
// QA #135: payload now writes `description`, not `desc`. See the
// itemMasterPayload module for the why.
// ════════════════════════════════════════════════════════════════════
import { DbApi } from "../lib/api";
import {
  buildItemRow,
  buildPackagingRow,
  readItemDescription,
  readPkgDescription,
} from "./itemMasterPayload";

const ITEMS_TABLE = "items";
const PKG_TABLE   = "packaging_units";

// Re-export the pure helpers so existing call sites keep working.
export {
  buildItemRow,
  buildPackagingRow,
  readItemDescription,
  readPkgDescription,
};

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
