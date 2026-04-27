import { DbApi } from "../lib/api";

function hasKey(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function firstExistingKey(obj, candidates, fallback) {
  for (const key of candidates) {
    if (hasKey(obj, key)) return key;
  }
  return fallback;
}

function parseMissingColumn(errorMessage) {
  const msg = String(errorMessage || "");
  const patterns = [
    /column\s+"?([a-zA-Z0-9_]+)"?\s+does\s+not\s+exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /unknown column ['"]?([a-zA-Z0-9_]+)['"]?/i,
  ];
  for (const p of patterns) {
    const m = msg.match(p);
    if (m) return m[1];
  }
  return "";
}

async function patchWithColumnFallback(table, id, payload) {
  const patch = { ...payload };
  const maxAttempts = Math.max(1, Object.keys(patch).length + 2);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await DbApi.patch(table, id, patch);
    } catch (err) {
      const missing = parseMissingColumn(err.message);
      if (!missing || !hasKey(patch, missing)) throw err;
      delete patch[missing];
      if (!Object.keys(patch).length) throw err;
    }
  }
  return DbApi.patch(table, id, patch);
}

// Mirror of patchWithColumnFallback for INSERT / upsert. The carriers table
// has accumulated columns over multiple migrations and the UI form drifts
// faster than the schema (e.g. `cost_per_mile` was emitted before its
// migration landed). Without this fallback, a single missing column meant
// every "Save Carrier" silently failed with a 500. We retry the upsert
// without the offending column rather than fail the whole save.
async function upsertWithColumnFallback(table, payload) {
  const row = { ...payload };
  const maxAttempts = Math.max(1, Object.keys(row).length + 2);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await DbApi.upsert(table, row);
    } catch (err) {
      const missing = parseMissingColumn(err.message);
      if (!missing || !hasKey(row, missing)) throw err;
      delete row[missing];
      if (!Object.keys(row).length) throw err;
    }
  }
  return DbApi.upsert(table, row);
}

// Convert "" / undefined / null to null so empty tolerance inputs don't
// fail the NUMERIC check constraint as NaN, while preserving 0 as 0.
function numericOrNull(value) {
  if (value === "" || value === undefined || value === null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function buildCarrierPayload(editCarrier) {
  const source = editCarrier || {};
  const emailKey = firstExistingKey(source, ["email", "contact_email"], "email");
  const contactKey = firstExistingKey(source, ["contact", "contact_name"], "contact");
  const phoneKey = firstExistingKey(source, ["phone", "contact_phone"], "phone");
  const claimKey = firstExistingKey(source, ["claim_ratio", "claim_rate", "claim"], "claim_ratio");
  const otdKey = firstExistingKey(source, ["on_time_pct", "otd"], "on_time_pct");
  const costKey = firstExistingKey(source, ["cost_per_mile", "avg_cost_per_mile"], "cost_per_mile");
  const ccKey = firstExistingKey(source, ["carrierconnect_enabled", "carrier_connect_enabled"], "carrierconnect_enabled");
  const czKey = firstExistingKey(source, ["czarlite_enabled", "czar_lite_enabled"], "czarlite_enabled");
  const pcKey = firstExistingKey(source, ["pcmiler_enabled", "pc_miler_enabled"], "pcmiler_enabled");

  const payload = {
    name: (source.name || "").toUpperCase(),
    scac: (source.scac || "").toUpperCase(),
    mode: (source.mode || "TL").toUpperCase(),
    status: source.status || "Active",
    [otdKey]: parseFloat(source.on_time_pct ?? source.otd) || 0,
    [claimKey]: parseFloat(source.claim_ratio ?? source.claim_rate ?? source.claim) || 0,
    [costKey]: parseFloat(source.cost_per_mile ?? source.avg_cost_per_mile) || 0,
    [contactKey]: ((source.contact ?? source.contact_name) || "").toUpperCase() || null,
    [phoneKey]: (source.phone ?? source.contact_phone) || null,
    [emailKey]: ((source.email ?? source.contact_email) || "").toLowerCase() || null,
    [czKey]: !!source.czarlite_enabled,
    [ccKey]: !!source.carrierconnect_enabled,
    [pcKey]: !!source.pcmiler_enabled,
    // REQ-06: invoice tolerance inputs were already on the form but were
    // never being persisted. Keep blanks as NULL so the system default
    // (5% / $100) kicks in via api/services/invoiceAudit.js.
    invoice_tolerance_pct:     numericOrNull(source.invoice_tolerance_pct),
    invoice_tolerance_abs_usd: numericOrNull(source.invoice_tolerance_abs_usd),
  };

  return payload;
}

export async function saveCarrierRecord(editCarrier) {
  const payload = buildCarrierPayload(editCarrier);
  if (editCarrier?.id) {
    return patchWithColumnFallback("carriers", editCarrier.id, payload);
  }
  const row = { id: "CAR-" + Date.now(), ...payload };
  return upsertWithColumnFallback("carriers", row);
}

// Hard delete. The carriers table has no inbound FKs, so removing a row
// does not cascade-fail on shipments/rates/invoices (those reference
// carriers by name/SCAC strings, not by id). The previous behaviour was
// a soft-delete that flipped status to 'Inactive'; the trash button now
// removes the row outright per the user's instruction.
export async function deleteCarrierRecord(carrierId) {
  if (!carrierId) throw new Error("carrierId is required");
  return DbApi.remove("carriers", carrierId);
}
