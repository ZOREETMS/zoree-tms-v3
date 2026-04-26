/**
 * Mobile rate service — orchestration layer for rate CRUD on the
 * mobile rate-management screens.
 *
 * Pure service layer: calls DbApi, returns plain data, no React
 * state, no UI side-effects. The Edit / Create / Duplicate / Delete
 * actions on RateManagementScreen all funnel through here.
 *
 * Web parity reference:
 *   frontend/src/services/rateService.js
 *     - MATCH_TYPE_VALUES / MATCH_TYPE_OPTIONS / normalizeMatchType
 *     - deleteRate, duplicateRate
 *   frontend/src/components/EditRateModal.jsx
 *     - buildInitialRateForm  → form-state seed
 *     - buildRatePayload      → DB-shape mapping on save
 *     - normalizeUnit, isLtlMode, parseLocation
 *
 * Field-shape parity with the web is intentional. Don't introduce
 * mobile-only aliases here — extend the shared types instead.
 */

import { DbApi } from '../lib/api';

/* ── Match-type enum (mirrors api/services/ltlRateMatcher.js) ─────── */

export const MATCH_TYPE_VALUES = Object.freeze({
  CITY: 'city_to_city',
  ZIP: 'zip_to_zip',
  COUNTRY: 'country_to_country',
});

export type MatchType = (typeof MATCH_TYPE_VALUES)[keyof typeof MATCH_TYPE_VALUES];

export interface MatchTypeOption {
  value: MatchType;
  label: string;
  hint: string;
}

export const MATCH_TYPE_OPTIONS: MatchTypeOption[] = [
  {
    value: MATCH_TYPE_VALUES.CITY,
    label: 'City to City',
    hint: 'Match origin & destination city names (case-insensitive)',
  },
  {
    value: MATCH_TYPE_VALUES.ZIP,
    label: 'Zip to Zip',
    hint: 'Match origin & destination 5-digit ZIP codes exactly',
  },
  {
    value: MATCH_TYPE_VALUES.COUNTRY,
    label: 'Country to Country',
    hint: 'Match origin & destination country codes only (city/zip ignored)',
  },
];

export function normalizeMatchType(value: unknown): MatchType {
  if (!value) return MATCH_TYPE_VALUES.CITY;
  const v = String(value).trim().toLowerCase().replace(/-/g, '_');
  if (v === MATCH_TYPE_VALUES.ZIP) return MATCH_TYPE_VALUES.ZIP;
  if (v === MATCH_TYPE_VALUES.COUNTRY) return MATCH_TYPE_VALUES.COUNTRY;
  return MATCH_TYPE_VALUES.CITY;
}

export function getMatchTypeLabel(value: unknown): string {
  const norm = normalizeMatchType(value);
  return MATCH_TYPE_OPTIONS.find((o) => o.value === norm)?.label || 'City to City';
}

/* ── Mode / Unit / Status / Service-Level enums ───────────────────── */

export const MODE_OPTIONS = ['TL', 'LTL', 'Intermodal', 'Flatbed', 'Reefer', 'Air Freight'] as const;
export const STATUS_OPTIONS = ['Active', 'Expiring', 'Expired'] as const;
export const SERVICE_LEVEL_OPTIONS = ['Standard', 'Express', 'Expedited', 'Economy'] as const;

export const UNIT_OPTIONS = [
  { value: 'per mile', label: 'PER MILE' },
  { value: 'per cwt', label: 'PER CWT' },
  { value: 'flat', label: 'FLAT' },
  { value: 'container', label: 'CONTAINER' },
] as const;

export const FREIGHT_CLASSES = [
  '50', '55', '60', '65', '70', '77.5', '85', '92.5',
  '100', '110', '125', '150', '175', '200', '250', '300',
] as const;

/** Default trailer when MODE flips. Mirrors web `DEFAULT_EQUIPMENT_BY_MODE`. */
export const DEFAULT_EQUIPMENT_BY_MODE: Record<string, string> = {
  LTL: 'LTL',
  TL: 'Dry Van 53ft',
};

/**
 * Equipment seed list — same data as the web's equipmentService when
 * the equipment_types table is empty. Inlined here so the rate edit
 * screen can populate its dropdown without depending on a separate
 * mobile equipment service. If/when an equipmentService is added on
 * mobile, replace this with a real lookup.
 */
