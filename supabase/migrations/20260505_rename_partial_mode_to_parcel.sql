-- Migration: 20260505_rename_partial_mode_to_parcel
-- Date:      2026-05-05
-- Author:    Claude (AI-assisted)
-- Description:
--   Rename shipment mode value 'Partial' → 'Parcel' in the live Supabase
--   database. This is the supabase-side counterpart of the legacy
--   api/migrations/028_rename_partial_mode_to_parcel.sql, which was
--   authored on 2026-04-25 but never applied to the Supabase project
--   (it only ran against the local API DB). As a result the Planning
--   Parameters → Dock Loading Durations table still rendered "PARTIAL"
--   in production-shaped environments.
--
--   The 'Partial' mode was confusing because it overlapped with the
--   weight-derived load-type label 'Partial TL' (Full TL ≥ 35k lbs,
--   Partial TL ≥ LTL_MAX). Operations standardised on 'Parcel' as the
--   fourth shipment mode alongside TL / LTL / Air. Load-type labels in
--   api/server.js#2937, frontend/src/pages/OrdersPage.jsx#1263, and
--   mobile/src/shared/utils/laneUtils.js#90 are intentionally left
--   alone — they describe truck utilisation, not the shipment mode.
--
-- Pre-flight check (executed against ljbeihotrmyqthxptcgp on 2026-05-05):
--   dock_loading_durations: 1 row with mode='Partial' (the lookup row).
--   shipments.mode:         0 rows.
--   documents.mode:         0 rows.
--   route_templates.mode:   0 rows.
--   orders.ship_mode:       0 rows.
--   orders.transport_mode:  0 rows.
--   oms_orders.ship_mode:   0 rows.
--   oms_orders has no `mode` column on this DB.
--
--   Operational UPDATEs are still issued below as forward-only safety,
--   so the migration converges if a stale environment ever ingests a
--   'Partial' row between authoring and apply.
--
-- Affected tables:
--   dock_loading_durations  — PK row 'Partial' becomes 'Parcel' (and label).
--   shipments               — UPDATE mode 'Partial' → 'Parcel' if column exists.
--   documents               — UPDATE mode 'Partial' → 'Parcel' if column exists.
--   route_templates         — UPDATE mode 'Partial' → 'Parcel' if column exists.
--   orders                  — UPDATE ship_mode / transport_mode 'Partial' → 'Parcel' if columns exist.
--   oms_orders              — UPDATE ship_mode 'Partial' → 'Parcel' if column exists.
--
-- Affected APIs/UI (companion code change shipped in this PR):
--   frontend/src/components/orders/NewOrderModal.jsx — Mode dropdown 'Partial' → 'Parcel'.
--   (All other UI surfaces — DockDurationsSection.jsx, OrderDetailModal.jsx,
--    bulk-plan/OrderEditModal.jsx, mobile bulkplan/OrderEditModal.tsx,
--    frontend/src/constants/docks.js, dockLoadingDurationsService — were
--    already updated in the original 028 PR.)
--
-- Backfill:
--   This migration is the backfill — it rewrites every row that still
--   carries the legacy 'Partial' value so in-flight planning lookups
--   continue to resolve against the renamed dock_loading_durations
--   row immediately after commit.
--
-- Index changes:    none.
-- Constraint changes: none. Existing CHECK (mode <> '') still holds.
--
-- Rollback SQL:
--   BEGIN;
--     UPDATE dock_loading_durations
--        SET mode = 'Partial', label = 'Partial', updated_at = NOW()
--      WHERE mode = 'Parcel';
--     UPDATE shipments       SET mode      = 'Partial' WHERE mode      = 'Parcel';
--     UPDATE documents       SET mode      = 'Partial' WHERE mode      = 'Parcel';
--     UPDATE route_templates SET mode      = 'Partial' WHERE mode      = 'Parcel';
--     UPDATE orders          SET ship_mode = 'Partial' WHERE ship_mode = 'Parcel';
--     UPDATE orders          SET transport_mode = 'Partial' WHERE transport_mode = 'Parcel';
--     UPDATE oms_orders      SET ship_mode = 'Partial' WHERE ship_mode = 'Parcel';
--   COMMIT;
--   (Frontend rollback also requires reverting NewOrderModal.jsx so
--   'Partial' reappears as a selectable Mode option.)
--
-- Risks:
--   Low. Pre-flight confirmed zero operational rows carry 'Partial', so
--   only the single dock_loading_durations PK row actually changes.
--   Mitigations:
--     * Wrapped in a single transaction so partial application is impossible.
--     * Each operational UPDATE is guarded by an information_schema check
--       so the migration is safe in environments where a column may
--       not exist (e.g. fresh installs without OMS, older snapshots).
--     * dock_loading_durations PK is renamed BEFORE operational tables so
--       no in-flight planning lookup ever sees a missing key (the lookup
--       is read at request time, not held open across this migration).
--     * Re-running this migration on a converged DB is a no-op
--       (every UPDATE is `WHERE mode = 'Partial'`).

BEGIN;

-- 1. Rename the PK row in the lookup table first so any planning lookup
--    that fires after this statement immediately sees the new key.
UPDATE dock_loading_durations
   SET mode       = 'Parcel',
       label      = 'Parcel',
       updated_at = NOW()
 WHERE mode = 'Partial';

-- 2. Rewrite mode='Partial' on every operational table that carries a
--    `mode` column. Each UPDATE is guarded so the migration is safe in
--    environments where a table may not exist (fresh installs, etc.).
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'shipments',
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

-- 3. orders / oms_orders use ship_mode (and orders also has transport_mode).
DO $$
DECLARE
  v_pair RECORD;
BEGIN
  FOR v_pair IN
    SELECT * FROM (VALUES
      ('orders'::text,      'ship_mode'::text),
      ('orders',            'transport_mode'),
      ('oms_orders',        'ship_mode')
    ) AS t(tbl, col)
  LOOP
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = v_pair.tbl
         AND column_name  = v_pair.col
    ) THEN
      EXECUTE format(
        'UPDATE public.%I SET %I = ''Parcel'' WHERE %I = ''Partial''',
        v_pair.tbl, v_pair.col, v_pair.col
      );
    END IF;
  END LOOP;
END $$;

-- 4. Refresh the column comment on dock_loading_durations so future
--    readers see the current canonical mode set.
COMMENT ON COLUMN dock_loading_durations.mode IS
  'Shipment mode key — matches the `mode` / `ship_mode` column on shipments/orders (TL, LTL, Parcel, Air).';

COMMIT;
