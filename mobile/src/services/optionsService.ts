/**
 * optionsService - pure functions that turn DataContext rows into
 * dropdown-ready option lists. Lives in the service layer so screens
 * never derive options inline (CLAUDE_RULES - no business logic in UI).
 *
 * Used by OrderFormScreen and OrderEditModal to populate Customer,
 * Origin, and Destination pickers from existing data instead of
 * free-text typing (REQ from QA bug #86, #87).
 */
export interface SelectOption {
  /** Value persisted to the form / DB. Always a non-empty string. */
  value: string;
  /** Human label shown in the picker row. Falls back to value. */
  label: string;
  /** Optional secondary text for locations. */
  sublabel?: string;
  /**
   * Free-form metadata carried alongside the option. Origin/Destination
   * options use this to surface the source location row's `city`,
   * `state`, `zip`, and `name` so the form screen can auto-populate the
   * sibling City / State / ZIP inputs the moment the user picks an
   * address (QA bug #115). Customer options leave it undefined.
   */
  meta?: Record<string, any>;
}

/**
 * QA bug #104 fix: previously a plain Set keyed on the trimmed name,
 * so a customer entered with a trailing non-breaking space, or with
 * subtle case differences, survived as separate options - the New
 * Order Customer dropdown showed multiple AT and T rows. We now
 * normalise the key (case-fold, collapse all Unicode whitespace
 * including NBSP and zero-width to a single regular space) before
 * de-duping, while keeping the first-seen casing for display.
 */
const SPACE_LIKE_RE = new RegExp(
  '[\\s\\u00A0\\u1680\\u2000-\\u200B\\u202F\\u205F\\u3000]+',
  'g',
);

function customerDedupKey(name: string): string {
  return name.replace(SPACE_LIKE_RE, ' ').trim().toLowerCase();
}

/**
 * Distinct customer names sourced from BOTH the OMS customer master
 * (oms_customers, when DataContext has loaded it) AND from customer
 * names seen on existing orders. Sorted A-Z.
 *
 * QA bug #113 fix: previously this returned only customers that had
 * already been used on at least one order, so a fresh tenant whose OMS
 * had ~50 customers but only 3 distinct ones across pre-seeded orders
 * showed only 3 entries in the New Order dropdown - while the web
 * always saw the full master via the OMS app. Merging both sources
 * keeps the long-tail (legacy customers no longer in the OMS still
 * appear, so historical-style orders can still be re-keyed) while also
 * surfacing every active OMS customer up-front.
 *
 * Backwards-compatible signature: callers passing only `orders`
 * continue to work; the second `customers` arg is optional. The
 * dedup keys both sources by case-folded / whitespace-collapsed name
 * so "ACME Corp" from the master and "acme  corp" from a legacy order
 * row do not surface as duplicate rows.
 */
export function customerOptions(
  orders: any[] | null | undefined,
  customers?: any[] | null | undefined,
): SelectOption[] {
  const byKey = new Map<string, string>();

  // OMS master takes precedence for casing - it's the canonical name.
  if (Array.isArray(customers)) {
    for (const c of customers) {
      const raw = String(c?.name || '').trim();
      if (!raw) continue;
      const key = customerDedupKey(raw);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, raw);
    }
  }

  // Then fold in anything seen on actual orders so legacy customers
  // (deactivated / pre-OMS) still appear. First-seen casing wins so a
  // master row already in `byKey` is not overwritten by a stray order.
  if (Array.isArray(orders)) {
    for (const o of orders) {
      const raw = String(o?.customer || '').trim();
      if (!raw) continue;
      const key = customerDedupKey(raw);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, raw);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

/**
 * Origin / destination options derived from the locations master
 * table. Each option value is the formatted "City, ST ZIP" string
 * the orders table stores in origin/dest columns; sublabel carries
 * the location display name when present (e.g. warehouse code).
 *
 * QA bug #105 fix: previously the mobile picker dropped any location
 * whose City AND State were both blank, so warehouses created on the
 * web with only a name populated (e.g. "College Park") never reached
 * the dropdown - the mobile origin/destination list looked like a
 * strict subset of the web. The web LocationSearchDropdown queries
 * the master directly with no city gate, so a location is shown as
 * long as it has SOMETHING the user can recognise. We now include
 * any location that has at least one of: name, city, or state. When
 * the City is missing we fall back to the name as the persisted
 * value (the orders table stores the origin/dest as a free-text
 * string, so a warehouse name is a valid value - the planner already
 * supports it on the web side).
 */
export function locationOptions(locations: any[] | null | undefined): SelectOption[] {
  if (!Array.isArray(locations)) return [];
  const items: SelectOption[] = [];
  for (const l of locations) {
    const city = String(l?.city || '').trim();
    const state = String(l?.state || '').trim().toUpperCase();
    const zip = String(l?.zip || l?.postal_code || '').trim();
    const name = String(l?.name || '').trim();

    if (!name && !city && !state) continue;

    const addressParts: string[] = [];
    if (city && state) addressParts.push(`${city}, ${state}`);
    else if (city) addressParts.push(city);
    else if (state) addressParts.push(state);
    const address = (addressParts.join('') + (zip ? ` ${zip}` : '')).trim();

    const value = address || name;
    if (!value) continue;
    const label = name || address || value;
    let sublabel: string | undefined;
    if (name && address && name !== address) {
      sublabel = address;
    } else if (!name && address && address !== value) {
      sublabel = address;
    }

    // QA bug #115: carry the original row's structured fields in
    // `meta` so the form screen can auto-populate the sibling City /
    // State / ZIP inputs the moment the user picks this option. Without
    // this, the form had only the composed "City, ST ZIP" string to
    // re-parse, which threw away casing and any location name. We store
    // the trimmed values so the form doesn't have to re-clean them.
    items.push({
      value,
      label,
      sublabel,
      meta: { name, city, state, zip },
    });
  }
  const dedup = new Map<string, SelectOption>();
  for (const it of items) {
    if (!dedup.has(it.value)) dedup.set(it.value, it);
  }
  return Array.from(dedup.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}