export const SEED_EQUIPMENT = [
  { name: 'Dry Van 53ft', max_weight: 45000 },
  { name: 'Dry Van 48ft', max_weight: 44000 },
  { name: 'Reefer 53ft', max_weight: 43000 },
  { name: 'Reefer 48ft', max_weight: 42000 },
  { name: 'Flatbed 53ft', max_weight: 48000 },
  { name: 'Flatbed 48ft', max_weight: 47000 },
  { name: 'LTL', max_weight: 20000 },
  { name: 'Step Deck', max_weight: 43000 },
  { name: 'Tanker', max_weight: 45000 },
  { name: 'Intermodal Container 40ft', max_weight: 44800 },
  { name: 'Sprinter Van', max_weight: 3500 },
  { name: 'Straight Truck 26ft', max_weight: 10000 },
];

/* ── Pure helpers (also used by tests) ────────────────────────────── */

export function isLtlMode(mode: unknown): boolean {
  return String(mode || '').toUpperCase() === 'LTL';
}

/**
 * Normalize a free-text rate-unit value to the canonical select option.
 * Tolerant to legacy data ("$/mile", "Per CWT", "Flat", etc.).
 */
export function normalizeUnit(raw: unknown): string {
  if (!raw) return 'per mile';
  const u = String(raw).toLowerCase().trim();
  if (u.includes('mile')) return 'per mile';
  if (u.includes('cwt')) return 'per cwt';
  if (u === 'flat') return 'flat';
  if (u.includes('container')) return 'container';
  return 'per mile';
}

/** Parse a free-text "City, ST 12345" into structured city/state/zip. */
export function parseLocation(str: unknown): { city: string; state: string; zip: string } {
  if (!str) return { city: '', state: '', zip: '' };
  let s = String(str);
  let zip = '';
  const m = s.match(/(\d{5})/);
  if (m) {
    zip = m[1];
    s = s.replace(m[1], '').trim();
  }
  const parts = s.split(',');
  return {
    city: (parts[0] || '').trim(),
    state: (parts[1] || '').trim().replace(/\s+/g, ''),
    zip,
  };
}

/**
 * Pick the first non-empty value from a record. Field-aliases on rate
 * rows are messy (`rate` / `rate_per_mile`, `eff` / `effective_date`,
 * etc.) — this lets the form seed code declare a tolerant priority list.
 */
export function getField(r: any, ...keys: string[]): any {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k];
  }
  return '';
}

/* ── Form state types ─────────────────────────────────────────────── */

/**
 * Shape held in the EditRateScreen component's `useState`. All
 * editable fields are strings (or booleans) so the form behaves
 * predictably with mobile text inputs — coercion to numbers happens
 * once in `buildRatePayload`.
 */
export interface RateFormState {
  lane: string;
  mode: string;
  equipment: string;
  matchType: MatchType;
  origin: string;
  originCity: string;
  originState: string;
  originZip: string;
  originCountry: string;
  dest: string;
  destCity: string;
  destState: string;
  destZip: string;
  destCountry: string;
  carrier: string;
  status: string;
  rate: string;
  unit: string;
  fsc: string;
  discount: string;
  discountFlat: string;
  eff: string;
  exp: string;
  miles: string;
  transitDays: string;
  serviceLevel: string;
  czarlite: boolean;
  czarliteClass: string;
  czarliteMinWt: string;
  czarliteMaxWt: string;
}

/**
 * Seed a fresh form state from an existing rate row. When `rate` is
 * null/undefined the form is initialised for a new rate.
 */
