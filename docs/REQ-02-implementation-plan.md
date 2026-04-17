# REQ-02 — Change History Capture

**Requirement:** Every change to an order or shipment (edit, planning, tendering, unassign)
is captured with the username who made it. Show history on demand.

**Acceptance:** Edit an order field → open history → see {field, old, new, timestamp,
username}. Repeat for shipment edits, plan (attach to shipment), tender, unassign.

---

## 1. Change Summary

### Files to modify

| Path | Change | Why |
|---|---|---|
| `api/services/orderMutations.js` | Edit | Emit audit rows on every order mutation (edit, plan, unassign) |
| `api/services/shipments.js` | Edit | Emit audit rows on shipment edit, cost recalc, status change |
| `api/services/bulkPlanExecution.js` | Edit | Emit one audit row per planned order during bulk plan |
| `api/routes/shipments.js` | Edit | New `GET /shipments/:id/history` route delegating to audit service |
| `api/routes/orders.js` | Edit | New `GET /orders/:id/history` route |
| `api/server.js` | Edit | Add tender/unassign endpoints if not present; wire audit emission |
| `frontend/src/pages/OrdersPage.jsx` | Edit | History tab shows live rows from `GET /orders/:id/history` |
| `frontend/src/pages/ShipmentsPage.jsx` | Edit | Same for shipments |
| `frontend/src/services/ordersService.js` | Edit | `getOrderHistory(id)` helper |
| `frontend/src/services/shipmentService.js` | Edit | `getShipmentHistory(id)` helper |

### Files to create

| Path | Purpose |
|---|---|
| `api/services/auditService.js` | Single `logAudit({...})` write helper; everyone calls this |
| `api/migrations/005_create_audit_log.sql` | Table + monthly partitions + retention policy |
| `frontend/src/components/HistoryDrawer.jsx` | Shared component — both Orders and Shipments pages reuse |
| `test/REQ-02-change-history.spec.js` | Playwright spec — 4 test cases (edit, plan, tender, unassign) |

### DB changes

Migration 005 (full body in section 5 below). Creates:

- `audit_log` — partitioned by month on `created_at`
- Trigger function to auto-create next month's partition
- Scheduled function to drop partitions older than 180 days (6-month retention per your answer)

### API changes

- `GET /orders/:id/history` — returns audit rows for an order, newest first
- `GET /shipments/:id/history` — same for shipments
- Both paginated (`?limit=100&before=<ts>`), authorized by `audit.view` feature (see REQ-04)

### Frontend changes

- `HistoryDrawer` — a single component opened from both OrdersPage and ShipmentsPage
- Renders: table with columns Action | Field | Before | After | Actor | Role | When
- "When" formatted as relative (`2 minutes ago`) + tooltip with exact timestamp

### Risks

1. **Audit write failure must not block the business operation.** The `logAudit` call is wrapped in try/catch; a failure is logged to `stderr` (and ideally to a sentry channel later) but the original API call still returns success. Rationale: history is observability; losing a history row is better than failing an order edit.
2. **Partition creation on 1st of month.** The scheduled function creates the next month's partition ahead of time. If it misses, writes fall back to a `DEFAULT` partition (see SQL). This keeps the system writable even if the pg_cron job is paused.
3. **Retention is destructive.** The 180-day partition drop cannot be undone. If you need regulatory retention longer than 180 days for specific records, adjust the retention predicate or exempt certain `action` values.
4. **Bulk plan emits many rows.** Planning 50 orders → 50 audit rows. Keep a bulk-insert path in `auditService.logAuditBatch(rows)` so the write is one SQL roundtrip.

---

## 2. The one write-path rule

Every mutating service function must end with a `logAudit()` call **before** returning.
No UI code writes audit rows. No DB trigger writes audit rows. One helper, one call
site per mutation.

