# REQ-01 Change Summary — Auto order sync OMS → TMS

Date: 2026-04-16
Author: Claude (AI-assisted)
Cycle: 1

## Requirement

From `C:\Zoree\Requirements\requirements.xlsx`, row 1:

> In the order management system, once order is booked, it should automatically be sent to TMS. No need to click another button and no need to run the job manually in Middleware. The transaction should flow OMS → middleware → TMS immediately without any delay.

Expected result: **Order is automatically sent to TMS.**

## Architecture

OMS (external) → Middleware (external) → **TMS** via new push endpoint → in-process event bus → SSE stream → Orders page refresh

- **Inbound endpoint:** `POST /api/ingest/oms-orders` accepts `{ orders: [...] }` from the middleware. Stamps every row with `sync_source='oms'` and `auto_synced_at=NOW()`.
- **Event bus:** in-process `EventEmitter` singleton; no external broker needed.
- **Outbound stream:** `GET /api/events/orders` Server-Sent Events feed; any TMS tab auto-subscribes on mount.
- **UI:** `OrdersPage` calls `refreshData()` on each event with a 250 ms debounce. No button, no interval timer, no manual action.

## Files changed

### New files

| Path | Purpose |
|---|---|
| `api/migrations/005_add_oms_sync_columns.sql` | Adds `sync_source`, `auto_synced_at`, `oms_order_ref` to `orders`. |
| `api/services/eventBus.js` | Singleton `EventEmitter` + shared event-name constants. |
| `api/services/orderIngest.js` | Validation + field mapping + upsert for OMS batch ingest. |
| `api/routes/ingest.js` | `POST /api/ingest/oms-orders` + `GET /api/events/orders` (SSE). |
| `scripts/run-migration.js` | One-shot Supabase DDL runner (delete after use). |
| `playwright.config.js` | Root Playwright config pointing at `test/`. |
| `test/REQ-01-auto-order-sync.spec.js` | End-to-end tests for the requirement. |
| `docs/REQ-01-change-summary.md` | This file. |

### Modified files

| Path | Change |
|---|---|
| `api/server.js` | Imports new router + event bus; mounts `app.use('/api/ingest', ingestRouter)` and `app.use('/api', ingestRouter)`; emits `ORDER_CREATED` after `POST /api/orders` upsert so realtime fires for UI-created orders too. |
| `api/migrations/README.md` | Logged migration 005. |
| `frontend/src/services/ordersService.js` | Added `subscribeOrderChanges(handlers)` using `EventSource`. |
| `frontend/src/pages/OrdersPage.jsx` | `useEffect` opens the SSE subscription on mount, calls `refreshData()` on each event (250 ms debounce), tracks `autoSyncLive` / `lastSyncAt` / `lastSyncCount` state. |

## Database change summary (8-point checklist per zoree_db_rules)

1. **Schema changes:** `ALTER TABLE orders ADD COLUMN sync_source TEXT NOT NULL DEFAULT 'manual', auto_synced_at TIMESTAMPTZ, oms_order_ref TEXT;` plus `CHECK` constraint whitelisting sync_source.
2. **Migration file path:** `api/migrations/005_add_oms_sync_columns.sql`.
3. **Backfill needs:** None. Default `'manual'` applies to existing rows.
4. **Index changes:** `idx_orders_sync_source` on `sync_source`; `idx_orders_auto_synced_at` on `auto_synced_at DESC`.
5. **Constraint changes:** `CHECK (sync_source IN ('manual','oms','api','import'))`.
6. **Rollback SQL:** Documented in the migration file header. `DROP INDEX ...; ALTER TABLE orders DROP CONSTRAINT ...; ALTER TABLE orders DROP COLUMN ...`.
7. **Affected APIs/UI:** `/api/ingest/oms-orders` (new), `/api/events/orders` (new), `/api/orders` (now emits event), `OrdersPage` subscription.
8. **Risks & assumptions:** Additive; nullable; low risk. Assumption: `orders.id` is the natural upsert key. Assumption: middleware authenticates via `INGEST_API_KEY` env var (auth is skipped if unset, suitable for local tests).

**Applied to Supabase:** NO (manual required — sandbox has no egress to Supabase). Run:
```
cd zoree-tms-v3
node scripts/run-migration.js api/migrations/005_add_oms_sync_columns.sql
# OR paste the file into Supabase Dashboard > SQL Editor
```

## How to verify locally

1. Apply the migration (see above).
2. Start the stack:
   ```
   cd zoree-tms-v3
   npm run dev
   ```
   Frontend on :5173, API on :3010.
3. Open the Orders page in a browser tab and keep it open.
4. From another terminal, POST a sample order (this simulates the middleware):
   ```
   curl -X POST http://localhost:3010/api/ingest/oms-orders ^
     -H "Content-Type: application/json" ^
     -d "{\"orders\":[{\"id\":\"OMS-DEMO-1\",\"customer\":\"Demo\",\"origin\":\"ATLANTA, GA\",\"destination\":\"DALLAS, TX\",\"weight\":1200,\"pieces\":4,\"commodity\":\"General\",\"omsOrderRef\":\"OMS-REF-1\"}]}"
   ```
5. `OMS-DEMO-1` should appear on the Orders page within ~1 second **with no click or reload**.

## How to run the Playwright test

```
cd zoree-tms-v3
npm i -D @playwright/test
npx playwright install chromium
npx playwright test test/REQ-01-auto-order-sync.spec.js --reporter=list
```

Environment variables the test honours:
- `FRONTEND_URL` (default `http://localhost:5173`)
- `API_URL` (default `http://localhost:3010`)
- `INGEST_API_KEY` (optional; must match the API's env var if set)
- `TEST_USERNAME` / `TEST_PASSWORD` (only needed if login form appears)

The spec covers four cases:
1. OMS push path: middleware POSTs to `/api/ingest/oms-orders`; TMS Orders page shows the row without any button click.
2. Two-tab realtime: order created via `POST /api/orders` in tab A appears in tab B.
3. Audit columns: ingested orders carry `sync_source='oms'`, `auto_synced_at`, `oms_order_ref`.
4. Validation: malformed payloads are rejected with 400.

## Stopping conditions
- All four tests green → REQ-01 DONE.
- Persistent defects after three dev/test cycles → surface to user.

## Open follow-ups (for future cycles / REQs)

- Middleware → `/api/ingest/oms-orders` wiring lives outside this repo. Set `INGEST_API_KEY` in `api/.env` and share it with the middleware once that side is ready.
- A small "Auto-sync • live" badge in the Orders page header would make the feature discoverable; state (`autoSyncLive`, `lastSyncAt`, `lastSyncCount`) is already tracked — only a small JSX snippet is needed.
- `PATCH /api/orders/:id` and `DELETE /api/orders/:id` do not yet emit `ORDER_UPDATED` / `ORDER_DELETED`. REQ-02 will likely revisit those paths for change-history capture; folding the emits in there avoids churn.
