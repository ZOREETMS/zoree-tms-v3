# REQ-01 — Auto Order Sync (OMS → Middleware → TMS)

**Requirement:** Once an order is booked in OMS, it is automatically sent to TMS.
No manual button, no manual job, no operator-triggered sync.

**Acceptance:** Book an order on the OMS page → switch to the TMS Orders page
without clicking anything → order appears within a few seconds.

---

## 1. Change Summary (tms-dev format)

### Files to modify

| Path | Change type | Why |
|---|---|---|
| `frontend/zoree-oms.html` | Edit | Remove manual "Send to TMS" paths and auto-push on booking |
| `frontend/zoree-middleware.html` | Edit | Default Auto-Sync to ON at 5s; retain pause for debug only |
| `frontend/src/pages/OrdersPage.jsx` | Edit | Subscribe to realtime inserts on `orders` so TMS reflects new rows without reload |
| `frontend/src/services/ordersService.js` | Edit (small) | Expose `subscribeOrderChanges(cb)` using supabase realtime; keep list fetch unchanged |

### Files to create

| Path | Purpose |
|---|---|
| `test/REQ-01-auto-order-sync.spec.js` | Playwright end-to-end spec |

### DB changes

None required. Optional (recommended, not blocking): add `auto_synced_at timestamptz` to `orders` so perf/auditing can verify sync latency. Would be migration 005, but hold this until REQ-02 lands — pair with audit_log.

### API changes

None. Existing `POST /orders` already persists. The fix is entirely frontend + middleware-timer defaults.

### Risks

1. **Removing manual "Send to TMS" button** could break operators who currently use it to retry a failed push. Mitigation: hide (not delete) the button behind an admin-only `?debug=1` URL flag so support can still invoke it.
2. **Middleware auto-sync always on** creates continuous DB load (`mw_requests` polled every 5s). At tenant scale this is trivial; still, log once per cycle at `info`, not once per event, to avoid log spam.
3. **Supabase realtime** on the `orders` table may not be enabled in your project. If realtime fires but yields nothing, the React page falls back to a 5s poll. Spec both paths.

---

## 2. File-by-file diffs

### 2.1 `frontend/zoree-oms.html`

**(a) Hide the two "manual sync to TMS" buttons (lines 391 and 431)**

Change from:
```html
<button class="btn btn-secondary btn-sm" onclick="doSync()">↻ Sync TMS</button>
...
<button class="btn btn-secondary btn-sm" onclick="syncItems()">↻ Sync TMS Items</button>
```

To (keep DOM, gate visibility to admin debug mode):
```html
<button class="btn btn-secondary btn-sm" onclick="doSync()"
        style="display:none" data-debug-only="1">↻ Sync TMS</button>
...
<button class="btn btn-secondary btn-sm" onclick="syncItems()"
        style="display:none" data-debug-only="1">↻ Sync TMS Items</button>
```

Plus at the bottom of the existing `boot()` path (wherever initial render is called), add:
```js
// Debug mode reveals manual sync buttons for support/QA only
if (new URLSearchParams(location.search).get('debug') === '1') {
  document.querySelectorAll('[data-debug-only="1"]').forEach(el => el.style.display = '');
}
```

**(b) Rewire the "Send to Middleware → TMS" button (line 748) to be automatic**

The current modal has:
```html
<button class="btn btn-primary" id="tms-go" onclick="doTMS()">
  📤 Send to Middleware → TMS
</button>
```

`doTMS()` at line 2146 calls `saveOrder(o)` then `ZoreeMiddleware.pushOrderToTMS(...)`.

Replace the button with a passive status label:
```html
<span id="tms-go" style="color:var(--green);font-weight:600">
  ✓ Auto-sent to TMS (no action needed)
</span>
```