export function buildInitialRateForm(rate?: any): RateFormState {
  const r = rate || {};
  const oLoc = parseLocation(r.origin);
  const dLoc = parseLocation(r.dest);
  const ltl = isLtlMode(r.mode);
  return {
    lane: r.lane || '',
    mode: r.mode || 'TL',
    equipment: r.equipment || '',
    matchType: normalizeMatchType(r.match_type || r.matchType),
    origin: r.origin || '',
    originCity: r.originCity || oLoc.city,
    originState: r.originState || oLoc.state,
    originZip: r.origin_zip || r.originZip || oLoc.zip,
    originCountry: r.origin_country || r.originCountry || 'USA',
    dest: r.dest || '',
    destCity: r.destCity || dLoc.city,
    destState: r.destState || dLoc.state,
    destZip: r.dest_zip || r.destZip || dLoc.zip,
    destCountry: r.dest_country || r.destCountry || 'USA',
    carrier: r.carrier || '',
    status: r.status || 'Active',
    rate: String(getField(r, 'rate', 'rate_per_mile')).replace(/\$/g, ''),
    unit: normalizeUnit(getField(r, 'unit', 'rate_unit')),
    fsc: String(getField(r, 'fsc', 'fsc_pct')).replace(/%/g, ''),
    discount: String(getField(r, 'discount', 'discount_pct') || ''),
    discountFlat: String(getField(r, 'discountFlat', 'discount_flat', 'discount_amt') || ''),
    eff: String(getField(r, 'eff', 'effective', 'effective_date', 'effectiveDate') || ''),
    exp: String(getField(r, 'exp', 'expires', 'expiry_date', 'expiryDate') || ''),
    miles: String(getField(r, 'miles', 'distance') || ''),
    transitDays: String(getField(r, 'transitDays', 'transit_days') || ''),
    serviceLevel: String(getField(r, 'serviceLevel', 'service_level') || ''),
    czarlite: !!r.czarlite,
    czarliteClass: String(getField(r, 'czarliteClass', 'czarlite_class', 'freight_class') || '70'),
    czarliteMinWt: String(getField(r, 'czarliteMinWt', 'czarlite_min_wt', 'czar_min_wt') || (ltl ? 500 : '')),
    czarliteMaxWt: String(getField(r, 'czarliteMaxWt', 'czarlite_max_wt', 'czar_max_wt') || (ltl ? 9999 : '')),
  };
}

/**
 * Build the DB row from the form state. Mirrors the payload shape in
 * frontend/src/components/EditRateModal.jsx → buildPayload exactly so
 * a rate edited on mobile reads identically on web.
 *
 * Notes on the trickier fields:
 *  - `origin` / `dest`: the matcher uses the structured `*_zip` /
 *    `*_country` columns, but legacy display surfaces still read the
 *    free-text strings — so we rebuild them from the structured form.
 *  - `rate` / `fsc` get formatted as strings ("$X.XX" / "X.X%") to
 *    match the web's DB convention.
 *  - CzarLite weight breaks are persisted as null on non-LTL modes so
 *    the planner doesn't accidentally cap a TL lane at LTL volumes.
 */
export function buildRatePayload(form: RateFormState): Record<string, any> {
  const origin = [form.originCity, form.originState?.toUpperCase()].filter(Boolean).join(', ')
    + (form.originZip ? ' ' + form.originZip : '');
  const dest = [form.destCity, form.destState?.toUpperCase()].filter(Boolean).join(', ')
    + (form.destZip ? ' ' + form.destZip : '');

  const rateNum = parseFloat(String(form.rate).replace(/[^0-9.]/g, ''));
  const fscNum = parseFloat(String(form.fsc).replace(/[^0-9.]/g, ''));
  const ltl = isLtlMode(form.mode);

  return {
    lane: form.lane,
    mode: form.mode,
    equipment: form.equipment || null,
    match_type: normalizeMatchType(form.matchType),
    origin_zip: form.originZip || null,
    dest_zip: form.destZip || null,
    origin_country: (form.originCountry || 'USA').toUpperCase(),
    dest_country: (form.destCountry || 'USA').toUpperCase(),
    origin: origin || form.origin,
    dest: dest || form.dest,
    carrier: form.carrier,
    status: form.status,
    rate: isNaN(rateNum) ? form.rate : `$${rateNum.toFixed(2)}`,
    unit: form.unit,
    fsc: isNaN(fscNum) ? form.fsc : `${fscNum.toFixed(1)}%`,
    discount: form.discount ? parseFloat(form.discount) : null,
    discount_flat: form.discountFlat ? parseFloat(form.discountFlat) : null,
    eff: form.eff || null,
    exp: form.exp || null,
    miles: form.miles ? Number(form.miles) : null,
    transit_days: form.transitDays ? Number(form.transitDays) : null,
    service_level: form.serviceLevel || null,
    czarlite: form.czarlite,
    czarlite_class: form.czarliteClass ? Number(form.czarliteClass) : null,
    czarlite_min_wt: ltl && form.czarliteMinWt ? Number(form.czarliteMinWt) : null,
    czarlite_max_wt: ltl && form.czarliteMaxWt ? Number(form.czarliteMaxWt) : null,
  };
}

/* ── Field-change side effects ────────────────────────────────────── */