```js
// api/services/auditService.js
const db = require('./supabase');

const VALID_ACTIONS = new Set([
  'create', 'edit', 'plan', 'unassign',
  'tender', 'accept', 'reject',
  'cost_recalc', 'status_change',
  'invoice_match', 'invoice_approve', 'invoice_reject',
  'role_assign', 'tolerance_edit'
]);

async function logAudit({
  tenantId, entityType, entityId, action,
  field = null, before = null, after = null,
  actor = {}
}) {
  if (!VALID_ACTIONS.has(action)) {
    console.warn('[audit] invalid action:', action);
    // don't throw; don't block the business op
    return;
  }
  try {
    await db.dbInsert('audit_log', [{
      tenant_id:      tenantId || 'zoree-default',
      entity_type:    entityType,
      entity_id:      entityId,
      action,
      field,
      before_value:   before,
      after_value:    after,
      actor_user_id:  actor.id || null,
      actor_username: actor.username || actor.email || 'system',
      actor_role:     actor.role || 'unknown',
    }]);
  } catch (e) {
    console.error('[audit] write failed:', e.message, { entityType, entityId, action });
    // swallow — business op must not fail because audit failed
  }
}

async function logAuditBatch(rows) {
  const valid = rows.filter(r => VALID_ACTIONS.has(r.action));
  if (!valid.length) return;
  try { await db.dbInsert('audit_log', valid.map(toDbRow)); }
  catch (e) { console.error('[audit] batch write failed:', e.message); }
}

async function getHistory(entityType, entityId, { limit = 100, before = null } = {}) {
  const filters = [['entity_type','eq',entityType], ['entity_id','eq',entityId]];
  if (before) filters.push(['created_at','lt',before]);
  return db.dbSelect('audit_log', {
    filters,
    orderBy: 'created_at.desc',
    limit,
  });
}

module.exports = { logAudit, logAuditBatch, getHistory };
```

## 3. Call-site examples

### Order edit (in `orderMutations.js`)

```js
async function editOrder(id, patch, ctx) {
  const before = await getOrderById(id);
  const after  = await applyPatch(id, patch);
  // emit one audit row per field actually changed
  const changedFields = Object.keys(patch).filter(k => before[k] !== after[k]);
  await Promise.all(changedFields.map(field =>
    audit.logAudit({
      tenantId: ctx.tenantId, entityType: 'order', entityId: id, action: 'edit',
      field, before: before[field], after: after[field], actor: ctx.user
    })
  ));
  return after;
}
```

### Bulk plan (in `bulkPlanExecution.js`)

```js
// After all shipments inserted, emit batch audit rows
await audit.logAuditBatch(
  plans.flatMap(p => p.orderIds.map(orderId => ({
    tenantId: ctx.tenantId, entityType: 'order', entityId: orderId, action: 'plan',
    after: { shipmentId: shipIds[p.groupKey] }, actor: ctx.user
  })))
);
```

### Tender a shipment

```js
async function tenderShipment(shipId, carrierId, ctx) {
  const before = await getShipment(shipId);
  await patchShipment(shipId, { status: 'Tendering', carrier: carrierId });
  await audit.logAudit({
    tenantId: ctx.tenantId, entityType: 'shipment', entityId: shipId, action: 'tender',
    before: { status: before.status, carrier: before.carrier },
    after:  { status: 'Tendering', carrier: carrierId },
    actor: ctx.user,
  });
}
```

## 4. Frontend history UI

`components/HistoryDrawer.jsx` props: `{ open, onClose, entityType, entityId }`.
On open, calls `getOrderHistory(id)` or `getShipmentHistory(id)` and renders:

| When | Actor | Action | Field | Before | After |
|---|---|---|---|---|---|
| 2 min ago | sridhar | edit | weight | 1200 | 1250 |
| 3 min ago | sridhar | plan | shipmentId | (empty) | SHP-2026-1042 |
| 1 hr ago | planner01 | create | — | — | {…full row} |

Paginated "Load older" button calls `getHistory(id, { before: oldest.created_at })`.

