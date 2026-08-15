/**
 * Fuel Surcharge Service (Migration 045)
 * ───────────────────────────────────────
 * Pure logic for the Fuel Surcharge page: parsing an uploaded FSC
 * schedule workbook (e.g. CHR_Fuel_Surcharge_Lookup.xlsx) into
 * { min_price, fsc_pct } brackets, plus thin wrappers over /api/fsc.
 * Mirrors the rateUploadService pattern (CLAUDE_RULES §2/§4 — the page
 * stays presentational; all parsing/IO lives here).
 *
 * Expected workbook shape: any sheet with a header row containing a
 * price column ("PPG", "price", "$/gal", ...) and an FSC column
 * ("FSC %", "surcharge", ...). Rows below with numeric values in both
 * columns become brackets; note/footer rows are skipped. FSC values may
 * be fractions (0.174) or percents (17.4) — when every value is <= 1.5
 * the list is treated as fractions and scaled ×100 (matches the
 * server-side normalizeBrackets rule).
 */

import * as XLSX from "xlsx";
import { FscApi } from "../lib/api";
import { invalidateQuoteCache } from "./ordersService";

const PRICE_HEADER_RE = /ppg|price|\$\s*\/\s*gal|per\s*gal|diesel/i;
const FSC_HEADER_RE = /fsc|surcharge/i;

/**
 * Bracket lookup — the row with the largest min_price <= price wins.
 * Client-side twin of api/services/fscSchedule.lookupFscPct (kept in
 * sync so the page calculator matches what rating will charge).
 */
export function lookupFscPct(brackets, price) {
  const p = parseFloat(price);
  if (!Number.isFinite(p) || !Array.isArray(brackets) || !brackets.length) return null;
  let best = null;
  for (const b of brackets) {
    const min = parseFloat(b.min_price);
    if (!Number.isFinite(min) || min > p) continue;
    if (best === null || min > best.min) best = { min, pct: parseFloat(b.fsc_pct) };
  }
  return best && Number.isFinite(best.pct) ? best.pct : null;
}

/** Locate the header row + column indexes inside one sheet's AOA. */
function findScheduleColumns(aoa) {
  for (let r = 0; r < Math.min(aoa.length, 20); r++) {
    const row = aoa[r] || [];
    let priceCol = -1;
    let fscCol = -1;
    row.forEach((cell, c) => {
      const s = String(cell || "");
      if (priceCol === -1 && PRICE_HEADER_RE.test(s)) priceCol = c;
      else if (fscCol === -1 && FSC_HEADER_RE.test(s)) fscCol = c;
    });
    if (priceCol !== -1 && fscCol !== -1) return { headerRow: r, priceCol, fscCol };
  }
  return null;
}

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v === "" || v == null) return null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse an uploaded schedule file into brackets.
 *
 * @returns {Promise<{
 *   brackets: Array<{min_price:number, fsc_pct:number}>,  // sorted, percent form
 *   sheetName: string,
 *   skipped: number,          // non-numeric rows ignored (notes/footers)
 *   converted: boolean,       // true when fractions were scaled ×100
 * }>}
 */
export async function parseFscScheduleFile(file) {
  if (!file) throw new Error("parseFscScheduleFile: file is required");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array" });

  // Prefer sheets whose NAME looks like a schedule, then scan the rest.
  const ordered = [...wb.SheetNames].sort((a, b) => {
    const score = (n) => (/fsc|schedule/i.test(n) ? 0 : 1);
    return score(a) - score(b);
  });

  for (const sheetName of ordered) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const found = findScheduleColumns(aoa);
    if (!found) continue;

    const raw = [];
    let skipped = 0;
    for (let r = found.headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] || [];
      const price = toNumber(row[found.priceCol]);
      const pct = toNumber(row[found.fscCol]);
      if (price == null || pct == null || price < 0 || pct < 0) {
        if (row.some((c) => c !== null && c !== "")) skipped++;
        continue;
      }
      raw.push({ min_price: price, fsc_pct: pct });
    }
    if (!raw.length) continue;

    // Fraction → percent normalization (0.174 → 17.4).
    const converted = raw.every((b) => b.fsc_pct <= 1.5);
    const byPrice = new Map();
    for (const b of raw) {
      const pct = converted ? Math.round(b.fsc_pct * 100 * 10000) / 10000 : b.fsc_pct;
      byPrice.set(b.min_price, { min_price: b.min_price, fsc_pct: pct });
    }
    const brackets = [...byPrice.values()].sort((a, b) => a.min_price - b.min_price);
    return { brackets, sheetName, skipped, converted };
  }

  throw new Error(
    'No FSC schedule found. The workbook needs a sheet with a price column ("PPG ($/gal)") and an FSC column ("FSC %").'
  );
}

/* ── API wrappers (the page never calls fetch/api directly) ── */

export function fetchEiaPrice({ refresh = false } = {}) {
  return FscApi.eiaCurrent(refresh).then((r) => {
    // A forced refresh can land a new diesel price, which changes FSC
    // pricing for every EIA-enabled carrier — cached quotes are stale.
    if (refresh) invalidateQuoteCache();
    return r.eia;
  });
}

export function setManualEiaPrice({ price, priceDate }) {
  return FscApi.eiaManual({ price, priceDate }).then((r) => {
    invalidateQuoteCache();
    return r.eia;
  });
}

export function fetchCarrierSchedule(carrierId) {
  return FscApi.getSchedule(carrierId).then((r) => r.brackets || []);
}

export function saveCarrierSchedule(carrierId, brackets) {
  return FscApi.saveSchedule(carrierId, brackets).then((r) => {
    // Schedule changes reprice quotes for this carrier — mirror
    // carriersService.saveCarrierRecord's cache invalidation.
    invalidateQuoteCache();
    return r.brackets || [];
  });
}

export function deleteCarrierSchedule(carrierId) {
  return FscApi.deleteSchedule(carrierId).then((r) => {
    invalidateQuoteCache();
    return r;
  });
}
