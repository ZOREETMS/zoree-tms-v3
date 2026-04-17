// ═══════════════════════════════════════════════════════════════════
// REQ-04 — User roles (planner / finance / admin)
//
// Acceptance per requirements.xlsx row 4:
//   Need user roles like planner, finance user, admin. Planner can
//   plan the order and edit the rates and shipments. Finance user
//   will have access to finance related menu and admin has all menu.
//   Access should be given according to the role.
//
// The spec covers, for each of the three roles:
//   1. Login succeeds and the sidebar shows ONLY the nav labels the
//      role matrix whitelists.
//   2. Visiting a route the role cannot access redirects to the
//      role's landing page (RoleGuard).
//   3. An API write restricted to another role returns 403.
//
// Credentials — pass via env; each role independently optional.
// If a role's credentials are missing the scenario is SKIPPED so
// CI can run with only admin configured:
//
//   TEST_ADMIN_EMAIL,   TEST_ADMIN_PASSWORD    (default admin@zoree.io / Zoree@2024)
//   TEST_PLANNER_EMAIL, TEST_PLANNER_PASSWORD
//   TEST_FINANCE_EMAIL, TEST_FINANCE_PASSWORD
//
// Run:
//   cd zoree-tms-v3
//   npx playwright install chromium        # one-time
//   npx playwright test test/REQ-04-*.spec.js --reporter=list
// ═══════════════════════════════════════════════════════════════════

const { test, expect, request } = require('@playwright/test');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL      = process.env.API_URL      || 'http://localhost:3010';

const ADMIN_NAV = [
  'Home', 'Dashboard',
  'Item Master', 'Location Master', 'Equipment Master',
  'Shipments', 'Orders', 'Route Optimizer',
  'Bulk Plan', 'Multi-Stop Routes', 'Planning Params',
  'Live Tracking', 'Carriers', 'Carrier Portal',
  'Dock Scheduling', 'Fleet Management', 'Compliance',
  'Freight Invoices', 'Rate Management', 'Lane Preferences',
  'Carrier Bids', 'Freight Audit',
  'Documents & BOL', 'Customer Portal', 'Messaging Hub',
  'Network Modeling', 'Analytics', 'Reports', 'Alerts', 'DB Explorer',
  'User Roles', 'Settings',
];
const PLANNER_NAV = [
  'Home', 'Dashboard',
  'Item Master', 'Location Master', 'Equipment Master',
  'Shipments', 'Orders', 'Route Optimizer',
  'Bulk Plan', 'Multi-Stop Routes', 'Planning Params',
  'Live Tracking', 'Carriers', 'Carrier Portal',
  'Dock Scheduling', 'Fleet Management', 'Compliance',
  'Rate Management', 'Lane Preferences',
  'Documents & BOL', 'Customer Portal',
  'Analytics', 'Reports', 'Messaging Hub',
  'Settings',
];
const FINANCE_NAV = [
  'Home', 'Dashboard',
  'Freight Invoices', 'Rate Management', 'Lane Preferences',
  'Carrier Bids', 'Freight Audit',
  'Documents & BOL',
  'Analytics', 'Reports', 'Alerts',
  'Settings',
];

