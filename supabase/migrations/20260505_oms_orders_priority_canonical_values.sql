-- ════════════════════════════════════════════════════════════════════
-- Migration: oms_orders.priority — canonical service-level vocabulary
-- Date:      2026-05-05
-- Bugs:      #66 follow-up (priority CHECK never updated when the OMS
--            form switched from "Priority" labels to the canonical TMS
--            "Service Level" vocabulary).
--
-- Problem
--   The live `oms_orders_priority_check` constraint was defined out of
--   band on the database (no migration file existed in the repo) and
--   only allowed:
--       Standard | Expedite | Critical
--   Meanwhile the OMS form (frontend/zoree-oms.html) and the OMS→TMS
--   sync (frontend/services/omsSync/pushOrderService.js +
--   api/services/serviceLevelVocab.js) were updated to emit the
--   canonical TMS vocabulary:
--       Standard | Guaranteed | Expedited | Economy | White Glove |
--       Time-Critical
--   So creating any non-Standard order failed with:
--       new row for relation "oms_orders" violates check
--       constraint "oms_orders_priority_check"
--
-- Fix
--   1. Backfill existing legacy values to the canonical equivalent so
--      the new constraint accepts the table.
--   2. Drop the old CHECK and recreate it with the canonical 6-value
--      list — same vocabulary as serviceLevelVocab.js / NewOrderModal.
--
-- Forward-only: there is no down migration. Once new rows land using
-- canonical-only values (Guaranteed / Economy / White Glove /
-- Time-Critical), reverting to the old 3-value CHECK would reject
-- valid data. Any future change must be additive.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Drop the old, restrictive CHECK constraint FIRST.
--    Order matters: the backfill below rewrites legacy values to
--    canonical ones (e.g. 'Expedite' → 'Expedited'), and the OLD
--    constraint would reject 'Expedited' mid-transaction. We drop
--    before backfilling, then re-add the new constraint after the
--    data is clean.
ALTER TABLE public.oms_orders
  DROP CONSTRAINT IF EXISTS oms_orders_priority_check;

-- 2. Backfill legacy values to canonical equivalents.
--    'Expedite'  → 'Expedited'      (12 rows at time of migration)
--    'Critical'  → 'Time-Critical'  (0 rows expected, defensive)
--    These map 1:1 to the aliases already in
--    api/services/serviceLevelVocab.js (SVC_LEVEL_ALIASES), so the
--    rename is semantically lossless — both surfaces resolve to the
--    same canonical value at sync time.
UPDATE public.oms_orders
   SET priority = 'Expedited'
 WHERE priority = 'Expedite';

UPDATE public.oms_orders
   SET priority = 'Time-Critical'
 WHERE priority = 'Critical';

-- 3. Re-add the CHECK constraint with the canonical TMS vocabulary.
--    Mirrors the CANONICAL list in api/services/serviceLevelVocab.js
--    and the dropdown options in frontend/zoree-oms.html (#opri) and
--    frontend/src/components/orders/NewOrderModal.jsx.
ALTER TABLE public.oms_orders
  ADD CONSTRAINT oms_orders_priority_check
  CHECK (
    priority = ANY (ARRAY[
      'Standard'::text,
      'Guaranteed'::text,
      'Expedited'::text,
      'Economy'::text,
      'White Glove'::text,
      'Time-Critical'::text
    ])
  );

COMMIT;

-- Post-migration verification (run manually if needed):
--   SELECT priority, COUNT(*) FROM public.oms_orders GROUP BY priority;
--   SELECT pg_get_constraintdef(c.oid)
--     FROM pg_constraint c
--     JOIN pg_class t ON t.oid = c.conrelid
--    WHERE t.relname = 'oms_orders'
--      AND c.conname = 'oms_orders_priority_check';
