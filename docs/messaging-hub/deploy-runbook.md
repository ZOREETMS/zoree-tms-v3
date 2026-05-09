# Messaging Hub — Deploy Runbook

**Companion to:** `docs/messaging-hub/plan.md` §7 rollout
**Audience:** operator with Supabase + server access (Sridhar)
**Date:** 2026-05-08
**Migration:** `api/migrations/038_messaging_hub.sql`
**Feature flag:** `MESSAGING_HUB_PERSIST` (env var on the API process)
**Rollout style chosen:** staged per plan §7

Each stage is independently revertible. Do **not** advance to the next stage until the verification step for the current stage is green.

---

## Pre-flight (one-time)

Confirm `api/.env` has these variables. Without them the migration runner falls back to the manual SQL-editor path.

```
SUPABASE_ACCESS_TOKEN=sbp_...
SUPABASE_PROJECT_REF=ljbeihotrmyqthxptcgp
```

If the project ref above is **not** the environment you intend to migrate, stop and edit it before running anything below.

---

## Stage 1 — Apply migration 038

This stage creates the `message_log` table plus three lookup tables and seeds them. It is **forward-only and idempotent** — re-running it is safe.

### 1.1 Run

```bash
cd C:\Zoree\zoree-tms-v3\zoree-tms-v3
node scripts/run-migration.js api/migrations/038_messaging_hub.sql
```

Expected on success: a single line `[run-migration] SUCCESS`.

### 1.2 Manual fallback (if the CLI path fails)

```
1. Open https://supabase.com/dashboard/project/ljbeihotrmyqthxptcgp/sql/new
2. Paste the contents of api/migrations/038_messaging_hub.sql
3. Click RUN
```

### 1.3 Verify

In the Supabase SQL editor:

```sql
-- All four tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'message_log', 'message_type_lookup',
    'system_party_lookup', 'message_status_lookup'
  );
-- expect 4 rows

-- Lookup tables seeded
SELECT count(*) FROM message_type_lookup;    -- expect 17
SELECT count(*) FROM system_party_lookup;    -- expect 3
SELECT count(*) FROM message_status_lookup;  -- expect 8

-- All 6 lifecycle codes are present
SELECT code FROM message_type_lookup
WHERE code IN (
  'ORDER_CREATION','SHIPMENT_TENDER','TENDER_RESPONSE',
  'SHIPMENT_DETAILS','SHIP_CONFIRMATION','DELIVERED'
);
-- expect 6 rows

-- Indexes are in place
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND tablename='message_log';
-- expect: ux_ml_source_correlation, idx_ml_status_received,
--         idx_ml_order, idx_ml_shipment, idx_ml_type_dir_received,
--         idx_ml_tenant_received, plus the implicit PK index

-- updated_at trigger is wired
SELECT tgname FROM pg_trigger WHERE tgrelid = 'message_log'::regclass;
-- expect: message_log_updated_at_trg
```

### 1.4 If any check fails

Stop. Do not proceed to Stage 2.
- Inspect the migration output for an error.
- The migration is idempotent — fix the issue and re-run.

---

## Stage 2 — Deploy backend with persistence OFF

Set the feature flag **before** you restart the API. This way the new adapter writer-calls land in production code but every call short-circuits to a no-op until you flip the flag.

### 2.1 Set the env var

On whatever process manages the API (PM2, systemd, your launch script, Render/Railway/etc.):

```
MESSAGING_HUB_PERSIST=false
```

### 2.2 Pull, install, restart

```bash
cd C:\Zoree\zoree-tms-v3\zoree-tms-v3
git pull
npm install:all
# Restart the API process (whatever your supervisor command is)
```

### 2.3 Verify the flag took effect

The writer logs persistence state on require. After the API restarts, hit any endpoint that triggers a hub write (e.g. POST `/api/ingest/oms-orders` from the OMS, or just GET `/api/messaging-hub/messages`) and confirm:

