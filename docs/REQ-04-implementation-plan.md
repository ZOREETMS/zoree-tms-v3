# REQ-04 — User Roles (Planner / Finance / Admin)

**Requirement:** Three roles exist: **planner** (plan orders, edit rates, edit
shipments), **finance** (finance menus only), **admin** (everything). Access
gated per role. Add more rules / different access as needed.

**Acceptance:** Login as each role → menus hidden/shown correctly → unauthorized
API calls rejected with 403.

---

## 1. Change Summary

### Files to modify

| Path | Change | Why |
|---|---|---|
| `api/services/rolePermissions.js` | Edit | Expand `ROLE_FEATURES` + `TABLE_ACTION_TO_FEATURE` to full matrix |
| `api/middleware/` | Edit | Add `requireFeature(featureKey)` middleware helper |
| `api/routes/*.js` | Edit | Every mutating route wraps in `requireFeature(...)` |
| `api/server.js` | Edit | Mount auth + role middleware globally |
| `frontend/src/state/` | Edit | Auth store exposes `hasFeature(key)` memoized lookup |
| `frontend/src/App.jsx` | Edit | Nav items conditionally render on `hasFeature(...)` |
| `frontend/src/pages/UserRolesPage.jsx` | Edit | Admin-only; manages users + roles + grants |

### Files to create

| Path | Purpose |
|---|---|
| `api/middleware/authorize.js` | `requireFeature`, `requireRole` helpers |
| `api/migrations/006_role_feature_grants.sql` | Tables + seed grants + seed users |
| `frontend/src/hooks/useFeature.js` | `useFeature('orders.plan') -> bool` |
| `frontend/src/components/RequireFeature.jsx` | Conditionally render children |
| `test/REQ-04-user-roles.spec.js` | 4 scenarios: planner, finance, admin, unauthorized |

### DB changes

Migration 006 — tables:

- `access_features(feature_key PK, label, description, module)` — already partially present, ensure full seed
- `role_feature_grants(role_key, feature_key, granted, PRIMARY KEY(role_key, feature_key))`
- `user_roles(user_id, tenant_id, role_key)` — may be absent; create if so
- Seed rows: three roles × default grant matrix
- Seed users: `planner01@zoree.local`, `finance01@zoree.local` (admin assumed already seeded); insert into `auth.users` via Supabase Admin API — NOT via raw SQL to `auth.users` (production-unsafe). Instead emit `supabase.auth.admin.createUser(...)` call examples in the plan for your dev to run.

### API changes

- Middleware applied: `authenticate -> loadRole -> requireFeature(<key>) -> handler`
- 401 for missing/invalid token, 403 for missing feature grant
- New route: `GET /auth/me` returns `{ user, role, features: string[] }` so frontend can render the nav correctly

### Frontend changes

- `App.jsx` sidebar renders items from `nav-config.js` where each nav entry declares `feature: 'orders.plan' | 'invoices.approve' | 'roles.manage' | ...`
- `useFeature('orders.plan')` returns boolean from the auth store
- Planner sees: Dashboard, Orders, Shipments, Bulk Plan, Rate Mgmt, Analytics, History
- Finance sees: Dashboard, Freight Invoices, Freight Audit, Carrier Bids, Analytics, History
- Admin sees everything + Settings + User Roles page

### Risks

1. **Frontend hiding vs server enforcement must match.** A hidden menu item must still be protected server-side — never trust the UI. Tests enforce this: "finance user calls `POST /orders/:id/plan` directly → 403".
2. **Seeding users via SQL against `auth.users` breaks Supabase.** Seed using `supabase.auth.admin.createUser` (or Dashboard UI). Script is non-SQL.
3. **Role changes require re-login** in the current session model (role loaded at token issue time). Document this in UserRolesPage.

---

## 2. Role × feature matrix (seeded in migration 006)

| feature_key | label | planner | finance | admin |
|---|---|---|---|---|
| `orders.view` | View orders | YES | YES | YES |
| `orders.plan` | Plan / assign / unassign | YES | no | YES |
| `orders.edit` | Edit order fields | YES | no | YES |
| `orders.create` | Create new order | YES | no | YES |
| `shipments.view` | View shipments | YES | YES | YES |
| `shipments.edit` | Edit shipment | YES | no | YES |
| `shipments.tender` | Tender shipment to carrier | YES | no | YES |
| `rates.view` | View rates | YES | YES | YES |
| `rates.edit` | Edit rates | YES | no | YES |
| `invoices.view` | View carrier invoices | no | YES | YES |
| `invoices.approve` | Approve invoice (send to AP) | no | YES | YES |
| `invoices.reject` | Reject invoice | no | YES | YES |
| `tolerance.edit` | Edit per-carrier tolerance | no | YES | YES |
| `ap.send` | Send approved invoices to AP | no | YES | YES |
| `audit.view` | View change history | YES | YES | YES |
| `roles.manage` | Manage roles + grants | no | no | YES |
| `settings.manage` | Change global settings | no | no | YES |
| `users.manage` | Create/edit users | no | no | YES |