Reused from both OrdersPage (tab called "History" on the order detail modal) and
ShipmentsPage (same tab in shipment detail).

## 5. Migration 005 — SQL body

```sql
-- ═══════════════════════════════════════════════════════════════════
-- Migration: 005_create_audit_log.sql
-- Description: REQ-02 change history foundation.
--              audit_log captures (entity, entity_id, action, before, after,
--              actor, ts) for every mutation on orders/shipments/invoices.
-- Affected:    api/services/auditService.js (new),
--              orderMutations.js, shipments.js, bulkPlanExecution.js,
--              freightAuditService.js (later for invoices),
--              GET /orders/:id/history, GET /shipments/:id/history,
--              frontend HistoryDrawer component.
-- Backfill:    None — history starts now.
-- Rollback:    See ROLLBACK block at bottom.
-- Risks:       Bulk operations produce many rows — batch inserts required.
--              180-day retention drops partitions permanently.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- Parent (partitioned by RANGE on created_at) ----------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       text        NOT NULL DEFAULT 'zoree-default',
  entity_type     text        NOT NULL CHECK (entity_type IN ('order','shipment','invoice','role','config')),
  entity_id       text        NOT NULL,
  action          text        NOT NULL,
  field           text,
  before_value    jsonb,
  after_value     jsonb,
  actor_user_id   text,
  actor_username  text        NOT NULL,
  actor_role      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)                    -- partition key must be in PK
) PARTITION BY RANGE (created_at);

-- Indexes on parent -> inherited by partitions
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_tenant_time_idx
  ON audit_log (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx
  ON audit_log (actor_user_id, created_at DESC);

-- Default partition catches any row outside declared ranges
CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

-- Seed current + next month so writes don't hit the default -------
DO $$
DECLARE
  m1 date := date_trunc('month', now())::date;
  m2 date := (date_trunc('month', now()) + interval '1 month')::date;
  m3 date := (date_trunc('month', now()) + interval '2 month')::date;
  stmt text;
BEGIN
  FOR i IN 0..2 LOOP
    stmt := format(
      'CREATE TABLE IF NOT EXISTS audit_log_%s PARTITION OF audit_log
         FOR VALUES FROM (%L) TO (%L);',
      to_char(date_trunc('month', now()) + (i || ' month')::interval, 'YYYY_MM'),
      (date_trunc('month', now()) + (i || ' month')::interval)::date,
      (date_trunc('month', now()) + ((i+1) || ' month')::interval)::date
    );
    EXECUTE stmt;
  END LOOP;
END $$;

-- Maintenance: create next month's partition + drop > 6 months ----
CREATE OR REPLACE FUNCTION audit_log_rollover() RETURNS void AS $$
DECLARE
  next_name text;
  drop_cut  timestamptz := now() - interval '180 days';
  part      text;
BEGIN
  -- 1. Ensure a partition exists for two months out
  next_name := 'audit_log_' || to_char(date_trunc('month', now()) + interval '2 month', 'YYYY_MM');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log
       FOR VALUES FROM (%L) TO (%L);',
    next_name,
    (date_trunc('month', now()) + interval '2 month')::date,
    (date_trunc('month', now()) + interval '3 month')::date
  );

  -- 2. Drop partitions whose upper bound is older than 180 days
  FOR part IN
    SELECT inhrelid::regclass::text
    FROM pg_inherits
    WHERE inhparent = 'audit_log'::regclass
      AND inhrelid::regclass::text LIKE 'audit_log_20%'
      AND inhrelid::regclass::text <
          'audit_log_' || to_char(drop_cut, 'YYYY_MM')
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || part;
  END LOOP;
END $$ LANGUAGE plpgsql;

-- Optional: schedule via pg_cron if enabled on your project
-- SELECT cron.schedule('audit_log_rollover', '0 3 1 * *', 'SELECT audit_log_rollover()');

-- RLS (single-tenant fallback; adapt when multi-tenant lands) -----
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  FOR SELECT USING (
    tenant_id = coalesce(current_setting('app.tenant_id', true), 'zoree-default')
  );

DROP POLICY IF EXISTS audit_log_write_any ON audit_log;
CREATE POLICY audit_log_write_any ON audit_log
  FOR INSERT WITH CHECK (true);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (run manually if needed)
-- ═══════════════════════════════════════════════════════════════════
-- BEGIN;
-- DROP FUNCTION IF EXISTS audit_log_rollover();
-- DROP TABLE IF EXISTS audit_log CASCADE;   -- cascades to all partitions
-- COMMIT;
```

