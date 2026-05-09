-- ════════════════════════════════════════════════════════════════════
-- 20260509_oms_inventory_set_all_qty_10000.sql
--
-- Set qty_on_hand=10000 and qty_reserved=0 on every oms_inventory row.
-- Per user request 2026-05-09: bump from 1000 to 10000 so every item
-- shows 10000 available in the OMS Inventory page and New Sales Order
-- modal. Also bumps max_qty to 10000 so the OMS progress bar renders
-- 100% (instead of overflow-capped) for the new on-hand level.
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : NONE (data-only migration).
--   2. Migration files     : THIS FILE.
--   3. Backfill            : UPDATE all rows in public.oms_inventory.
--   4. Index changes       : NONE.
--   5. Constraint changes  : NONE.
--   6. Rollback            : Forward-only. To revert to the prior
--                            state (qty_on_hand=1000, qty_reserved=0)
--                            run:
--                              UPDATE public.oms_inventory
--                              SET qty_on_hand=1000, max_qty=2000,
--                                  updated_at=now();
--   7. Affected UI / API   : OMS Inventory cards now show 10000 on
--                            hand / 10000 available. New Sales Order
--                            modal AVAILABLE column renders 10000 for
--                            every item. Status badges remain "OK".
--   8. Risks / assumptions :
--        - Pre-state is qty_on_hand=1000, qty_reserved=0 across all
--          11 rows (set by 20260509_oms_inventory_set_all_qty_1000).
--        - Reservation counter remains at 0 — re-deriving from
--          oms_orders is out of scope for this migration.
-- ════════════════════════════════════════════════════════════════════

UPDATE public.oms_inventory
SET qty_on_hand  = 10000,
    qty_reserved = 0,
    max_qty      = 10000,
    updated_at   = now();