## 3. Middleware

```js
// api/middleware/authorize.js
const { createRolePermissionService } = require('../services/rolePermissions');

function requireFeature(featureKey) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    const role = req.user.role || 'anon';
    if (role === 'admin') return next();
    const granted = await req.rolePerms.hasGrant(role, featureKey, req.tenantId);
    if (!granted) return res.status(403).json({ error: `missing feature: ${featureKey}` });
    next();
  };
}

function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'role not allowed' });
    }
    next();
  };
}

module.exports = { requireFeature, requireRole };
```

## 4. Migration 006 — SQL body

```sql
-- 006_role_feature_grants.sql
-- Description: REQ-04 role/feature matrix. Creates access_features,
--              role_feature_grants, user_roles; seeds planner/finance/admin
--              with the matrix in docs/REQ-04-implementation-plan.md §2.
-- Affected:    api/middleware/authorize.js, api/routes/*, frontend nav.
-- Backfill:    Assigns all existing users to 'admin' role — conservative default.
-- Rollback:    DROP the three tables (at bottom).
-- Risks:       Backfill treats everyone as admin; tighten after seeding real users.

BEGIN;

CREATE TABLE IF NOT EXISTS access_features (
  feature_key   text PRIMARY KEY,
  label         text NOT NULL,
  description   text,
  module        text,
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_feature_grants (
  role_key      text NOT NULL,
  feature_key   text NOT NULL REFERENCES access_features(feature_key) ON DELETE CASCADE,
  granted       boolean NOT NULL DEFAULT false,
  tenant_id     text NOT NULL DEFAULT 'zoree-default',
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (role_key, feature_key, tenant_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id       text NOT NULL,
  tenant_id     text NOT NULL DEFAULT 'zoree-default',
  role_key      text NOT NULL,
  assigned_by   text,
  assigned_at   timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, tenant_id)
);

-- Seed features ---------------------------------------------------
INSERT INTO access_features (feature_key, label, module) VALUES
  ('orders.view',      'View orders',               'orders'),
  ('orders.plan',      'Plan / assign / unassign',  'orders'),
  ('orders.edit',      'Edit order fields',         'orders'),
  ('orders.create',    'Create new order',          'orders'),
  ('shipments.view',   'View shipments',            'shipments'),
  ('shipments.edit',   'Edit shipment',             'shipments'),
  ('shipments.tender', 'Tender to carrier',         'shipments'),
  ('rates.view',       'View rates',                'rates'),
  ('rates.edit',       'Edit rates',                'rates'),
  ('invoices.view',    'View invoices',             'invoices'),
  ('invoices.approve', 'Approve invoice',           'invoices'),
  ('invoices.reject',  'Reject invoice',            'invoices'),
  ('tolerance.edit',   'Edit per-carrier tolerance','invoices'),
  ('ap.send',          'Send to AP',                'invoices'),
  ('audit.view',       'View change history',       'audit'),
  ('roles.manage',     'Manage roles + grants',     'admin'),
  ('settings.manage',  'Change global settings',    'admin'),
  ('users.manage',     'Create/edit users',         'admin')
ON CONFLICT (feature_key) DO NOTHING;

-- Seed grants (planner) ------------------------------------------
INSERT INTO role_feature_grants (role_key, feature_key, granted) VALUES
  ('planner','orders.view',true),  ('planner','orders.plan',true),
  ('planner','orders.edit',true),  ('planner','orders.create',true),
  ('planner','shipments.view',true),('planner','shipments.edit',true),
  ('planner','shipments.tender',true),
  ('planner','rates.view',true),    ('planner','rates.edit',true),
  ('planner','audit.view',true)
ON CONFLICT (role_key, feature_key, tenant_id) DO UPDATE SET granted = EXCLUDED.granted;

-- Seed grants (finance) ------------------------------------------
INSERT INTO role_feature_grants (role_key, feature_key, granted) VALUES
  ('finance','orders.view',true),   ('finance','shipments.view',true),
  ('finance','rates.view',true),
  ('finance','invoices.view',true), ('finance','invoices.approve',true),
  ('finance','invoices.reject',true),('finance','tolerance.edit',true),
  ('finance','ap.send',true),
  ('finance','audit.view',true)
ON CONFLICT (role_key, feature_key, tenant_id) DO UPDATE SET granted = EXCLUDED.granted;

-- Seed grants (admin) --------------------------------------------
-- Admin gets everything; the middleware short-circuits, but populate anyway
INSERT INTO role_feature_grants (role_key, feature_key, granted)
SELECT 'admin', feature_key, true FROM access_features
ON CONFLICT (role_key, feature_key, tenant_id) DO UPDATE SET granted = true;

-- Conservative user backfill: existing users → admin
-- (Override manually in UserRolesPage after the feature lands)
INSERT INTO user_roles (user_id, role_key)
SELECT id::text, 'admin' FROM auth.users
ON CONFLICT (user_id, tenant_id) DO NOTHING;

COMMIT;

-- ROLLBACK ----------------------------------------------------------
-- BEGIN;
-- DROP TABLE IF EXISTS user_roles;
-- DROP TABLE IF EXISTS role_feature_grants;
-- DROP TABLE IF EXISTS access_features;
-- COMMIT;
```

