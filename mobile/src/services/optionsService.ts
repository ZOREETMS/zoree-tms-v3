/**
 * optionsService - pure functions that turn DataContext rows into
 * dropdown-ready option lists. Lives in the service layer so screens
 * never derive options inline (CLAUDE_RULES - no business logic in UI).
 *
 * Used by OrderFormScreen and OrderEditModal to populate Customer,
 * Origin, and Destination pickers from existing data instead of
 * free-text typing (REQ from QA bug #86, #87).
 *
 * Conventions:
 *  - Returns plain { value, label } items so the picker UI stays
 *    decoupled from the underlying row shape.
 *  - De-duplicates and sorts alphabetically for stable rendering.
 *  - Always tolerates undefined / non-array inputs so a slow data
 *    refresh never crashes a form.
 */
export interface SelectOption {
  /** Value persisted to the form / DB. Always a non-empty string. */
  value: string;
  /** Human label shown in the picker row. Falls back to value. */
  label: string;
  /** Optional secondary text (e.g. "Chicago, IL 60601") for locations. */
  sublabel?: string;
}

/**
 * Distinct customer names seen on existing orders, sorted A-Z.
 * Mobile does not load a dedicated customers table today (DataContext
 * has no customers field), so we derive the list from order rows -
 * which is also what the web app does for its customer suggest box.
 */
export function customerOptions(orders: any[] | null | undefined): SelectOption[] {
  if (!Array.isArray(orders)) return [];
  const seen = new Set<string>();
  for (const o of orders) {
    const name = String(o?.customer || '').trim();
    if (name) seen.add(name);
  }
  return Array.from(seen)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

/**
 * Origin / destination options derived from the locations master
 * table. Each option value is the formatted "City, ST ZIP" string
 * the orders table stores in origin/dest columns; sublabel carries
 * the location display name when present (e.g. warehouse code).
 *
 * Falls back gracefully when columns are missing - supabase is
 * permissive about NULLs on the locations table.
 */
export function locationOptions(locations: any[] | null | undefined): SelectOption[] {
  if (!Array.isArray(locations)) return [];
  const items: SelectOption[] = [];
  for (const l of locations) {
    const city = String(l?.city || '').trim();
    const state = String(l?.state || '').trim().toUpperCase();
    const zip = String(l?.zip || l?.postal_code || '').trim();
    const name = String(l?.name || '').trim();

    // Build "City, ST ZIP" - same format saveOrder ships to the API.
    // Require at least a city or state to be present: a bare ZIP
    // string ("10001") is not a meaningful origin/dest value because
    // the orders table stores these as full address strings.
    if (!city && !state) continue;
    const addressParts: string[] = [];
    if (city && state) addressParts.push(`${city}, ${state}`);
    else if (city) addressParts.push(city);
    else if (state) addressParts.push(state);
    const value = (addressParts.join('') + (zip ? ` ${zip}` : '')).trim();

    if (!value) continue;
    items.push({
      value,
      label: name || value,
      sublabel: name ? value : undefined,
    });
  }
  // De-dup by value (a warehouse and its dock can share an address).
  const dedup = new Map<string, SelectOption>();
  for (const it of items) {
    if (!dedup.has(it.value)) dedup.set(it.value, it);
  }
  return Array.from(dedup.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
