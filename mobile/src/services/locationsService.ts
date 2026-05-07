/**
 * locationsService — service-layer wrapper for the public.locations
 * master table. Exists so OrderFormScreen / CreateLocationModal never
 * touch DbApi.upsert directly (CLAUDE_RULES §3 + §4 — UI never calls
 * the API or DB layer). Mirrors the web's LocationFieldsEditor flow:
 * a small set of human-typed fields, normalised to the canonical
 * "City, ST ZIP" format the orders table indexes on.
 *
 * QA bug #114: the mobile New Order Origin/Destination dropdown had no
 * way to add a missing location. Web users open LocationFieldsEditor
 * and persist a new row; mobile users had to bounce to the web. This
 * service exposes `createLocation()` so a "+ Create new" affordance on
 * the picker can save the row and return it for immediate selection.
 */

import { DbApi } from '../shared/api';

/**
 * Public shape callers hand to `createLocation`. All fields are
 * optional so a quick "City, ST" entry still saves; the back-end
 * defaults id, tenant_id, created_at via the DB schema.
 */
export interface NewLocationInput {
  name?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * Composed "City, ST ZIP" value the orders table expects in
 * origin/dest columns. Mirrors `composeAddress` in ordersService so a
 * row created here looks indistinguishable from one composed inline by
 * buildOrderSavePayload — keeping the dropdown's `value` field stable
 * across input paths.
 */
export function locationDisplayValue(loc: NewLocationInput): string {
  const c = String(loc.city || '').trim();
  const s = String(loc.state || '').trim().toUpperCase();
  const z = String(loc.zip || '').trim();
  let head = '';
  if (c && s) head = `${c}, ${s}`;
  else if (c) head = c;
  else if (s) head = s;
  return (head + (z ? ` ${z}` : '')).trim();
}

/**
 * Field-level validation. Returns an array of human-readable messages
 * — empty means the input is acceptable. We intentionally allow either
 * a name OR a city to satisfy "something to label this location with",
 * because the web's locationOptions inclusion rule is the same (see
 * services/optionsService.locationOptions).
 */
export function validateNewLocation(input: NewLocationInput): string[] {
  const errors: string[] = [];
  const name = String(input.name || '').trim();
  const city = String(input.city || '').trim();
  const state = String(input.state || '').trim();
  const zip = String(input.zip || '').trim();
  if (!name && !city) {
    errors.push('Provide at least a Name or City for this location.');
  }
  if (state && state.length !== 2) {
    errors.push('State must be a 2-letter code (e.g. CA).');
  }
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) {
    errors.push('ZIP must be 5 digits (or 5+4).');
  }
  return errors;
}

/**
 * Persist a new row to public.locations and return the created row.
 * Throws a validation Error (with `.fields`) when the input is bad,
 * letting the caller surface the failure inline rather than firing a
 * round-trip that would 4xx anyway.
 *
 * Why DbApi.upsert vs a dedicated endpoint: locations is in the
 * server's ALLOWED whitelist for the generic /api/db/:table route, and
 * there's no order-side audit cascade required for a master-data row,
 * so a bespoke /api/locations endpoint would be pure ceremony. The
 * server-side history pipeline (REQ-02) is reserved for orders /
 * shipments mutations.
 */
export async function createLocation(input: NewLocationInput): Promise<any> {
  const errors = validateNewLocation(input);
  if (errors.length) {
    const err = new Error(errors.join(' ')) as Error & { fields?: string[] };
    err.fields = errors;
    throw err;
  }
  const payload = {
    name: String(input.name || '').trim() || null,
    city: String(input.city || '').trim() || null,
    state: String(input.state || '').trim().toUpperCase() || null,
    zip: String(input.zip || '').trim() || null,
  };
  const created = await DbApi.upsert('locations', payload);
  // Normalise dbUpsert response shapes (some return [row], some {row}).
  if (Array.isArray(created)) return created[0] || payload;
  if (created && typeof created === 'object' && 'row' in created) {
    return (created as any).row || payload;
  }
  return created || payload;
}