Then at the point in the stage flow where the order becomes ready for TMS (the stage 3→4 transition — today it's gated by the user opening this modal and clicking the button), call `doTMS()` directly from the stage-advance code. Search `zoree-oms.html` for the stage transition that currently shows the TMS modal (`op('m-tms')` or equivalent) — replace that modal-open with a direct `doTMS(o)` invocation.

Minimal code insert (place near line 2146, right before the existing `doTMS` definition):
```js
// Auto-trigger TMS push whenever an order reaches Stage 3 (Ready-to-Ship)
// Replaces the old flow where user had to click "Send to Middleware → TMS".
async function autoPushToTMSIfReady(o) {
  if (!o) return;
  if (o.stage !== 3) return;          // gate: only stage 3 auto-pushes
  if (o.tmsId) return;                // idempotent: already pushed
  try { await doTMS(o); }
  catch (e) { console.warn('[auto-tms] push failed — MW retries on next cycle:', e.message); }
}
```

Call it from every place that advances an order into stage 3. Those call sites are already running `await saveOrder(o)`; add `autoPushToTMSIfReady(o);` immediately after each such `saveOrder` that sets `o.stage = 3` (or greater).

**(c) Also hide the "↻ Await TMS" button at stage 4** (line 1778):

Change from:
```js
case 4: return `<button class="btn btn-secondary btn-sm" onclick="doSync()">↻ Await TMS</button>`;
```

To a passive status pill:
```js
case 4: return `<span class="stage-pill" style="background:var(--yellow-dim);color:var(--yellow);
  padding:4px 10px;border-radius:6px;font-weight:600;font-size:11px">
  ⏳ Awaiting TMS (auto)</span>`;
```

### 2.2 `frontend/zoree-middleware.html`

**Default Auto-Sync to ON in boot().** At line 2136 (end of `boot()`), insert:

```js
// REQ-01: auto-sync is the default posture; no operator action required.
// The button/interval controls remain for pause/debug, but start ON.
try {
  // Set interval default to 5s for near-realtime pickup
  var sel = document.getElementById('auto-sync-interval');
  if (sel) sel.value = '5';
  if (!_autoSyncOn) startAutoSync();
} catch (e) {
  logEvent('warn', 'AUTO-SYNC', 'Could not auto-start on boot: ' + e.message);
}
```

Also update the initial HTML at line 327 so the default label matches (purely cosmetic — `startAutoSync()` rewrites it on call):
```html
<button id="auto-sync-btn" class="btn btn-secondary btn-sm"
        onclick="toggleAutoSync()" style="min-width:110px">
  ⏹ Auto-Sync: ON
</button>
```

Optionally change the interval `<select>` at line 319 to default-select 5s.

**Guardrail — don't let ops silently disable it.** Add to `stopAutoSync()` (around line 2226) a confirmation prompt:
```js
function stopAutoSync() {
  // Only stop if operator truly intends it — REQ-01 says sync must be continuous
  if (_autoSyncOn && !confirm('Auto-sync is required for REQ-01 compliance. Stop anyway?')) {
    return;
  }
  // ... rest unchanged
}
```

### 2.3 `frontend/src/services/ordersService.js`

Append a realtime subscription helper (end of file):

```js
// ── Realtime: subscribe to inserts/updates on orders ──
// Callers receive fresh rows and re-render; falls back to poll if realtime unavailable
import { getSupabase } from "../lib/supabase";  // adjust path if your lib differs

export function subscribeOrderChanges(onChange, { pollMs = 5000 } = {}) {
  const supabase = getSupabase?.();
  if (supabase && typeof supabase.channel === 'function') {
    const ch = supabase
      .channel('orders-req01')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        try { onChange(payload); } catch (e) { console.error('[subscribeOrderChanges]', e); }
      })
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch(_) {} };
  }
  // Fallback: 5s poll
  const t = setInterval(() => onChange({ eventType: 'POLL' }), pollMs);
  return () => clearInterval(t);
}
```

If `getSupabase` is not the correct import in your codebase (your project uses `frontend/src/lib/` — likely `lib/supabaseClient.js` or similar), swap the import path for the existing client accessor.

### 2.4 `frontend/src/pages/OrdersPage.jsx`

Add the subscription inside an existing `useEffect` block (near line 70 where the others live). Assuming `refreshData()` is the existing reloader and `orders` comes from a hook:

```jsx
import { subscribeOrderChanges } from "../services/ordersService";

// ...

useEffect(() => {
  const unsubscribe = subscribeOrderChanges(() => {
    refreshData();  // existing reloader
  });
  return unsubscribe;
}, []);  // mount once
```

This is the REQ-01 spec: TMS Orders page auto-reflects new rows with no user action.

---

## 3. Playwright test — `test/REQ-01-auto-order-sync.spec.js`

Two browser contexts: one for OMS, one for TMS. Book on OMS, assert on TMS
without touching TMS UI beyond navigating.

```js
const { test, expect } = require('@playwright/test');

const OMS_URL = 'http://localhost:5173/zoree-oms.html';   // served by frontend dev server
const TMS_URL = 'http://localhost:5173';                  // React app root
const API_URL = 'http://localhost:3010';

test.describe('REQ-01: Auto order sync OMS -> TMS', () => {

  test('order booked on OMS appears in TMS without any TMS button click', async ({ browser }) => {
    // Two contexts simulate two operators / tabs
    const omsCtx = await browser.newContext();
    const tmsCtx = await browser.newContext();
    const omsPage = await omsCtx.newPage();
    const tmsPage = await tmsCtx.newPage();

    // 1. Open TMS first so we can confirm the order is NOT there yet
    await tmsPage.goto(TMS_URL + '/orders');
    await tmsPage.waitForLoadState('networkidle');
    const pollApi = async () => {
      const r = await tmsPage.request.get(API_URL + '/orders?limit=50');
      return (await r.json()) || [];
    };
    const before = await pollApi();
    const beforeIds = new Set(before.map(o => o.id));

    // 2. Open OMS, book an order (customer-driven; no backend assumptions about stage)
    await omsPage.goto(OMS_URL);
    await omsPage.waitForLoadState('networkidle');
    // TODO(Sridhar): fill in login creds for OMS if required. If session auto-restores, skip.
    //    await omsPage.getByLabel(/email/i).fill(process.env.OMS_EMAIL);
    //    await omsPage.getByLabel(/password/i).fill(process.env.OMS_PASS);
    //    await omsPage.getByRole('button', { name: /sign in|access/i }).click();

    // Book a new order — adjust selectors once the actual "New Order" button text is confirmed
    await omsPage.getByRole('button', { name: /new order/i }).click();
    await omsPage.getByLabel(/customer/i).selectOption({ index: 1 });  // first non-placeholder
    await omsPage.getByLabel(/destination|dest/i).fill('Chicago, IL 60601');
    await omsPage.getByLabel(/ready/i).fill(new Date().toISOString().slice(0,10));
    await omsPage.getByLabel(/due/i).fill(new Date(Date.now()+86400000).toISOString().slice(0,10));
    await omsPage.getByRole('button', { name: /save|create|book/i }).click();

    // OMS should now show the order advancing. We deliberately do NOT click any "Send to TMS".
    // Move through stages to reach Stage 3 (the point where REQ-01 requires auto-push).
    // This block is app-specific: replace with the actual stage-advance action used in UI tests.
    await omsPage.getByRole('button', { name: /release|confirm|stage 3|ready to ship/i }).first().click();

    // 3. Without switching tabs in a dependent way, give MW its 5s cycle + a safety margin
    await tmsPage.waitForTimeout(12000);

    // 4. Assert a brand-new order id now exists in TMS
    const after = await pollApi();
    const newOrders = after.filter(o => !beforeIds.has(o.id));
    expect.soft(newOrders.length).toBeGreaterThan(0);

    // 5. Assert the TMS Orders page UI also auto-refreshed (no manual reload)
    //    i.e., the new order id is visible on the page the user had open from step 1
    const firstNewId = newOrders[0]?.id;
    if (firstNewId) {
      await expect(tmsPage.getByText(firstNewId, { exact: false })).toBeVisible({ timeout: 5000 });
    }

    await omsCtx.close();
    await tmsCtx.close();
  });

  test('no "Send to TMS" or "Sync TMS" button is user-visible on OMS', async ({ page }) => {
    await page.goto(OMS_URL);
    await page.waitForLoadState('networkidle');
    // Manual-sync controls should be hidden unless ?debug=1
    await expect(page.getByRole('button', { name: /send to middleware|send to tms|sync tms/i }))
      .toHaveCount(0);
  });

  test('MW auto-sync is ON by default after boot', async ({ page }) => {
    await page.goto('http://localhost:5173/zoree-middleware.html');
    await page.waitForLoadState('networkidle');
    // TODO(Sridhar): skip login if session auto-restores, else fill creds
    await expect(page.locator('#auto-sync-btn')).toContainText(/auto-sync:\s*on/i);
  });
});
```

Run:
```
cd C:\Zoree\zoree-tms-v3\zoree-tms-v3
npx playwright test test/REQ-01-auto-order-sync.spec.js --reporter=list
```

Three tests total. Pass criteria:

- `order booked ... appears in TMS without any click` — primary acceptance
- `no "Send to TMS" button visible` — enforces the "no manual button" requirement
- `MW auto-sync ON by default` — enforces the "no manual job" requirement

---

## 4. Notes for the tester

- **Test URL:** OMS at `http://localhost:5173/zoree-oms.html`, Middleware at `http://localhost:5173/zoree-middleware.html`, TMS React at `http://localhost:5173`.
- **API:** `http://localhost:3010`.
- **Login:** both HTML pages have login screens with auto-session restore via `localStorage`. If the spec fails at the login step, add env vars `OMS_EMAIL` / `OMS_PASS` / `MW_PASS` to the Playwright config and uncomment the login blocks in the spec.
- **Edge case:** MW auto-sync is now set to 5s. If the test `waitForTimeout(12000)` is too tight in your CI, bump it — the goal is to allow one full sync cycle plus a safety margin, not to race it.
- **Rollback:** re-show the hidden buttons, revert `boot()` insertion, revert stage-advance auto-call, remove `subscribeOrderChanges` usage. No DB changes to roll back.

---

## 5. What this does NOT do (scope discipline)

- Does not add `audit_log` entries for the sync event — that's REQ-02.
- Does not add role checks on the auto-push — that's REQ-04. Planner and admin can still book & auto-push; finance cannot book in the first place.
- Does not change the OMS → MW queue semantics (`mw_requests` table, commands, direct-exec fallback). Those already work; REQ-01 just removes the human gate.