- `GET /api/messaging-hub/messages` returns `{ messages: [...] }` (may be empty — that's fine).
- `GET /api/messaging-hub/kpis` returns counts (zero is fine).
- The API logs show **no** `[messagingHub.writer]` errors.
- New rows are **not** appearing in `message_log` (because persistence is off).

```sql
SELECT count(*) FROM message_log;   -- expect 0 at this stage
```

### 2.4 If anything fails

- Server fails to boot → check that `api/services/messagingHub/*` shipped (file presence, not just git diff).
- 500 on `/api/messaging-hub/*` → check the API logs for missing-table errors. If you see them, Stage 1 didn't actually land — re-run it.
- Adapter endpoints (e.g. `/api/ingest/oms-orders`) start failing → that should not happen because every adapter call is wrapped in try/catch. If you see it, capture logs and disable the flag (`MESSAGING_HUB_PERSIST=false` is already the off state, so a server rollback to the previous commit is the recovery).

---

## Stage 3 — Flip flag in staging

If you only have one Supabase project (no separate staging), promote one carrier or one OMS tenant to be the canary instead.

### 3.1 Set the flag

```
MESSAGING_HUB_PERSIST=true
```

Restart the API.

### 3.2 Drive each of the 6 hops once

Use the existing flows — do not invent test traffic.

| # | Hop | How to drive it |
|---|-----|------------------|
| 1 | OMS → TMS `order_creation`     | Book any new OMS order — middleware will POST `/api/ingest/oms-orders`. |
| 2 | TMS → Carrier `shipment_tender`| In the TMS UI, open an unassigned shipment and call **Tender to Carrier** (or `POST /api/tendering/out` directly). |
| 3 | Carrier → TMS `tender_response`| `POST /api/ingest/carrier-tender-response` with the same `correlationId` returned by hop 2. |
| 4 | TMS → OMS `shipment_details`   | In the TMS UI, **Accept Tender** on the same shipment. |
| 5 | OMS → TMS `ship_confirmation`  | Run the OMS warehouse ship-out flow — middleware will POST `/api/ingest/oms-ship-confirm`. |
| 6 | TMS → OMS `delivered`          | Mark the shipment **Delivered** from the TMS planner. |

### 3.3 Verify

```sql
SELECT message_type, direction, source_system, target_system, status, count(*)
FROM message_log
GROUP BY 1,2,3,4,5
ORDER BY 1;
```

Expected: at least one row for each of the 6 lifecycle codes, with the correct direction / source / target.

Spot-check correlation:

```sql
-- Tender + response should share a correlation_id
SELECT message_type, correlation_id, shipment_id
FROM message_log
WHERE message_type IN ('SHIPMENT_TENDER','TENDER_RESPONSE')
ORDER BY id;
```

### 3.4 Smoke-test the UI

- Open the Messaging Hub page in TMS.
- Confirm new rows appear (it polls every 15 s).
- Tabs **Outbound / Inbound / Failed** filter correctly.
- The compose modal (`POST /api/messaging-hub/compose`) inserts a row.

### 3.5 If anything fails

Set `MESSAGING_HUB_PERSIST=false` and restart. The data captured during the staging run remains in `message_log` for forensic review — it is intentionally not deleted.

---

## Stage 4 — Production flip

Same as Stage 3.1, but on the production API process. Watch the API logs for 30 minutes for any `[messagingHub.*]` warnings. The adapters are best-effort, so a hub error never breaks the underlying OMS sync — the only expected impact of trouble is missing audit rows.

---

## Stage 5 — Decommission frontend seed (optional)

`frontend/src/services/messagingService.js` still exports `generateMessages` (now deprecated). Once the production hub has been live for a release cycle, remove `generateMessages` from the production bundle:

1. Move it under `frontend/src/__seed__/messagingSeed.js` (purely for storybook/tests).
2. Drop the export from `messagingService.js`.
3. Update any test that imports it.

This step is cosmetic — nothing in production calls `generateMessages` after Stage 2.

---

## Stage 6 — Long-term watch

For the next two weeks, monitor:

- `SELECT status, count(*) FROM message_log GROUP BY 1` — `failed` should be a small fraction.
- `SELECT message_type, count(*) FROM message_log WHERE order_id IS NULL AND direction='inbound' GROUP BY 1` — unmatched inbound is the "needs triage" surface (plan §5.8 risk R3).
- API logs for `[messagingHub.writer] insert failed` — should be zero outside of expected idempotency conflicts.

---

## Rollback summary

| Layer | Command | Effect |
|-------|---------|--------|
| Migration | (none — forward-only) | Table stays in place. Safe. |
| Persistence | `MESSAGING_HUB_PERSIST=false` + restart | Hub stops writing immediately. Existing rows remain. |
| Code | `git revert <commit>` + redeploy | Adapter writer-calls disappear. No DB cleanup needed (forward-only). |
| UI | Revert `frontend/src/hooks/useMessaging.js` | Falls back to synthetic seed feed. |

Operational rollback in production is the feature flag, not a SQL `DROP` (per `docs/zoree_db_rules.pdf` §Migration 1 — forward-only).
