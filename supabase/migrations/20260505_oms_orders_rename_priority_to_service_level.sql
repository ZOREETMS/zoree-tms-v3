-- ════════════════════════════════════════════════════════════════════
-- Migration: oms_orders.priority → oms_orders.service_level
-- Date:      2026-05-05
-- Bug:       #33 — "field name is not same OMS and TMS"
--
-- Problem
--   OMS used `oms_orders.priority` while TMS used `orders.service_level`
--   and `shipments.service_level`. A vestigial nullable
--   `oms_orders.service_level` column also existed but was rarely
--   written to; the OMS form wrote only to `priority`. The middleware
--   reflection step (frontend/zoree-middleware.html:1206) wrote to
--   `service_level` directly when copying TMS planning back, producing
--   5 rows of drift between the two columns. The dual-column situation
--   was the root of the QA report.
--
-- Fix
--   Make the OMS-side column name match the TMS side end-to-end:
--     1. Drop the duplicate `service_level` column (its 5 drifted
--        non-Standard values are out-of-band middleware writes; the
--        form-driven `priority` value is the source of truth).
--     2. Rename `priority` → `service_level`.
--     3. Rename the CHECK constraint to mirror the new column name.
--
--   This pairs with: Bug #1 fix
--   (20260505_oms_orders_priority_canonical_values.sql) which had
--   already widened the CHECK to the canonical TMS vocabulary, so the
--   constraint travels cleanly with the rename.
--
-- Code changes shipped alongside this migration (single deploy)
--   - frontend/services/omsSync/pushOrderService.js  (one read site)
--   - frontend/zoree-oms.html  (three sites: read, upsert, push)
--   The legacy `priority` field is kept as a defensive fallback in the
--   readers so any in-flight row written before the migration still
--   resolves correctly.
--
-- Forward-only: there is no down migration. Once code begins writing
-- to `service_level`, reverting would require copying values back to
-- `priority` and restoring the dropped duplicate column — the original
-- 5 drifted rows cannot be recovered. Any future change must build
-- forward from this state.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Drop the duplicate (and partially drifted) service_level column.
--    The form-driven `priority` is the source of truth; out-of-band
--    middleware writes to `service_level` are sacrificed (5 rows).
ALTER TABLE public.oms_orders
  DROP COLUMN IF EXISTS service_level;

-- 2. Rename priority → service_level. The CHECK constraint
--    automatically follows the column.
ALTER TABLE public.oms_orders
  RENAME COLUMN priority TO service_level;

-- 3. Rename the CHECK constraint so its name reflects the column.
ALTER TABLE public.oms_orders
  RENAME CONSTRAINT oms_orders_priority_check
                 TO oms_orders_service_level_check;

COMMIT;

-- Post-migration verification (run manually if needed):
--   SELECT column_name, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='oms_orders'
--      AND column_name IN ('priority','service_level');
--   -- Expect one row: service_level (no priority).
--
--   SELECT pg_get_constraintdef(c.oid)
--     FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--    WHERE t.relname = 'oms_orders'
--      AND c.conname = 'oms_orders_service_level_check';