const ROLES = [
  {
    key: 'admin',
    email:    process.env.TEST_ADMIN_EMAIL    || 'admin@zoree.io',
    password: process.env.TEST_ADMIN_PASSWORD || 'Zoree@2024',
    shouldSee:  ADMIN_NAV,
    mustNotSee: [],
    forbiddenPaths: [],           // admin has no forbidden paths
    restrictedWrite: null,         // admin passes every endpoint
  },
  {
    key: 'planner',
    email:    process.env.TEST_PLANNER_EMAIL,
    password: process.env.TEST_PLANNER_PASSWORD,
    shouldSee:  PLANNER_NAV,
    mustNotSee: ['Freight Invoices', 'Freight Audit', 'Carrier Bids', 'User Roles'],
    forbiddenPaths: ['/freight-invoices', '/freight-audit', '/carrier-bids', '/user-roles'],
    // Planner is forbidden from deleting orders (admin only).
    restrictedWrite: {
      method: 'DELETE',
      url: '/api/orders/NONEXISTENT-ORDER-FOR-PERM-CHECK',
      expectStatus: 403,
    },
  },
  {
    key: 'finance',
    email:    process.env.TEST_FINANCE_EMAIL,
    password: process.env.TEST_FINANCE_PASSWORD,
    shouldSee:  FINANCE_NAV,
    mustNotSee: ['Orders', 'Shipments', 'Bulk Plan', 'Item Master', 'User Roles'],
    forbiddenPaths: ['/orders', '/shipments', '/bulk-plan', '/item-master', '/user-roles'],
    // Finance is forbidden from creating orders.
    restrictedWrite: {
      method: 'POST',
      url: '/api/orders',
      body: { id: 'REQ04-FIN-PERM', customer: 'X', origin: 'A', destination: 'B', weight: 1 },
      expectStatus: 403,
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────
async function login(page, email, password) {
  await page.goto(FRONTEND_URL);
  await page.waitForLoadState('networkidle');
  // If the sidebar is already there we're signed in from a prior test
  const sidebarReady = await page.locator('.sidebar-logo').count().catch(() => 0);
  if (sidebarReady) return;
  const emailInput = page.locator('#login-email');
  await emailInput.waitFor({ state: 'visible', timeout: 10_000 });
  await emailInput.fill(email);
  await page.locator('#login-pass').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('.sidebar-logo', { timeout: 15_000 });
}

async function getAuthToken(page) {
  return page.evaluate(() => window.localStorage.getItem('zoree_token'));
}

async function readSidebarLabels(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.sidebar .nav-item')].map((el) => (el.textContent || '').trim())
  );
}

// ── Run the scenarios ───────────────────────────────────────────
for (const role of ROLES) {
  test.describe(`REQ-04 · role=${role.key}`, () => {
    test.beforeAll(() => {
      if (!role.email || !role.password) {
        test.skip(true, `No credentials for role '${role.key}'. Set TEST_${role.key.toUpperCase()}_EMAIL / _PASSWORD to enable.`);
      }
    });

    test(`login + sidebar shows expected nav, hides forbidden nav`, async ({ page }) => {
      await login(page, role.email, role.password);
      const labels = await readSidebarLabels(page);

      for (const expected of role.shouldSee) {
        const hit = labels.some((l) => l === expected || l.endsWith(' ' + expected) || l.includes(expected));
        expect.soft(hit, `expected sidebar label '${expected}' to be visible for ${role.key}`).toBeTruthy();
      }
      for (const forbidden of role.mustNotSee) {
        const hit = labels.some((l) => l === forbidden || l.endsWith(' ' + forbidden));
        expect.soft(hit, `nav label '${forbidden}' must NOT be visible for ${role.key}`).toBeFalsy();
      }
    });

    for (const p of role.forbiddenPaths) {
      test(`RoleGuard redirects away from ${p}`, async ({ page }) => {
        await login(page, role.email, role.password);
        await page.goto(`${FRONTEND_URL}${p}`);
        await page.waitForLoadState('networkidle');
        // The guard uses <Navigate replace>, so after it fires pathname won't equal p.
        await page.waitForFunction(
          (pp) => window.location.pathname !== pp,
          p,
          { timeout: 6000 }
        ).catch(() => {});
        const finalPath = new URL(page.url()).pathname;
        expect.soft(finalPath, `${role.key} should not be allowed to land on ${p}`).not.toBe(p);
      });
    }

    if (role.restrictedWrite) {
      test(`API write '${role.restrictedWrite.method} ${role.restrictedWrite.url}' is forbidden`, async ({ page }) => {
        await login(page, role.email, role.password);
        const token = await getAuthToken(page);
        expect(token, 'token must be present in localStorage after login').toBeTruthy();
        const api = await request.newContext();
        const res = await api.fetch(`${API_URL}${role.restrictedWrite.url}`, {
          method: role.restrictedWrite.method,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          data: role.restrictedWrite.body || undefined,
        });
        expect(res.status()).toBe(role.restrictedWrite.expectStatus);
      });
    }

    if (role.key === 'admin') {
      test('admin can reach every forbidden path of other roles', async ({ page }) => {
        await login(page, role.email, role.password);
        for (const p of ['/freight-invoices', '/orders', '/shipments', '/user-roles']) {
          await page.goto(`${FRONTEND_URL}${p}`);
          await page.waitForLoadState('networkidle');
          const finalPath = new URL(page.url()).pathname;
          expect.soft(finalPath, `admin should reach ${p}`).toBe(p);
        }
      });
    }
  });
}
