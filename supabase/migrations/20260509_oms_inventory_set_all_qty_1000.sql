-- ════════════════════════════════════════════════════════════════════
-- 20260509_oms_inventory_set_all_qty_1000.sql
--
-- Set qty_on_hand=1000 and qty_reserved=0 on every oms_inventory row
-- so that "available" (qty_on_hand - qty_reserved) is 1000 for every
-- item. Per user request 2026-05-09: "I need all items to have 1000
-- qty in oms."
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : NONE (data-only migration).
--   2. Migration files     : THIS FILE.
--   3. Backfill            : UPDATE all rows in public.oms_inventory.
--   4. Index changes       : NONE.
--   5. Constraint changes  : NONE.
--   6. Rollback            : NOT REVERSIBLE without a backup. Prior
--                            qty_on_hand / qty_reserved values are
--                            destroyed by this UPDATE. A snapshot of
--                            the pre-migration state is recorded in
--                            the inline comment block at the bottom of
--                            this file for manual restore if needed.
--   7. Affected UI / API   : OMS Inventory page + New Sales Order
--                            modal — every item now shows 1000
--                            on-hand / 1000 available. Any in-flight
--                            order whose reservation was tracked by
--                            qty_reserved here loses that bookkeeping
--                            (the orders themselves are untouched —
--                            only the aggregate counter is reset).
--   8. Risks / assumptions :
--        - User explicitly chose this destructive path after being
--          shown the existing reservation values.
--        - Reservation re-derivation (if needed) would have to come
--          from the oms_orders / oms_order_lines tables, not from the
--          counter we are wiping.
-- ════════════════════════════════════════════════════════════════════

UPDATE public.oms_inventory
SET qty_on_hand  = 1000,
    qty_reserved = 0,
    updated_at   = now();

-- Pre-migration snapshot (for manual rollback reference only):
--   ITM-1001       qty_on_hand=5000 qty_reserved=2410
--   ITM-1001-COPY  qty_on_hand=1000 qty_reserved=0
--   ITM-1002       qty_on_hand=700  qty_reserved=700
--   ITM-1003       qty_on_hand=4497 qty_reserved=2196
--   ITM-1004       qty_on_hand=420  qty_reserved=420
--   ITM-1005       qty_on_hand=700  qty_reserved=700
--   ITM-1006       qty_on_hand=1895 qty_reserved=1895
--   ITM-1007       qty_on_hand=1354 qty_reserved=1354
--   ITM-1008       qty_on_hand=3111 qty_reserved=3111
--   ITM-1009       qty_on_hand=4189 qty_reserved=4189
--   ITM-1010       qty_on_hand=3500 qty_reserved=500
