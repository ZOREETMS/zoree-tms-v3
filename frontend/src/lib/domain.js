// ═══════════════════════════════════════════════════════════════════
// Active client domain (migration 052) — kept in localStorage and sent
// to the API as X-Zoree-Domain on every request. The API checks the
// user has access; with no header it uses the user's default domain.
// ═══════════════════════════════════════════════════════════════════

const KEY = "zoree_domain";

export function getActiveDomain() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function setActiveDomain(code) {
  try { localStorage.setItem(KEY, code); } catch { /* storage disabled */ }
}

export function clearActiveDomain() {
  try { localStorage.removeItem(KEY); } catch { /* storage disabled */ }
}

/** Header to add to any request to the Zoree API. */
export function domainHeaders() {
  const d = getActiveDomain();
  return d ? { "X-Zoree-Domain": d } : {};
}

/** True when a row belongs to the active domain (or carries no domain, e.g. a delete event). */
export function isInActiveDomain(row) {
  const active = getActiveDomain();
  return !active || !row || !row.domain_code || row.domain_code === active;
}
