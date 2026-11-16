// ═══════════════════════════════════════════════════════════════════
// Client domains (migration 052) — which domains the user can work in,
// and switching between them. Switching reloads the app so every
// screen and cache starts clean in the new domain.
// ═══════════════════════════════════════════════════════════════════
import { DomainsApi } from "../lib/api";
import { getActiveDomain, setActiveDomain } from "../lib/domain";

/** @returns {Promise<{active:string, domains:Array<{code:string,name:string,isDefault:boolean}>}>} */
export async function fetchMyDomains() {
  const r = await DomainsApi.mine();
  // Remember the domain the API resolved (the user's default on first load)
  // so realtime filtering and every later request agree on it.
  if (r.active && r.active !== getActiveDomain()) setActiveDomain(r.active);
  return { active: r.active || getActiveDomain(), domains: Array.isArray(r.domains) ? r.domains : [] };
}

export function switchDomain(code) {
  if (!code || code === getActiveDomain()) return;
  setActiveDomain(code);
  window.location.reload();
}
