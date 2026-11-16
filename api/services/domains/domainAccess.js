// ═══════════════════════════════════════════════════════════════════
// Domain access — which domains a user may work in (user_domain_access).
// 60-second in-process cache per user; reads use the service role.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { DEFAULT_DOMAIN } = require('./domainCodes');

const TTL_MS = 60_000;
const cache = new Map(); // userId -> { at, domains }

function restHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * @param {string} userId  auth user id (user_profiles.id)
 * @returns {Promise<Array<{code:string, name:string, isDefault:boolean}>>}
 */
async function listForUser(userId) {
  if (!userId) return [{ code: DEFAULT_DOMAIN, name: 'Zoree', isDefault: true }];
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.domains;
  const url = `${process.env.SUPABASE_URL}/rest/v1/user_domain_access`
    + `?select=domain_code,is_default,domains(name,active)&user_id=eq.${encodeURIComponent(userId)}`;
  const res = await fetch(url, { headers: restHeaders() });
  if (!res.ok) throw new Error(`domain access read failed (${res.status})`);
  const rows = await res.json();
  const domains = rows
    .filter((r) => !r.domains || r.domains.active !== false)
    .map((r) => ({ code: r.domain_code, name: (r.domains && r.domains.name) || r.domain_code, isDefault: !!r.is_default }));
  const result = domains.length ? domains : [{ code: DEFAULT_DOMAIN, name: 'Zoree', isDefault: true }];
  cache.set(userId, { at: Date.now(), domains: result });
  return result;
}

/** Pick the domain for a request: the requested one if allowed, else the user's default. */
function pickDomain(domains, requested) {
  if (requested) return domains.find((d) => d.code === requested) ? requested : null;
  return (domains.find((d) => d.isDefault) || domains[0]).code;
}

function clearCache() { cache.clear(); }

module.exports = { listForUser, pickDomain, clearCache };
