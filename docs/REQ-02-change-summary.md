# REQ-02 Change Summary — Change History Capture with Username

Date: 2026-04-16
Author: Claude (AI-assisted)
Cycles: 2 (DEFECT-002 found in cycle 1, fixed + re-verified in cycle 2)

## Requirement

From `C:\Zoree\Requirements\requirements.xlsx`, row 2:

> Whenever shipments or orders are changed in tms, they need to capture the history. For edits, planning, tendering, unassign etc. along with the user who made the changes.

Expected result: **history has to be captured.**

Per the tms-test skill, the acceptance log must show: **field changed, old value, new value, timestamp, username**, and must cover **field edit, planning assign, tendering, unassign**.

## Architecture

Every mutation against `orders` / `shipments` (and future `rates`, `carriers`) now runs through a single recorder (`api/services/changeHistory.js`) that inserts one append-only row per semantic event into a new `change_history` table. The frontend reads these rows via dedicated read endpoints and the existing OrderDetailModal history tab renders them without any tab-structure change.

```
POST /api/orders              ── action='create'
PATCH /api/orders/:id         ── one 'edit' row per changed field + 'unassign' row when shipment_id clears
DELETE /api/orders/:id        ── action='delete' (with tombstone snapshot)
POST /api/bulk-plan/execute   ── batched 'plan' row per order + 'create' row per new shipment
POST /api/tender/email        ── 'status' edit + 'tender' event on success
```

## Files changed

### New files

| Path | Purpose |
|---|---|
| `api/migrations/006_create_change_history.sql` | Append-only `change_history` table with entity/action CHECK constraints and 3 indexes. Full rollback SQL in header. |
| `api/services/changeHistory.js` | `recordChange`, `recordFieldDiffs`, `recordChangeBatch`, `getHistory`, row-builder. Only writer of `change_history`. Swallows errors so a history failure never breaks the main write path. |
| `frontend/src/services/historyService.js` | `getOrderHistory`, `getShipmentHistory` — shapes backend rows into the `[{user, ts, type, changes:[{label, old, new}]}]` format OrderDetailModal's History tab already consumes. Groups per-field edits into change-sets by (action, user, timestamp-to-the-second). |
| `docs/REQ-02-change-summary.md` | This file. |

### Modified files

| Path | Change |
|---|---|
| `api/server.js` | Imports `history` and `ORDER_HISTORY_FIELDS` map. Hooks added to POST/PATCH/DELETE `/api/orders`, `/api/bulk-plan/execute`, `/api/tender/email`. New routes: `GET /api/orders/:id/history` and `GET /api/shipments/:id/history`. `change_history` whitelisted in `ALLOWED`. |
| `api/migrations/README.md` | Logged migration 006. |
| `frontend/src/lib/api.js` | Added `OrdersApi.history(id, limit)` and `ShipmentsApi.history(id, limit)`. |
| `frontend/src/pages/OrdersPage.jsx` | `openDetail()` now calls `getOrderHistory(orderId)` and populates `orderChangeLog[orderId]`. |
| `frontend/src/services/ordersService.js` | `unplanOrderFromShipment` switched from `DbApi.patch` (generic proxy) to `OrdersApi.update` so the unplan goes through the instrumented `/api/orders/:id` endpoint. This is the DEFECT-002 fix. |

## Database change summary (8-point per zoree_db_rules)

1. **Schema changes:** `CREATE TABLE change_history` with 11 columns including `entity_type`, `entity_id`, `action`, `field`, `old_value`, `new_value`, `username`, `user_id`, `user_role`, `metadata jsonb`, `tenant_id`, `created_at`.
2. **Migration file path:** `api/migrations/006_create_change_history.sql`.
3. **Backfill needs:** None. History starts at migration time. Older state is not reconstructable and the design accepts that.
4. **Index changes:** `idx_change_history_entity` on `(entity_type, entity_id, created_at DESC)`; `idx_change_history_created_at`; `idx_change_history_username`.
5. **Constraint changes:** CHECK `entity_type IN ('order','shipment','rate','carrier')`; CHECK `action IN ('create','edit','delete','plan','unassign','tender','untender','status')`.
6. **Rollback SQL:** Documented in migration header — `DROP INDEX ...; DROP TABLE change_history;`.
7. **Affected APIs/UI:** Five write endpoints instrumented; two new GET endpoints; OrdersPage + OrderDetailModal read-through.
8. **Risks & assumptions:** Append-only; service never fails the main write. Service-role inserts; generic `/api/db/:table/:id` PATCH is NOT instrumented (by design — domain endpoints are the source of truth for history; DEFECT-002 made us move the frontend callers that were using the generic proxy).

**Applied to Supabase:** YES — migration 006 was applied by the user before the browser run. Confirmed live via schema probe (`/api/db/change_history?select=id&limit=1` returned 200).

## How to verify locally

1. Migration 006 already applied.
2. `npm run dev` (api :3010, frontend :5173).
3. Open any order → Edit tab → change 2+ fields → Save. Re-open History tab — rows appear with your email and each field's old/new.
4. Click Plan on an order → confirm shipment — a "Planned → Shipment" card appears.
5. Click Unplan — an "Unassigned from Shipment" card plus a "2 fields changed" card (status + shipmentId) appear.
6. If SMTP is configured: click Tender → after email success, shipment status flips to "Tendered" and 2 history rows land (status edit + tender event with metadata).

## Results (from this cycle's browser run)

- Target order: `OMS-E2E-948278`.
- 10 history rows produced across edit / plan / unassign flows.
- 5 change-set cards rendered in the History tab, all attributed to `admin@zoree.io`.
- See `test/results/test-run-REQ2-2026-04-16-1453.xlsx` for the structured report.

## DEFECT-002 (cycle 1 → fixed cycle 2)

- **Title:** `unplanOrderFromShipment` used generic `DbApi.patch`, bypassing the `/api/orders/:id` history hook.
- **Found:** Cycle 1 — clicked Unplan, no `unassign` event appeared in `change_history`.
- **Root cause:** Generic `/api/db/:table/:id` PATCH endpoint is uninstrumented by design; the frontend was hitting it for unplan.
- **Fix:** `ordersService.js:unplanOrderFromShipment` now calls `OrdersApi.update(id, { status: 'Unplanned', shipmentId: null })` which routes through `/api/orders/:id` PATCH → history hook fires → `unassign` event + per-field edits for `status` and `shipmentId`.
- **Status:** Resolved. Cycle-2 replay verified 3 rows at one timestamp: `unassign` (with `metadata.previousShipmentId`), `edit status` Planned→Unplanned, `edit shipmentId` `SHP-2026-1784`→null.

## Open follow-ups

- **Tender UI exercise.** The backend hook is in place and the smoke test covers the round-trip, but the browser run did not click the actual Tender button this session. Next time a shipment is tendered through the UI, confirm the `status` + `tender` rows appear.
- **Generic `/api/db/:table/:id` PATCH is still uninstrumented.** Any other place in the frontend that writes orders or shipments via `DbApi.patch` will still bypass history. Worth auditing usages and either migrating them to domain endpoints or adding a shared middleware layer that records diffs for all `ALLOWED` write tables.
- **Non-order entities.** The `ALLOWED_ENTITIES` set currently covers order, shipment, rate, carrier. If REQ-03+ adds history needs for more entity types (dock appointments, invoices), expand the constant and re-run the migration's CHECK constraint.