## 6. Playwright spec — `test/REQ-02-change-history.spec.js`

```js
const { test, expect } = require('@playwright/test');

const TMS = 'http://localhost:5173';
const API = 'http://localhost:3010';

async function login(page, role = 'admin') {
  await page.goto(TMS + '/login');
  await page.getByLabel(/email/i).fill(process.env[`TMS_${role.toUpperCase()}_EMAIL`]);
  await page.getByLabel(/password/i).fill(process.env[`TMS_${role.toUpperCase()}_PASS`]);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(dashboard|home|orders)/);
}

test.describe('REQ-02: Change history captured with user', () => {

  test('editing an order field records before/after/username', async ({ page }) => {
    await login(page, 'admin');
    await page.goto(TMS + '/orders');
    await page.waitForLoadState('networkidle');
    // Pick first unplanned order
    await page.getByRole('row').nth(1).click();
    await page.getByRole('tab', { name: /edit/i }).click();
    const prior = await page.getByLabel(/weight/i).inputValue();
    const next  = String(parseInt(prior || '100') + 50);
    await page.getByLabel(/weight/i).fill(next);
    await page.getByRole('button', { name: /save/i }).click();
    await page.getByRole('tab', { name: /history/i }).click();
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toContainText(/weight/i);
    await expect(firstRow).toContainText(prior);
    await expect(firstRow).toContainText(next);
    await expect(firstRow).toContainText(/admin|sridhar/i);
  });

  test('planning (add to shipment) writes a "plan" audit row', async ({ page }) => {
    await login(page, 'planner');
    await page.goto(TMS + '/orders');
    await page.waitForLoadState('networkidle');
    // trigger plan-one action on first unplanned order
    await page.getByRole('button', { name: /plan/i }).first().click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.waitForTimeout(2000);
    await page.getByRole('tab', { name: /history/i }).click();
    await expect(page.getByText(/plan/i).first()).toBeVisible();
  });

  test('tendering a shipment writes a "tender" audit row', async ({ page }) => {
    await login(page, 'planner');
    await page.goto(TMS + '/shipments');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').nth(1).click();
    await page.getByRole('button', { name: /tender/i }).click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.getByRole('tab', { name: /history/i }).click();
    await expect(page.getByText(/tender/i).first()).toBeVisible();
  });

  test('unassigning an order writes an "unassign" audit row', async ({ page }) => {
    await login(page, 'planner');
    await page.goto(TMS + '/shipments');
    await page.waitForLoadState('networkidle');
    await page.getByRole('row').nth(1).click();
    await page.getByRole('button', { name: /unassign|remove/i }).first().click();
    await page.getByRole('button', { name: /confirm/i }).click();
    await page.getByRole('tab', { name: /history/i }).click();
    await expect(page.getByText(/unassign/i).first()).toBeVisible();
  });
});
```

## 7. Notes for the tester

- Seed users `admin01@zoree.local`, `planner01@zoree.local`, `finance01@zoree.local` (passwords in your `.env`, added by REQ-04).
- History drawer must render within 500ms of opening — otherwise the perceptible UX suffers. Add a skeleton loader.
- If a mutation succeeds but its audit row is missing (rare — only under DB pressure), the business op is not re-tried. Log to stderr; monitor.
