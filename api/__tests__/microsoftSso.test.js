'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sso = require('../services/auth/microsoftSso');

const TENANT = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const env = { MS_SSO_ENABLED: 'true', MS_SSO_TENANT_ID: TENANT, MS_SSO_DOMAIN: 'kestrel_bay' };

function msUser({ tenant = TENANT, roles = ['AP.Approver'], email = 'ap.clerk@kestrelbay.zoree.io', meta = {} } = {}) {
  return {
    id: 'u-1', email,
    user_metadata: meta,
    identities: [{
      provider: 'azure',
      identity_data: {
        iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
        email, full_name: 'Ap Clerk',
        custom_claims: { roles, email },
      },
    }],
  };
}

test('config: off unless enabled with a tenant GUID', () => {
  assert.equal(sso.config({}).enabled, false);
  assert.equal(sso.config({ MS_SSO_ENABLED: 'true' }).enabled, false);
  assert.equal(sso.config({ MS_SSO_ENABLED: 'true', MS_SSO_TENANT_ID: 'not-a-guid' }).enabled, false);
  const c = sso.config(env);
  assert.equal(c.enabled, true);
  assert.equal(c.domain, 'KESTREL_BAY');
  assert.equal(c.label, 'Sign in with Microsoft');
});

test('role map: default pairs, unknown TMS roles dropped', () => {
  const m = sso._internals.parseRoleMap('AP.Approver:finance, X:superuser, AP.Reviewer:Viewer');
  assert.deepEqual([...m], [['AP.Approver', 'finance'], ['AP.Reviewer', 'viewer']]);
});

test('approver in the right tenant gets finance', () => {
  const d = sso.decide(msUser(), sso.config(env));
  assert.equal(d.ok, true);
  assert.deepEqual(d.roles, ['finance']);
  assert.equal(d.activeRole, 'finance');
  assert.equal(d.email, 'ap.clerk@kestrelbay.zoree.io');
  assert.equal(d.name, 'Ap Clerk');
});

test('both roles: highest becomes active', () => {
  const d = sso.decide(msUser({ roles: ['AP.Reviewer', 'AP.Approver'] }), sso.config(env));
  assert.deepEqual(d.roles, ['finance', 'viewer']);
  assert.equal(d.activeRole, 'finance');
});

test('other tenant is refused', () => {
  const d = sso.decide(msUser({ tenant: OTHER }), sso.config(env));
  assert.equal(d.ok, false);
  assert.equal(d.status, 403);
});

test('no app role is refused', () => {
  const d = sso.decide(msUser({ roles: [] }), sso.config(env));
  assert.equal(d.ok, false);
  assert.match(d.error, /no role/);
});

test('roles a user wrote into user_metadata are ignored', () => {
  const u = msUser({ roles: [], meta: { custom_claims: { roles: ['TMS.Admin'] }, role: 'admin' } });
  assert.equal(sso.decide(u, sso.config(env)).ok, false);
});

test('password (non-Microsoft) session is refused', () => {
  const d = sso.decide({ id: 'u', email: 'x@y.z', identities: [{ provider: 'email', identity_data: {} }] }, sso.config(env));
  assert.equal(d.status, 400);
});

test('disabled config is refused', () => {
  assert.equal(sso.decide(msUser(), sso.config({})).status, 404);
});

test('tid claim used when the issuer is missing', () => {
  const u = msUser();
  delete u.identities[0].identity_data.iss;
  u.identities[0].identity_data.custom_claims.tid = TENANT.toUpperCase();
  assert.equal(sso.decide(u, sso.config(env)).ok, true);
});

test('grantAccess writes roles and default domain; denyAccess disables', async () => {
  const writes = [];
  const db = { dbUpsert: async (t, row, c) => { writes.push([t, row, c]); return row; } };
  const cfg = sso.config(env);
  const u = msUser();
  await sso.grantAccess({ user: u, decision: sso.decide(u, cfg), cfg, db });
  assert.equal(writes[0][0], 'user_profiles');
  assert.deepEqual(writes[0][1].roles, ['finance']);
  assert.equal(writes[0][1].disabled, false);
  assert.deepEqual(writes[1], ['user_domain_access', { user_id: 'u-1', domain_code: 'KESTREL_BAY', is_default: true, created_by: 'microsoft-sso' }, 'user_id,domain_code']);
  writes.length = 0;
  await sso.denyAccess({ user: u, db });
  assert.equal(writes[0][1].disabled, true);
});
