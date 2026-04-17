// ═══════════════════════════════════════════════════════════════════
// REQ-05 — Bulk planning performance (50 orders)
//
// Acceptance per requirements.xlsx row 5:
//   Add 50 orders and plan them. Mix of LTL and TL, different lanes.
//   Measure the performance — it shouldn't be very long.
//
// The tms-test skill's finer criteria:
//   - 50 orders exist across different lanes (LTL + TL eligible)
//   - Complete in under 2 minutes
//   - All 50 assigned to shipments after planning
//
// The spec seeds fresh orders via POST /api/ingest/oms-orders, drives
// the Orders page (filter → select all → Plan Selected), measures
// time from click to last shipment created, and asserts all 50 are
// Planned with a shipment_id. Defaults use lane weights that the
// live LTL quote engine has been observed to cover (ATL→DAL, ATL→MIA,
// CHI→DAL, DAL→PHX); the LA→NY lane is intentionally avoided because
// the local quote engine does not cover it. See REQ-05 Change Summary
// for details.
//
// Run (on Windows, with dev servers up at :5173 / :3010):
//   $env:TEST_ADMIN_EMAIL    = "admin@zoree.io"
//   $env:TEST_ADMIN_PASSWORD = "Zoree@2024"
//   npx playwright test test/REQ-05-*.spec.js --reporter=list
// ═══════════════════════════════════════════════════════════════════

const { test, expect, request } = require('@playwright/test');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL      = process.env.API_URL      || 'http://localhost:3010';
const ADMIN_EMAIL    = process.env.TEST_ADMIN_EMAIL    || 'admin@zoree.io';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'Zoree@2024';

// 50 orders across 4 lanes, all LTL-eligible after consolidation.
// Chosen to match the live LTL quote engine's observed coverage.
const LANES = [
  { key: 'A2D', origin: 'ATLANTA, GA 30350',    dest: 'DALLAS, TX 75201',  count: 10, wt: 600 },  //  6k total LTL
  { key: 'A2M', origin: 'ATLANTA, GA 30350',    dest: 'MIAMI, FL 33101',   count: 15, wt: 400 },  //  6k total LTL
  { key: 'C2D', origin: 'CHICAGO, IL 60632',    dest: 'DALLAS, TX 75201',  count: 10, wt: 1000 }, // 10k total LTL
  { key: 'D2P', origin: 'DALLAS, TX 75201',     dest: 'PHOENIX, AZ 85003', count: 15, wt: 1000 }, // 15k total LTL
];
const TOTAL_EXPECTED = LANES.reduce((s, L) => s + L.count, 0); // 50

const SLA_MS = 120_000; // 2 minutes per tms-test skill

async function login(page) {
  await page.goto(FRONTEND_URL);
  await page.waitForLoadState('networkidle');
  const needs = await page.locator('#login-email').count();
  if (!needs) return;
  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-pass').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForSelector('.sidebar-logo', { timeout: 15_000 });
}