## 5. Seed planner + finance users (non-SQL — run in a Node script or Supabase Studio)

Do NOT write directly into `auth.users`. Use the admin SDK:

```js
// scripts/seed-users.js  (one-time; keep creds in .env, delete file after run)
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
});

const users = [
  { email: 'planner01@zoree.local',  password: process.env.SEED_PLANNER_PASS,  role: 'planner' },
  { email: 'finance01@zoree.local',  password: process.env.SEED_FINANCE_PASS,  role: 'finance' },
];

for (const u of users) {
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email, password: u.password, email_confirm: true,
    user_metadata: { role: u.role }
  });
  if (error) { console.error(u.email, error.message); continue; }
  await sb.from('user_roles').upsert({ user_id: data.user.id, role_key: u.role });
  console.log('seeded', u.email);
}
```

Run this **once** against your local Supabase using the service role key from your env (NOT from a committed file). Rotate the password after first login.

## 6. Playwright spec — `test/REQ-04-user-roles.spec.js`

```js
const { test, expect } = require('@playwright/test');

const TMS = 'http://localhost:5173';

async function loginAs(page, role) {
  await page.goto(TMS + '/login');
  await page.getByLabel(/email/i).fill(process.env[`TMS_${role.toUpperCase()}_EMAIL`]);
  await page.getByLabel(/password/i).fill(process.env[`TMS_${role.toUpperCase()}_PASS`]);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(home|dashboard|orders)/);
}

test.describe('REQ-04: Role-based access', () => {

  test('planner sees plan/rate/shipment menus; finance menus hidden', async ({ page }) => {
    await loginAs(page, 'planner');
    await expect(page.getByRole('link', { name: /orders/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /shipments/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /rate management/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /freight invoices/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /freight audit/i })).toHaveCount(0);
  });

  test('finance sees invoice menus; plan/rate edit hidden', async ({ page }) => {
    await loginAs(page, 'finance');
    await expect(page.getByRole('link', { name: /freight invoices/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /freight audit/i })).toBeVisible();
    // Planning menu may be visible (view-only) — but Plan buttons must be absent
    await page.goto(TMS + '/orders');
    await expect(page.getByRole('button', { name: /^plan$/i })).toHaveCount(0);
  });

  test('admin sees all menus', async ({ page }) => {
    await loginAs(page, 'admin');
    await expect(page.getByRole('link', { name: /user roles/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /settings/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /freight invoices/i })).toBeVisible();
  });

  test('finance calling POST /orders/:id/plan gets 403', async ({ request }) => {
    // Acquire finance token
    const login = await request.post('/api/auth/login', {
      data: { email: process.env.TMS_FINANCE_EMAIL, password: process.env.TMS_FINANCE_PASS },
    });
    const { token } = await login.json();
    const resp = await request.post('/api/orders/ORD-TEST-1/plan', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(resp.status()).toBe(403);
  });
});
```

## 7. Notes for the tester

- `TMS_PLANNER_EMAIL|PASS`, `TMS_FINANCE_EMAIL|PASS`, `TMS_ADMIN_EMAIL|PASS` must be in `.env` before these tests run.
- When role changes, user must re-login (we're not using live session refresh). Tests log in fresh per scenario.
