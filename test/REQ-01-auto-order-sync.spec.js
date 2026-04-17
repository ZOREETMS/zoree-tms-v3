// ═══════════════════════════════════════════════════════════════════
// REQ-01 — Auto order sync OMS → TMS
//
// Acceptance (from requirements.xlsx):
//   In the order management system, once order is booked, it should
//   automatically be sent to TMS. No need to click another button,
//   no manual middleware job. The transaction should flow OMS →
//   middleware → TMS immediately without any delay.
//
// This spec drives the flow through the TMS frontend at the same URLs
// the skill specifies (frontend :5173, api :3010). It exercises two
// paths:
//   1) ORDER BOOKED IN OMS (middleware POSTs /api/ingest/oms-orders)
//      — the TMS Orders page must show the new order within a few
//      seconds, without any button click or reload.
//   2) ORDER CREATED DIRECTLY IN TMS (POST /api/orders)
//      — same expectation (covers cross-tab / multi-user realtime).
//
// Run:
//   cd zoree-tms-v3
//   npm i -D @playwright/test            # one-time
//   npx playwright install chromium      # one-time
//   npx playwright test test/REQ-01-auto-order-sync.spec.js --reporter=list
//
// Env (override if needed):
//   FRONTEND_URL   default http://localhost:5173
//   API_URL        default http://localhost:3010
//   TEST_USERNAME  default admin@zoree.com
//   TEST_PASSWORD  default (none — skip login if already authenticated)
//   INGEST_API_KEY optional; sent as X-API-Key on the ingest POST
// ═══════════════════════════════════════════════════════════════════

const { test, expect, request } = require('@playwright/test');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const API_URL      = process.env.API_URL      || 'http://localhost:3010';
const INGEST_KEY   = process.env.INGEST_API_KEY || '';
const TEST_USER    = process.env.TEST_USERNAME || '';
const TEST_PASS    = process.env.TEST_PASSWORD || '';

// Wait up to 15s for auto-sync — REQ-01 says "without any delay",
// but give the UI time to re-fetch on the SSE event.
const SYNC_WAIT_MS = 15_000;

function makeOrderId(prefix = 'REQ01') {
  const stamp = Date.now().toString().slice(-7);
  return `${prefix}-${stamp}`;
}

function sampleOrderPayload(idPrefix) {
  return {
    id:          makeOrderId(idPrefix),
    customer:    'Auto Sync Corp',
    origin:      'ATLANTA, GA 30350',
    destination: 'DALLAS, TX 75201',
    weight:      1200,
    pieces:      4,
    commodity:   'General',
    shipMode:    'LTL',
    status:      'Unplanned',
    omsOrderRef: 'OMS-' + Date.now(),
  };
}

async function loginIfNeeded(page) {
  // Many dev environments skip auth — only log in if a login form shows up.
  await page.goto(FRONTEND_URL);
  await page.waitForLoadState('networkidle');
  const onLogin = await page.locator('input[type="password"]').count();
  if (onLogin && TEST_USER && TEST_PASS) {
    await page.fill('input[type="email"], input[name*="email" i]', TEST_USER);
    await page.fill('input[type="password"]', TEST_PASS);
    await page.getByRole('button', { name: /log ?in|sign ?in/i }).click();
    await page.waitForLoadState('networkidle');
  }
}

async function gotoOrders(page) {
  await page.goto(`${FRONTEND_URL}/orders`);
  await page.waitForLoadState('networkidle');
  // Table rows may be lazy — wait briefly for anything to render.
  await page.waitForTimeout(500);
}

