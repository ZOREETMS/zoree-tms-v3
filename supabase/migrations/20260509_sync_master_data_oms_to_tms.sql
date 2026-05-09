-- ════════════════════════════════════════════════════════════════════
-- Migration: Sync OMS Item Master + Location Master → TMS
-- Date    : 2026-05-09
-- Reason  : OMS owns the master data (oms_inventory, oms_locations) but
--           the TMS items / locations tables had no fan-out path. The
--           code referenced a `req30_sync_locations_oms_to_tms` trigger
--           (see frontend/zoree-oms.html, api/routes/locations.js) but
--           the SQL was never landed. This migration ships:
--             1. enqueue functions that write to public.mw_requests
--             2. AFTER INSERT/UPDATE triggers on oms_inventory and
--                oms_locations
--             3. one-time backfill of every existing row
--
-- Architecture (REQ-30, REQ-31):
--   OMS write → trigger inserts mw_requests row (cmd, payload=row JSON)
--             → middleware portal (frontend/zoree-middleware.html) polls
--               mw_requests → upserts into TMS items / locations
--               via tmsDb() and marks the row done.
--
-- Mapping is performed on the middleware side (single writer for the
-- TMS upsert). See processMWQueue() PUSH_ITEM_TO_TMS and
-- PUSH_LOCATION_TO_TMS branches.
-- ════════════════════════════════════════════════════════════════════

-- ── Step 1: ensure mw_requests has the columns the enqueue uses ─────
-- mw_requests is created elsewhere; this is a defensive guard so the
-- migration is idempotent if the queue table evolves.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mw_requests'
  ) THEN
    RAISE EXCEPTION
      'mw_requests table not found. Run the OMS↔TMS middleware queue migration first.';
  END IF;
END $$;

-- ── Step 2: enqueue function for oms_inventory ──────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_oms_inventory_to_tms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Skip rows the OMS marked inactive — TMS only needs the live catalog.
  -- Reactivation flips active back to true and the trigger fires again.
  IF NEW.active IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mw_requests (cmd, payload, status, created_at)
  VALUES (
    'PUSH_ITEM_TO_TMS',
    row_to_json(NEW)::text,
    'pending',
    now()
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_oms_inventory_to_tms() IS
  'REQ-31: enqueues mw_requests row whenever oms_inventory is written. Middleware portal upserts into TMS items.';

-- ── Step 3: enqueue function for oms_locations ──────────────────────
CREATE OR REPLACE FUNCTION public.enqueue_oms_locations_to_tms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Inactive locations still propagate so TMS can flip status=Inactive
  -- (the middleware handler maps oms.active boolean → tms.status text).
  INSERT INTO public.mw_requests (cmd, payload, status, created_at)
  VALUES (
    'PUSH_LOCATION_TO_TMS',
    row_to_json(NEW)::text,
    'pending',
    now()
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enqueue_oms_locations_to_tms() IS
  'REQ-30: enqueues mw_requests row whenever oms_locations is written. Middleware portal upserts into TMS locations.';

-- ── Step 4: triggers (drop+create so re-run is idempotent) ──────────
DROP TRIGGER IF EXISTS trg_oms_inventory_push_to_tms ON public.oms_inventory;
CREATE TRIGGER trg_oms_inventory_push_to_tms
AFTER INSERT OR UPDATE ON public.oms_inventory
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_oms_inventory_to_tms();

DROP TRIGGER IF EXISTS trg_oms_locations_push_to_tms ON public.oms_locations;
CREATE TRIGGER trg_oms_locations_push_to_tms
AFTER INSERT OR UPDATE ON public.oms_locations
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_oms_locations_to_tms();

-- ── Step 5: one-time backfill ───────────────────────────────────────
-- Enqueues every active item and every location currently in OMS so the
-- middleware can fan them into TMS. Safe to run more than once — the
-- middleware upsert is idempotent (onConflict=id).
INSERT INTO public.mw_requests (cmd, payload, status, created_at)
SELECT
  'PUSH_ITEM_TO_TMS',
  row_to_json(i)::text,
  'pending',
  now()
FROM public.oms_inventory i
WHERE i.active IS TRUE;

INSERT INTO public.mw_requests (cmd, payload, status, created_at)
SELECT
  'PUSH_LOCATION_TO_TMS',
  row_to_json(l)::text,
  'pending',
  now()
FROM public.oms_locations l;

-- ── Step 6: helpful index for the middleware queue poller ───────────
-- The poller does `where status='pending' order by created_at limit 20`;
-- this index keeps it cheap as the queue grows.
CREATE INDEX IF NOT EXISTS idx_mw_requests_pending_created
  ON public.mw_requests (created_at)
  WHERE status = 'pending';

-- ════════════════════════════════════════════════════════════════════
-- ROLLBACK (manual, if ever needed):
--   DROP TRIGGER  IF EXISTS trg_oms_inventory_push_to_tms ON public.oms_inventory;
--   DROP TRIGGER  IF EXISTS trg_oms_locations_push_to_tms ON public.oms_locations;
--   DROP FUNCTION IF EXISTS public.enqueue_oms_inventory_to_tms();
--   DROP FUNCTION IF EXISTS public.enqueue_oms_locations_to_tms();
--   DROP INDEX    IF EXISTS public.idx_mw_requests_pending_created;
--   -- Pending mw_requests rows from the backfill can be cleared with:
--   --   DELETE FROM public.mw_requests
--   --   WHERE cmd IN ('PUSH_ITEM_TO_TMS','PUSH_LOCATION_TO_TMS')
--   --     AND status = 'pending';
-- ════════════════════════════════════════════════════════════════════
