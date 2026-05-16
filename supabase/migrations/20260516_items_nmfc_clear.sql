-- ════════════════════════════════════════════════════════════════════
-- 20260516_items_nmfc_clear.sql
--
-- Clear public.items.nmfc on every row and set the column default to
-- '' (empty string). Requested by the user on 2026-05-16 after noticing
-- placeholder/junk NMFC codes (e.g. 123456 on ITM-1001) in seed data.
--
-- Convention: matches the existing items.un / items.haz_class pattern
-- of "text DEFAULT ''" rather than NULL. The Item Master form
-- (itemMasterPayload.js → buildItemRow) always sends a string for this
-- field, so '' is the natural empty value rather than NULL.
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : ALTER COLUMN items.nmfc SET DEFAULT ''
--   2. Migration files     : THIS FILE.
--   3. Backfill            : UPDATE items SET nmfc = ''
--                            WHERE nmfc IS DISTINCT FROM ''.
--                            Affects 11 rows at the time of writing.
--   4. Index changes       : NONE. nmfc is not indexed.
--   5. Constraint changes  : NONE.
--   6. Rollback            : Forward-only. To undo:
--                              ALTER TABLE public.items
--                                ALTER COLUMN nmfc DROP DEFAULT;
--                            Prior per-row nmfc values are NOT
--                            recoverable from this migration alone;
--                            use Supabase PITR for a true restore.
--   7. Affected UI / API   :
--        - Item Master UI: NMFC CODE field will render empty until a
--          user types a value.
--        - OMS↔TMS middleware syncs items.nmfc → oms_inventory.nmfc on
--          next pull; OMS rows will pick up '' through normal sync,
--          not via this migration.
--   8. Risks / assumptions :
--        - REQ-02 audit pipeline is bypassed (raw DDL/DML doesn't
--          generate change_history rows). Confirmed acceptable.
--        - Idempotent: the WHERE clause makes re-runs a no-op once all
--          rows are ''.
--        - Some pre-existing values (159880, 188570, 177890, 177900)
--          looked plausibly like real NMFC codes rather than obvious
--          placeholders. User confirmed clearing them all.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.items
  ALTER COLUMN nmfc SET DEFAULT '';

UPDATE public.items
   SET nmfc = ''
 WHERE nmfc IS DISTINCT FROM '';

COMMENT ON COLUMN public.items.nmfc
  IS 'NMFC item code (e.g. ''70150''). Empty string when unknown. Cleared on 20260516.';

COMMIT;
