-- Migration: 045_orders_shipments_updated_at_trigger
-- Date:      2026-05-16
-- Author:    Claude (AI-assisted, requested by @sidtkonathala)
-- Feature:   Auto-bump public.orders.updated_at and public.shipments.updated_at
--            on every UPDATE — closes the silent staleness bug that caused
--            mobile to keep showing old ready/due dates after a web edit.
--
-- Purpose
-- ───────
-- `public.orders` and `public.shipments` both have `updated_at TIMESTAMPTZ
-- DEFAULT now()` columns, but DEFAULT only fires on INSERT. There was no
-- BEFORE UPDATE trigger, and the PATCH /api/orders/:id (api/server.js
-- around L1785) and PATCH /api/shipments/:id paths build their patch via
-- api/services/orderMutations.js#apiOrderToDbPatch and the analogous
-- shipment patcher — neither of which writes `updated_at`. As a result,
-- after a web user edits ready/due dates on an order, the row's
-- `updated_at` keeps pointing at the create timestamp.
--
-- Why that breaks mobile (the symptom the user reported):
--   • mobile/src/hooks/orderDetailSyncSignature.ts builds its sync key
--     primarily from `updated_at` (`u:${updated_at}`) so the screen can
--     tell when the order has changed server-side. When `updated_at`
--     never changes, the signature is identical before/after the edit and
--     useOrderDetailLiveSync's syncTick does not increment — per-detail
--     re-fetches (lines, history) are no longer triggered by the realtime
--     channel and the screen has to rely on whatever happens to be in
--     DataContext.data.orders. Pull-to-refresh or app-foreground are the
--     only escape hatches, which is exactly what the user described.
--   • Any external consumer that polls `updated_at > :since` also misses
--     the edit. Today that includes the OMS↔TMS middleware reconcilers.
--
-- The sibling `oms_*` tables already use exactly this pattern via
-- `public.set_updated_at()` (created in an earlier migration; see
-- `oms_orders`, `oms_customers`, `oms_locations`, `oms_dock_schedule`,
-- `oms_inventory`). We reuse that same function here so there is one
-- canonical "updated_at bumper" in the database.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   No column additions. Adds two BEFORE UPDATE row triggers:
--     • trg_orders_set_updated_at    ON public.orders
--     • trg_shipments_set_updated_at ON public.shipments
--   Both call the existing public.set_updated_at() function which
--   simply assigns NEW.updated_at = now() before the row is written.
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   Intentionally NONE. The historical rows with stale `updated_at`
--   are stale because they were edited before the trigger existed.
--   Backfilling them all to now() would invalidate every cached
--   client's last-seen timestamp simultaneously and force a full
--   refresh on every connected device — a thundering-herd we'd
--   rather avoid. Next edit of each row will bump it naturally.
--
--   Out-of-band remediation for the specific rows that surfaced the
--   bug (run only if a planner needs immediate sync on a specific id):
--     UPDATE public.orders SET updated_at = now() WHERE id = 'ORD-...';
--   No code change needed — that UPDATE itself will now bump.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. There is no index on updated_at today and adding the
--   trigger doesn't change query plans.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. The column is already TIMESTAMPTZ nullable with default
--   now(); the trigger sets it on every UPDATE without touching the
--   column definition.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • PATCH /api/orders/:id, PATCH /api/shipments/:id, and every
--       caller of dbUpdate('orders'|'shipments', …) will now produce
--       rows whose updated_at reflects the actual edit time. No code
--       change needed in the writers themselves — the DB does it.
--   Realtime:
--     • Supabase postgres_changes already fired on every UPDATE
--       regardless of updated_at; the trigger does not change that.
--       What it DOES fix is downstream consumers (mobile sync
--       signature, middleware reconcilers) that key on the column.
--   Frontend:
--     • mobile useOrderDetailLiveSync now bumps syncTick correctly
--       so the History and per-line table re-fetch from the realtime
--       channel without the user having to leave/return to the screen.
--     • web frontend/src/hooks/useRealtimeOrders.js is unaffected —
--       it triggers on any UPDATE event, doesn't read updated_at.
--   OMS sync:
--     • api/services/omsSync's delta polling (which uses updated_at >
--       last_seen) will now see every edit on the TMS side, not just
--       the ones that happened to touch a column where the writer set
--       updated_at explicitly. This was probably masking missed
--       reconciliations; flag for QA to revisit any "OMS missed an
--       update" bug reports older than this migration.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   DROP TRIGGER IF EXISTS trg_orders_set_updated_at ON public.orders;
--   DROP TRIGGER IF EXISTS trg_shipments_set_updated_at ON public.shipments;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • A handful of writers may have been relying on the fact that
--     `updated_at` did NOT change on certain UPDATEs (e.g. so a
--     reconciler would not "see" a touch-only no-op). git grep for
--     `updated_at` in api/services/* showed no such gating. Any code
--     that explicitly sets updated_at in its own patch continues to
--     work because the BEFORE UPDATE trigger runs last and overwrites
--     the per-statement assignment — that's intentional, the trigger
--     IS the source of truth from now on.
--   • OFP tests in api/__tests__/ that snapshot rows by `updated_at`
--     equality will now see fresh timestamps on every UPDATE; spot-
--     check `bulkPlanImport.bugfix.test.js`, none of which assert on
--     exact updated_at values.
--   • REPLICA IDENTITY: orders / shipments are part of the
--     supabase_realtime publication (verified 2026-05-16). The
--     trigger fires on logical-replication-emitted UPDATEs as well,
--     so realtime consumers see the bumped value too.
--   • The `public.set_updated_at()` function is defined with
--     `SET search_path TO ''` (see 20260425_fix_rls_advisor_errors
--     era) so adding triggers that call it does not regress the
--     mutable-search-path advisor.
--
-- ───────────────────────────────────────────────────────────────
-- 8. VERIFICATION
-- ───────────────────────────────────────────────────────────────
--   Run after apply:
--     -- Triggers exist on both tables
--     SELECT c.relname, t.tgname
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--     WHERE NOT t.tgisinternal
--       AND c.relname IN ('orders','shipments')
--       AND t.tgname LIKE '%set_updated_at';
--     -- Bump is observable
--     UPDATE public.orders SET notes = notes WHERE id = '<test_id>';
--     SELECT id, updated_at FROM public.orders WHERE id = '<test_id>';

BEGIN;

-- Idempotent — re-running the migration is a no-op.
DROP TRIGGER IF EXISTS trg_orders_set_updated_at    ON public.orders;
DROP TRIGGER IF EXISTS trg_shipments_set_updated_at ON public.shipments;

CREATE TRIGGER trg_orders_set_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_shipments_set_updated_at
BEFORE UPDATE ON public.shipments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TRIGGER trg_orders_set_updated_at ON public.orders IS
  'Auto-bump updated_at on every UPDATE. Closes the silent staleness '
  'bug where mobile sync signatures (and OMS reconcilers) keyed on '
  'updated_at would not detect a write. Added in migration 045.';

COMMENT ON TRIGGER trg_shipments_set_updated_at ON public.shipments IS
  'Auto-bump updated_at on every UPDATE. Mirror of the orders trigger '
  'added in migration 045 — same staleness class of bug, same fix.';

COMMIT;