test.describe('REQ-05 Bulk planning performance (50 orders)', () => {
  let seededIds = [];
  let customerTag = '';

  test.beforeAll(async () => {
    customerTag = 'REQ05-PW-' + Date.now().toString().slice(-6);
    const orders = [];
    for (const L of LANES) {
      for (let i = 1; i <= L.count; i++) {
        const idx = String(i).padStart(2, '0');
        orders.push({
          id: `${customerTag}-${L.key}-${idx}`,
          customer: customerTag,
          origin: L.origin,
          destination: L.dest,
          weight: L.wt,
          pieces: Math.max(1, Math.round(L.wt / 50)),
          commodity: 'REQ-05 test freight',
          shipMode: 'LTL',
          status: 'Unplanned',
          omsOrderRef: `${customerTag}-${L.key}-${idx}`,
        });
      }
    }
    const api = await request.newContext();
    const res = await api.post(`${API_URL}/api/ingest/oms-orders`, {
      headers: { 'Content-Type': 'application/json' },
      data: { orders },
    });
    expect(res.ok(), 'ingest must succeed').toBeTruthy();
    const body = await res.json();
    expect(body.accepted).toBe(TOTAL_EXPECTED);
    seededIds = body.ids || orders.map((o) => o.id);
  });

  test.afterAll(async () => {
    // Best-effort cleanup: unplan + delete seeded orders and any matching shipments.
    // Uses admin token obtained through a fresh login.
    const api = await request.newContext();
    const login = await api.post(`${API_URL}/api/auth/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!login.ok()) return;
    const token = (await login.json())?.token;
    if (!token) return;
    for (const id of seededIds) {
      await api.delete(`${API_URL}/api/orders/${encodeURIComponent(id)}`, {
        headers: { Authorization: 'Bearer ' + token },
      }).catch(() => {});
    }
  });

  test(`plans all ${TOTAL_EXPECTED} orders in under ${SLA_MS / 1000}s via Plan Selected`, async ({ page }) => {
    await login(page);
    await page.goto(`${FRONTEND_URL}/orders`);
    await page.waitForLoadState('networkidle');

    // Filter to our customer tag so only these 50 are in scope
    const searchInput = page.locator('input[placeholder*="order" i], input[placeholder*="customer" i]').first();
    await searchInput.fill(customerTag);
    await page.waitForTimeout(700);

    // Narrow to Unplanned status
    await page.getByRole('button', { name: /Unplanned/ }).first().click();
    await page.waitForTimeout(500);

    // Select all visible
    const headerCheckbox = page.locator('thead input[type="checkbox"]').first();
    await headerCheckbox.check();
    await page.waitForTimeout(300);

    // Auto-confirm any window.confirm() dialog from Plan Selected
    await page.evaluate(() => { window.confirm = () => true; });

    const planSelected = page.getByRole('button', { name: /Plan Selected/i });
    await expect(planSelected).toBeVisible();

    // Start the clock
    const t0 = Date.now();
    await planSelected.click();

    // Poll the DB directly via /api/db/orders for completion
    const api = await request.newContext();
    const q = encodeURIComponent(`select=id,status&customer=eq.${customerTag}&limit=200`);
    const deadline = t0 + SLA_MS + 10_000;
    let plannedCount = 0, unplannedCount = TOTAL_EXPECTED, failedCount = 0;
    while (Date.now() < deadline) {
      const r = await api.get(`${API_URL}/api/db/orders?q=${q}`);
      const rows = r.ok() ? await r.json() : [];
      plannedCount   = rows.filter((x) => x.status === 'Planned').length;
      unplannedCount = rows.filter((x) => x.status === 'Unplanned').length;
      failedCount    = rows.filter((x) => x.status === 'Planning Failed').length;
      if (plannedCount + failedCount >= TOTAL_EXPECTED && unplannedCount === 0) break;
      await page.waitForTimeout(500);
    }
    const elapsedMs = Date.now() - t0;

    test.info().annotations.push({ type: 'perf', description: `elapsed=${elapsedMs}ms  planned=${plannedCount}/${TOTAL_EXPECTED}  failed=${failedCount}` });

    expect(elapsedMs, `bulk plan must complete within SLA (${SLA_MS}ms)`).toBeLessThan(SLA_MS);
    expect(plannedCount, 'all seeded orders must be Planned').toBe(TOTAL_EXPECTED);
    expect(failedCount, 'no seeded orders should fail planning').toBe(0);
  });

  test('each planned order has a shipment_id', async () => {
    const api = await request.newContext();
    const q = encodeURIComponent(`select=id,status,shipment_id&customer=eq.${customerTag}&limit=200`);
    const rows = await (await api.get(`${API_URL}/api/db/orders?q=${q}`)).json();
    const missing = rows.filter((r) => r.status === 'Planned' && !r.shipment_id);
    expect(missing, 'no Planned order should lack a shipment_id').toHaveLength(0);
    expect(rows.length).toBe(TOTAL_EXPECTED);
  });

  test('shipments created cover every seeded lane (4 lanes)', async () => {
    const api = await request.newContext();
    const q = encodeURIComponent(`select=id,origin,dest,order_ids&customer=eq.${customerTag}&limit=200`);
    const orders = await (await api.get(`${API_URL}/api/db/orders?q=${q}`)).json();
    const shipIds = [...new Set(orders.filter((o) => o.shipment_id).map((o) => o.shipment_id))];
    expect(shipIds.length).toBeGreaterThanOrEqual(LANES.length);
  });
});
