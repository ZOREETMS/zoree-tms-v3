# REQ-05 — Bulk Planning Performance (50 Orders, LTL/TL Mix)

**Requirement:** Load 50 orders (mixed LTL/TL eligible, different lanes),
trigger bulk plan, measure how long it takes.

**Acceptance:** Completion in under 2 minutes. All 50 orders assigned to
shipments after planning. Performance timing surfaced in UI.

---

## 1. Change Summary

### Files to modify

| Path | Change | Why |
|---|---|---|
| `api/services/bulkPlanExecution.js` | Edit | Parallelize shipment inserts (bounded concurrency); single batched update for order `shipment_id` |
| `api/routes/shipments.js` | Edit | `POST /shipments/bulk-plan` returns `{ shipments, ordersUpdated, elapsedMs }` |
| `frontend/src/pages/BulkPlanPage.jsx` | Edit | Progress bar + final "Completed in 43s" banner |
| `frontend/src/services/bulkPlanService.js` | Edit | Expose `elapsedMs` from response to UI |

### Files to create

| Path | Purpose |
|---|---|
| `api/migrations/007_bulk_plan_runs.sql` | Telemetry table for perf tracking |
| `scripts/seed-50-orders.js` | Idempotent seed script: 50 orders across 10 lanes, mixed modes |
| `test/REQ-05-bulk-plan-perf.spec.js` | Playwright spec — asserts <120s end-to-end + all 50 planned |

### DB changes

Migration 007 — `bulk_plan_runs(id, started_at, finished_at, order_count, shipment_count, ms_elapsed, user_id, error_count)`.

### API changes

Response shape:
```json
{
  "shipments": [ { "id": "SHP-2026-...", "order_ids": ["ORD-..."] } ],
  "ordersUpdated": 50,
  "elapsedMs": 43120,
  "runId": "<uuid>"
}
```

### Frontend changes

Progress bar ticks on `/api/shipments/bulk-plan-runs/:runId` via the existing
service polling. Final banner shows elapsed.

### Risks

1. **Serial inserts are the bottleneck.** Current `bulkPlanExecution.js` inserts shipments one at a time in a `for` loop. Parallelize with `p-limit(5)` to avoid hammering the DB but still cut wall time ~4x.
2. **Order `shipment_id` updates can be batched** — one `UPDATE orders SET shipment_id = <map> WHERE id IN (...)` per shipment group, not per order.
3. **Rate lookups dominate if external.** If your rate engine is an external API, batch-call it before the insert loop (one call for all 50).
4. **Target "under 2 minutes" is soft.** Real wall time depends on Supabase round-trip latency. The spec tolerates flaky CI with a 150s soft ceiling + hard 180s fail.

---

## 2. Bulk plan core — shape of the optimization

```js
// api/services/bulkPlanExecution.js — revised signature

async function executeBulkPlans(plans, { SUPABASE_URL, SERVICE_KEY, dbSelect }) {
  const started = Date.now();
  const runId = crypto.randomUUID();

  // 1. Pre-fetch rates for all distinct (origin, dest, mode) tuples in parallel
  const lanes = dedupe(plans.map(p => ({ origin: p.origin, dest: p.destination, mode: p.mode })));
  const rates = await Promise.all(lanes.map(fetchLaneRate));

  // 2. Attach rate to each plan (in memory, no further API calls)
  plans.forEach(p => p.rate = rates.find(r => matches(r, p)).rate);

  // 3. Build all shipment rows once; insert in parallel with concurrency cap
  const pLimit = require('p-limit')(5);
  const results = await Promise.all(plans.map(plan => pLimit(() => insertOneShipment(plan))));

  // 4. Batch-update orders.shipment_id — one UPDATE per shipment group
  await Promise.all(results.map(r => batchAssignOrders(r.shipId, r.orderIds)));

  const finished = Date.now();
  const elapsedMs = finished - started;

  // 5. Telemetry row
  await dbInsert('bulk_plan_runs', [{
    id: runId, started_at: new Date(started).toISOString(),
    finished_at: new Date(finished).toISOString(),
    order_count: sumOrders(plans),
    shipment_count: results.length,
    ms_elapsed: elapsedMs,
    error_count: results.filter(r => r.error).length,
  }]);

  // 6. Audit batch (REQ-02)
  await audit.logAuditBatch(results.flatMap(r => r.orderIds.map(orderId => ({
    entityType: 'order', entityId: orderId, action: 'plan',
    after: { shipmentId: r.shipId }, actor: /* ctx.user */
  }))));

  return { shipments: results, ordersUpdated: sumOrders(plans), elapsedMs, runId };
}
```

## 3. Migration 007 — SQL

