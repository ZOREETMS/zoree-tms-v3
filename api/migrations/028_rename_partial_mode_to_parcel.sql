-- Migration: 028_rename_partial_mode_to_parcel
-- Date: 2026-04-25
-- Author: Claude (AI-assisted)
-- Description: Rename shipment mode value 'Partial' → 'Parcel' system-wide.
--              The 'Partial' mode was confusing because it overlapped with
--              the load-type label 'Partial TL' (a weight-derived classifier,
--              not a mode). Operations standardised on 'Parcel' as the
--              fourth mode alongside TL / LTL / Air.
--
-- Affected tables:
--   dock_loading_durations  — PK row 'Partial' becomes 'Parcel' (and label).
--   shipments               — UPDATE every row where mode = 'Partial'.
--   orders                  — UPDATE every row where mode = 'Partial'.
--   oms_orders              — UPDATE every row where mode = 'Partial' (if column exists).
--   documents               — UPDATE every row where mode = 'Partial'.
--   route_templates         — UPDATE every row where mode = 'Partial'.
--
-- Affected APIs/UI (companion code changes shipped in same PR):
--   frontend/src/constants/docks.js                       — LOAD_DURATION_BY_MODE.Partial → Parcel
--   frontend/src/components/orders/NewOrderModal.jsx      — dropdown option Partial → Parcel
--   frontend/src/components/orders/OrderDetailModal.jsx   — dropdown option Partial → Parcel
--   frontend/src/components/bulk-plan/OrderEditModal.jsx  — dropdown option/label Partial → Parcel
--   mobile/src/components/bulkplan/OrderEditModal.tsx     — MODE_OPTIONS Partial → Parcel
--   frontend/src/services/dockLoadingDurationsService.js  — JSDoc mode list updated
--   api/migrations/012_create_dock_loading_durations.sql  — historical comment
--                                                            describing the seed list
--                                                            is not amended (forward-only).
--
-- Backfill:
--   This migration *is* the backfill — it rewrites every existing row that
--   carries mode='Partial' so in-flight shipments/orders continue to match
--   the dock_loading_durations lookup row after the rename.
--
-- Index changes: none.
--
-- Constraint changes: none. The existing CHECK (mode <> '') still holds.
--
-- Rollback SQL:
--   BEGIN;
--     UPDATE dock_loading_durations SET mode = 'Partial', label = 'Partial' WHERE mode = 'Parcel';
--     UPDATE shipments      SET mode = 'Partial' WHERE mode = 'Parcel';
--     UPDATE orders         SET mode = 'Partial' WHERE mode = 'Parcel';
--     UPDATE oms_orders     SET mode = 'Partial' WHERE mode = 'Parcel';   -- if column exists
--     UPDATE documents      SET mode = 'Partial' WHERE mode = 'Parcel';
--     UPDATE route_templates SET mode = 'Partial' WHERE mode = 'Parcel';
--   COMMIT;
--   (Frontend/mobile rollback requires reverting the constants/dropdown
--   commits — the UI no longer offers 'Partial' as a selectable option.)
--
-- Risks:
--   Medium. This rewrites live data on shipments/orders. Mitigations:
--     * Wrapped in a single transaction so partial application is impossible.
--     * Each table updated only where mode = 'Partial' — TL/LTL/Air are
--       untouched.
--     * dock_loading_durations PK is updated *before* shipments/orders so
--       no in-flight planning lookup ever sees a missing key (the lookup
--       is read at request time, not held open across this migration).
--     * Tables that may not exist in every environment (oms_orders) are
--       guarded with information_schema checks.

BEGIN;

-- 1. Rename the PK row in the lookup table first so any planning lookup
--    that fires after this statement immediately sees the new key.
UPDATE dock_loading_durations
   SET mode  = 'Parcel',
       label = 'Parcel',
       updated_at = NOW()
 WHERE mode = 'Partial';

-- 2. Rewrite mode='Partial' on every operational table that carries it.
--    Each UPDATE is guarded so the migration is safe in environments where
--    a table or column may not exist (e.g. fresh installs without OMS).

DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'shipments',
    'orders',
    'oms_orders',
    'documents',
    'route_templates'
  ] LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = v_table
         AND column_name  = 'mode'
    ) THEN
      EXECUTE format(
        'UPDATE public.%I SET mode = ''Parcel'' WHERE mode = ''Partial''',
        v_table
      );
    END IF;
  END LOOP;
END $$;

-- 3. Refresh the column comment on dock_loading_durations so future readers
--    see the current mode set.
COMMENT ON COLUMN dock_loading_durations.mode IS
  'Shipment mode key — matches the `mode` column on shipments/orders (TL, LTL, Parcel, Air).';

COMMIT;