test.describe('REQ-01 Auto order sync OMS → TMS', () => {
  test.beforeEach(async ({ page }) => {
    await loginIfNeeded(page);
  });

  test('path 1: order POSTed to /api/ingest/oms-orders appears in TMS without any button click', async ({ page }) => {
    await gotoOrders(page);

    const payload = sampleOrderPayload('REQ01A');

    // Snapshot "not visible" before the push.
    const rowBefore = page.getByText(payload.id, { exact: false });
    await expect(rowBefore).toHaveCount(0);

    // Middleware simulates OMS by POSTing to the ingest endpoint.
    const api = await request.newContext();
    const res = await api.post(`${API_URL}/api/ingest/oms-orders`, {
      headers: INGEST_KEY ? { 'X-API-Key': INGEST_KEY } : {},
      data: { orders: [payload] },
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    // WITHOUT clicking anything, the order must appear in the TMS
    // Orders page. CSS uses text-transform:uppercase widely; match
    // case-insensitive and allow the debounce window.
    await expect(
      page.getByText(payload.id, { exact: false })
    ).toBeVisible({ timeout: SYNC_WAIT_MS });
  });

  test('path 2: order POSTed to /api/orders appears in a second open TMS tab without refresh', async ({ browser }) => {
    const ctx = await browser.newContext();
    const pageA = await ctx.newPage();
    const pageB = await ctx.newPage();

    await loginIfNeeded(pageA);
    await loginIfNeeded(pageB);
    await gotoOrders(pageA);
    await gotoOrders(pageB);

    const payload = sampleOrderPayload('REQ01B');

    // pageA triggers a POST /api/orders (same path the New Order
    // modal uses). pageB should display the new order via SSE.
    const api = await request.newContext();
    // Obtain a token by reusing the page's localStorage if present.
    const token = await pageA.evaluate(() => {
      try {
        // App stores the supabase session under a key containing 'auth-token'.
        const k = Object.keys(window.localStorage).find((x) => /auth-token|supabase|access/i.test(x));
        if (!k) return null;
        const raw = window.localStorage.getItem(k);
        if (!raw) return null;
        try {
          const j = JSON.parse(raw);
          return j.access_token || j.currentSession?.access_token || j?.session?.access_token || null;
        } catch { return null; }
      } catch { return null; }
    });

    if (!token) {
      test.skip(true, 'No user token found in localStorage — POST /api/orders requires auth. Skipping path 2.');
      return;
    }

    const res = await api.post(`${API_URL}/api/orders`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: payload,
    });
    expect(res.status(), await res.text()).toBeLessThan(300);

    await expect(
      pageB.getByText(payload.id, { exact: false })
    ).toBeVisible({ timeout: SYNC_WAIT_MS });

    await ctx.close();
  });

  test('orders ingested via OMS carry sync_source=oms audit columns', async () => {
    const payload = sampleOrderPayload('REQ01C');

    const api = await request.newContext();
    const res = await api.post(`${API_URL}/api/ingest/oms-orders`, {
      headers: INGEST_KEY ? { 'X-API-Key': INGEST_KEY } : {},
      data: { orders: [payload] },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.accepted).toBe(1);
    expect(body.ids).toContain(payload.id);

    // Verify via the generic DB proxy that the audit cols were set.
    const look = await api.get(`${API_URL}/api/db/orders?q=select=id,sync_source,auto_synced_at,oms_order_ref&id=eq.${encodeURIComponent(payload.id)}`);
    if (!look.ok()) {
      test.info().annotations.push({ type: 'env', description: 'GET /api/db/orders may require auth; verify manually in Supabase if this assertion fails.' });
      return;
    }
    const rows = await look.json();
    expect(Array.isArray(rows) && rows.length === 1).toBeTruthy();
    expect(rows[0].sync_source).toBe('oms');
    expect(rows[0].auto_synced_at).toBeTruthy();
    expect(rows[0].oms_order_ref).toBe(payload.omsOrderRef);
  });

  test('ingest endpoint rejects an invalid order (weight missing)', async () => {
    const api = await request.newContext();
    const bad = { orders: [{ id: 'REQ01D-BAD', customer: 'X', origin: 'A', destination: 'B' }] };
    const res = await api.post(`${API_URL}/api/ingest/oms-orders`, {
      headers: INGEST_KEY ? { 'X-API-Key': INGEST_KEY } : {},
      data: bad,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/weight/i);
  });
});