```sql
-- 007_bulk_plan_runs.sql
-- Description: REQ-05 perf telemetry — one row per bulk-plan invocation.
-- Affected:    bulkPlanExecution.js (writes), BulkPlanPage.jsx (reads).
-- Backfill:    None.
-- Rollback:    DROP TABLE bulk_plan_runs.
-- Risks:       Table grows unbounded; add retention policy later if needed.

BEGIN;

CREATE TABLE IF NOT EXISTS bulk_plan_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL,
  finished_at    timestamptz NOT NULL,
  order_count    int NOT NULL,
  shipment_count int NOT NULL,
  ms_elapsed     int NOT NULL,
  error_count    int DEFAULT 0,
  user_id        text,
  tenant_id      text DEFAULT 'zoree-default',
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bulk_plan_runs_time_idx ON bulk_plan_runs (started_at DESC);

COMMIT;

-- ROLLBACK: DROP TABLE bulk_plan_runs;
```

## 4. `scripts/seed-50-orders.js`

Idempotent. Run before the perf test. Upserts 50 orders across 10 distinct lanes.

```js
// 25 LTL-eligible (weight 500–14,999), 25 TL-eligible (weight >=15,000)
const lanes = [
  { origin: 'Dallas, TX 75201',    dest: 'Houston, TX 77002' },
  { origin: 'Chicago, IL 60601',   dest: 'Detroit, MI 48201' },
  { origin: 'Atlanta, GA 30303',   dest: 'Miami, FL 33101' },
  { origin: 'Denver, CO 80202',    dest: 'Salt Lake City, UT 84101' },
  { origin: 'Los Angeles, CA 90001', dest: 'Phoenix, AZ 85001' },
  { origin: 'Seattle, WA 98101',   dest: 'Portland, OR 97201' },
  { origin: 'Boston, MA 02108',    dest: 'New York, NY 10001' },
  { origin: 'Minneapolis, MN 55401', dest: 'Milwaukee, WI 53202' },
  { origin: 'Nashville, TN 37201', dest: 'Memphis, TN 38103' },
  { origin: 'Kansas City, MO 64101', dest: 'Omaha, NE 68102' },
];

const orders = [];
for (let i = 0; i < 50; i++) {
  const lane = lanes[i % 10];
  const isLTL = i < 25;
  orders.push({
    id: `ORD-PERF-${String(i+1).padStart(3,'0')}`,
    customer: 'PerfTestCo',
    origin: lane.origin, dest: lane.dest,
    weight: isLTL ? 500 + i * 100 : 15000 + i * 500,
    pieces: 10 + i,
    commodity: 'General freight',
    ship_mode: isLTL ? 'LTL' : 'TL',
    status: 'Unplanned',
    ready: new Date().toISOString().slice(0, 10),
    due: new Date(Date.now() + 5*86400000).toISOString().slice(0, 10),
  });
}

// UPSERT one shot via PostgREST
await fetch(`${SUPABASE_URL}/rest/v1/orders?on_conflict=id`, {
  method: 'POST',
  headers: {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  },
  body: JSON.stringify(orders),
});
```

## 5. Playwright spec — `test/REQ-05-bulk-plan-perf.spec.js`

```js
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');

const TMS = 'http://localhost:5173';

test.describe.configure({ mode: 'serial' });

test.describe('REQ-05: Bulk plan performance', () => {

  test.beforeAll(() => {
    execSync('node scripts/seed-50-orders.js', { stdio: 'inherit' });
  });

  test('bulk-plan 50 orders completes under 120s, all assigned', async ({ page, request }) => {
    await page.goto(TMS + '/bulk-plan');
    await page.waitForLoadState('networkidle');

    // Filter / select the 50 seeded perf orders
    await page.getByLabel(/search/i).fill('ORD-PERF-');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /select all/i }).click();

    const start = Date.now();
    await page.getByRole('button', { name: /bulk plan/i }).click();

    // Expect the completion banner to appear with elapsed time
    const banner = page.getByTestId('bulk-plan-completed-banner');
    await expect(banner).toBeVisible({ timeout: 150_000 });
    const elapsedMs = Date.now() - start;
    console.log('BULK PLAN ELAPSED ms:', elapsedMs);
    expect(elapsedMs).toBeLessThan(120_000);

    // All 50 orders should now have shipment_id set
    const resp = await request.get('/api/orders?status=Planned&customer=PerfTestCo&limit=60');
    const planned = await resp.json();
    expect(planned.filter(o => o.id.startsWith('ORD-PERF-')).length).toBe(50);
  });
});
```

## 6. Notes for the tester

- Run this test **alone** — it's I/O heavy. `--workers=1` or put in its own Playwright project.
- Baseline expectation after optimization: ~30-60s depending on Supabase region latency. If it creeps over 90s, check `bulk_plan_runs` rows — p-limit cap too low, rate engine slow, or DB saturation.
- If your Supabase region is far from your dev box, the raw round-trip dominates. Consider running the bulk-plan test against a local Postgres fixture for CI stability.