/**
 * Apply a single field change to the form, keeping mode-dependent
 * fields consistent. Mirrors the inline mode-flip logic in the web
 * EditRateModal:
 *   - switching to LTL turns CzarLite on and restores default weight
 *     breaks (500 / 9999) so the planner has a working LTL window
 *   - switching away clears the LTL-tariff weight breaks so the
 *     planner doesn't accidentally cap a TL lane at LTL volumes
 *   - if no equipment is pinned, suggest a default trailer for the
 *     new mode (DEFAULT_EQUIPMENT_BY_MODE)
 *
 * Pure function — given the same inputs, returns the same output, no
 * side-effects. The test suite is the contract.
 */
export function applyRateFieldChange<K extends keyof RateFormState>(
  form: RateFormState,
  key: K,
  value: RateFormState[K],
): RateFormState {
  const next = { ...form, [key]: value } as RateFormState;
  if (key !== 'mode') return next;

  const upper = String(value).toUpperCase();
  const isLtl = upper === 'LTL';
  if (isLtl) {
    next.czarlite = true;
    if (!next.czarliteMinWt) next.czarliteMinWt = '500';
    if (!next.czarliteMaxWt) next.czarliteMaxWt = '9999';
  } else {
    next.czarliteMinWt = '';
    next.czarliteMaxWt = '';
  }
  if (!next.equipment && DEFAULT_EQUIPMENT_BY_MODE[upper]) {
    next.equipment = DEFAULT_EQUIPMENT_BY_MODE[upper];
  }
  return next;
}

/* ── Validation ───────────────────────────────────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
  patchedForm?: RateFormState;
}

/**
 * Validate the form for save. Mirrors the web modal's pre-save
 * checks. Also auto-generates a lane id from carrier + cities + mode
 * if the user left it blank — so save-without-typing still works.
 */
export function validateRateForm(
  form: RateFormState,
  opts: { isNew: boolean; existingLanes?: string[] },
): ValidationResult {
  let patched: RateFormState | undefined;

  if (!form.lane && form.carrier && form.originCity && form.destCity) {
    const carrierCode = (form.carrier || '')
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 4);
    const oCode = (form.originCity || '').slice(0, 3).toUpperCase();
    const dCode = (form.destCity || '').slice(0, 3).toUpperCase();
    const modeCode = (form.mode || 'TL').toUpperCase();
    const svcCode = (form.serviceLevel || 'STD').slice(0, 3).toUpperCase();
    const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const generated = `${carrierCode}-${oCode}-${dCode}-${modeCode}-${svcCode}-${dateCode}`;
    patched = { ...form, lane: generated };
  }

  const effective = patched || form;

  if (!effective.lane) {
    return { ok: false, error: 'Lane ID is required.' };
  }

  if (
    opts.isNew
    && Array.isArray(opts.existingLanes)
    && opts.existingLanes.includes(effective.lane)
  ) {
    return {
      ok: false,
      error: `Duplicate Lane ID: "${effective.lane}" already exists. Please use a unique Lane ID.`,
      patchedForm: patched,
    };
  }

  if (!(effective.originCity || effective.origin)
    || !(effective.destCity || effective.dest)
    || !effective.carrier) {
    return {
      ok: false,
      error: 'Origin, Destination, and Carrier are required.',
      patchedForm: patched,
    };
  }

  return { ok: true, patchedForm: patched };
}

/* -- Mutations ----------------------------------------------------- */

/**
 * Save a rate row. Routes through PATCH for an edit (id provided) or
 * POST/upsert for a create. Always returns the API response so the
 * caller can refresh its local cache.
 */
export async function saveRate(
  id: string | null | undefined,
  payload: Record<string, any>,
  isNew: boolean,
): Promise<any> {
  if (isNew || !id) {
    return DbApi.upsert('rates', payload);
  }
  return DbApi.patch('rates', id, payload);
}

/** Delete a rate by row id. Throws on failure so the UI can toast. */
export async function deleteRate(id: string): Promise<any> {
  if (!id) throw new Error('deleteRate: id is required');
  return DbApi.remove('rates', id);
}

/**
 * Duplicate an existing rate row. Strips id + server-managed
 * timestamps, appends " (COPY)" to the lane so the new row is
 * distinguishable in the list, and upserts via the create path.
 * Mirrors web rateService.duplicateRate.
 */
export async function duplicateRate(rate: any): Promise<any> {
  if (!rate || typeof rate !== 'object') {
    throw new Error('duplicateRate: rate object is required');
  }
  const clone: Record<string, any> = { ...rate };
  delete clone.id;
  delete clone.created_at;
  delete clone.updated_at;
  const baseLane = String(rate.lane || '').trim() || 'NEW-LANE';
  clone.lane = `${baseLane} (COPY)`;
  return DbApi.upsert('rates', clone);
}
