// ═══════════════════════════════════════════════════════════════════
// Microsoft (Entra ID) single sign-on for people.
//
// Supabase Auth's Azure provider does the OAuth round trip with the
// customer's Entra tenant and issues the normal Supabase session, so
// every existing route keeps working with the same token. This module
// decides what a signed-in Microsoft user may do:
//
//   - only the configured tenant is accepted (MS_SSO_TENANT_ID);
//   - roles come from Entra app roles on the ID token, mapped to TMS
//     roles (MS_SSO_ROLE_MAP, e.g. "AP.Approver:finance");
//   - no mapped role → no access (the profile is disabled).
//
// Claims are read from the identity Supabase stored at sign-in
// (user.identities[].identity_data). Users can edit their own
// user_metadata through the auth API, but not their identities, so a
// user can't grant themselves a role.
//
// Config (api/.env):
//   MS_SSO_ENABLED     true to show "Sign in with Microsoft"
//   MS_SSO_TENANT_ID   Entra tenant (directory) ID, a GUID
//   MS_SSO_ROLE_MAP    AppRole:tmsRole pairs, comma-separated
//   MS_SSO_DOMAIN      domain the user works in, e.g. KESTREL_BAY
//   MS_SSO_LABEL       button text (optional)
// ═══════════════════════════════════════════════════════════════════
'use strict';

const DEFAULT_ROLE_MAP = 'AP.Approver:finance,AP.Reviewer:viewer,TMS.Admin:admin';
const ROLE_ORDER = ['admin', 'finance', 'planner', 'viewer']; // highest first
const ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0\/?$/i;

/** "A:b, C:d" → Map(A → b). Unknown TMS roles are dropped. */
function parseRoleMap(text) {
  const map = new Map();
  for (const pair of String(text || '').split(',')) {
    const [appRole, tmsRole] = pair.split(':').map((s) => (s || '').trim());
    if (appRole && ROLE_ORDER.includes((tmsRole || '').toLowerCase())) map.set(appRole, tmsRole.toLowerCase());
  }
  return map;
}

function config(env = process.env) {
  const tenantId = String(env.MS_SSO_TENANT_ID || '').trim().toLowerCase();
  return {
    enabled: String(env.MS_SSO_ENABLED || '').trim().toLowerCase() === 'true' && /^[0-9a-f-]{36}$/.test(tenantId),
    tenantId,
    roleMap: parseRoleMap(env.MS_SSO_ROLE_MAP || DEFAULT_ROLE_MAP),
    domain: String(env.MS_SSO_DOMAIN || '').trim().toUpperCase() || null,
    label: String(env.MS_SSO_LABEL || '').trim() || 'Sign in with Microsoft',
  };
}

function azureIdentity(user) {
  return (Array.isArray(user && user.identities) ? user.identities : []).find((i) => i && i.provider === 'azure') || null;
}

/** Tenant ID from the ID token: the issuer URL, else the tid claim. */
function tenantOf(data) {
  const claims = (data && data.custom_claims) || {};
  const m = ISSUER_RE.exec(String((data && data.iss) || claims.iss || ''));
  return String((m && m[1]) || claims.tid || '').toLowerCase();
}

/**
 * What this Microsoft user may do. Pure: no I/O.
 * @returns {{ok:true, roles:string[], activeRole:string, appRoles:string[], email:string, name:string, tenantId:string}
 *         | {ok:false, status:number, error:string}}
 */
function decide(user, cfg) {
  if (!cfg || !cfg.enabled) return { ok: false, status: 404, error: 'Microsoft sign-in is not set up.' };
  const identity = azureIdentity(user);
  if (!identity) return { ok: false, status: 400, error: 'This session did not come from Microsoft sign-in.' };
  const data = identity.identity_data || {};
  const tenantId = tenantOf(data);
  if (!tenantId || tenantId !== cfg.tenantId) {
    return { ok: false, status: 403, error: 'This Microsoft account is not in the organization this TMS is set up for.' };
  }
  const claims = data.custom_claims || {};
  const appRoles = (Array.isArray(claims.roles) ? claims.roles : []).map(String);
  const mapped = new Set(appRoles.map((r) => cfg.roleMap.get(r)).filter(Boolean));
  const roles = ROLE_ORDER.filter((r) => mapped.has(r));
  if (!roles.length) {
    return { ok: false, status: 403, error: 'Your Microsoft account has no role in this TMS. Ask IT to add you to the AP Reviewers or AP Approvers group.' };
  }
  const email = String(data.email || claims.email || claims.preferred_username || (user && user.email) || '').toLowerCase();
  const name = String(data.full_name || data.name || claims.name || email.split('@')[0] || '');
  return { ok: true, roles, activeRole: roles[0], appRoles, email, name, tenantId };
}

/** Give the user the decided roles and the configured domain. */
async function grantAccess({ user, decision, cfg, db }) {
  await db.dbUpsert('user_profiles', {
    id: user.id,
    email: decision.email || user.email || '',
    full_name: decision.name || null,
    roles: decision.roles,
    active_role: decision.activeRole,
    disabled: false,
  }, 'id');
  if (cfg.domain) {
    await db.dbUpsert('user_domain_access', {
      user_id: user.id, domain_code: cfg.domain, is_default: true, created_by: 'microsoft-sso',
    }, 'user_id,domain_code');
  }
}

/** A Microsoft user with no role in the right tenant keeps no access. */
async function denyAccess({ user, db }) {
  if (!user || !user.id) return;
  await db.dbUpsert('user_profiles', {
    id: user.id, email: user.email || '', roles: ['viewer'], active_role: 'viewer', disabled: true,
  }, 'id');
}

module.exports = { config, decide, grantAccess, denyAccess, _internals: { parseRoleMap, tenantOf, azureIdentity, DEFAULT_ROLE_MAP } };
