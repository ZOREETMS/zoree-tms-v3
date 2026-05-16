-- ════════════════════════════════════════════════════════════════════
-- 20260516_items_freight_class_set_77_5.sql
--
-- Set NMFC freight class to '77.5' for every row in public.items and
-- make '77.5' the column-level default for new inserts that omit the
-- field. Requested by the user on 2026-05-16.
--
-- Column context: public.items.freight_class is text, nullable, no
-- prior DB-level default. The frontend has historically defaulted
-- this field to '70' in several places (ItemMasterPage.jsx,
-- itemMasterPayload.js, laneUtils.js, ordersService.js, OrdersPage.jsx);
-- those fallbacks are intentionally NOT touched by this migration. New
-- items created through the UI will continue to send '70' (or whatever
-- the user picks) — the DB default only applies when freight_class is
-- omitted from the INSERT entirely, which today happens via direct
-- backend writes (e.g. middleware enrichment paths) rather than the
-- React form.
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : ALTER COLUMN items.freight_class SET DEFAULT '77.5'
--   2. Migration files     : THIS FILE.
--   3. Backfill            : UPDATE items SET freight_class = '77.5'
--                            WHERE freight_class IS DISTINCT FROM '77.5'.
--                            Affects 11 rows at the time of writing
--                            (7 distinct prior values).
--   4. Index changes       : NONE. freight_class is not indexed and
--                            no query patterns warrant one.
--   5. Constraint changes  : NONE. No CHECK constraint added — the
--                            Item Master form must remain free to set
--                            other valid NMFC classes (50, 55, 60, 65,
--                            70, 77.5, 85, 92.5, 100, …).
--   6. Rollback            : Forward-only per repo convention. To undo
--                            the default:
--                              ALTER TABLE public.items
--                                ALTER COLUMN freight_class DROP DEFAULT;
--                            Prior per-row freight_class values are
--                            NOT recoverable from this migration alone;
--                            use Supabase PITR if a true restore is
--                            needed.
--   7. Affected UI / API   :
--        - Item Master UI (ItemMasterPage.jsx) — read path will show
--          77.5 on existing rows; edit defaults still come from the JS
--          constant "70" until separately updated.
--        - OMS↔TMS middleware (zoree-middleware.html) syncs
--          items.freight_class → oms_inventory.freight_class on its
--          next pull; OMS rows will pick up '77.5' through normal sync,
--          not via this migration.
--        - RateManagementPage.jsx reads freight_class for display only.
--        - laneUtils / ordersService / OrdersPage hardcoded "70"
--          fallbacks are unchanged by design.
--   8. Risks / assumptions :
--        - REQ-02 audit pipeline (genericTableAudit) is bypassed:
--          a raw SQL UPDATE does NOT generate change_history rows.
--          Confirmed acceptable with the user for this backfill.
--        - Idempotent: the WHERE clause makes re-runs a no-op once all
--          rows are '77.5'.
--        - Row count is small (11), so no batching or transaction-size
--          concerns.
--        - The frontend's '70' fallback may produce drift on new
--          inserts coming from the React form; tracked as a separate
--          decision per the user's file-by-file delivery preference.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.items
  ALTER COLUMN freight_class SET DEFAULT '77.5';

UPDATE public.items
   SET freight_class = '77.5'
 WHERE freight_class IS DISTINCT FROM '77.5';

COMMENT ON COLUMN public.items.freight_class
  IS 'NMFC freight class (e.g. 50, 55, 60, 65, 70, 77.5, 85, …). Default 77.5 as of 20260516.';

COMMIT;
