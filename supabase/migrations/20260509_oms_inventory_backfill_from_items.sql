-- ════════════════════════════════════════════════════════════════════
-- 20260509_oms_inventory_backfill_from_items.sql
--
-- Backfill oms_inventory for every TMS items row that does not yet have
-- a matching oms_inventory row. New rows are seeded with qty_on_hand =
-- 1000 (per user request 2026-05-09) plus matching defaults so the OMS
-- Inventory page (frontend/zoree-oms.html ▸ pg-inventory) renders them
-- as "OK" stock (not Low / Out).
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : NONE (data-only migration).
--   2. Migration files     : THIS FILE.
--   3. Backfill            : INSERT … SELECT … WHERE NOT EXISTS — only
--                            items missing in oms_inventory are added.
--                            Existing 10 rows (ITM-1001 .. ITM-1010)
--                            are NOT touched — they carry real qty +
--                            reservations that must be preserved.
--   4. Index changes       : NONE.
--   5. Constraint changes  : NONE. All NOT NULL columns satisfied via
--                            COALESCE / hard-coded defaults below.
--   6. Rollback            : Forward-only per repo convention. To undo:
--                            DELETE FROM public.oms_inventory
--                            WHERE qty_on_hand = 1000
--                              AND qty_reserved = 0
--                              AND reorder_point = 100
--                              AND max_qty = 2000
--                              AND created_at >= '2026-05-09';
--                            (The four-field signature uniquely tags
--                             rows created by this backfill.)
--   7. Affected UI / API   : OMS Inventory page (zoree-oms.html: ri()
--                            renderer + loadFromDB().oms_inventory)
--                            will show one additional card on next
--                            page load. No frontend code change needed
--                            — the read is `select * where active`.
--   8. Risks / assumptions :
--        - items.id is the natural key shared with oms_inventory.id
--          (confirmed via mergeTMSItems matching on i.id === t.id).
--        - items.customer is a free-text customer NAME, not an
--          oms_customers.id, so customer_id is left NULL on inserted
--          rows to avoid creating a dangling FK-shaped reference.
--        - items.class values ('Electronics' / 'Industrial' / 'Hazmat'
--          / NULL) are accepted by the OMS UI; unknown values render
--          without a category color but are otherwise harmless.
--        - Idempotent: the NOT EXISTS guard makes re-running a no-op.
-- ════════════════════════════════════════════════════════════════════

INSERT INTO public.oms_inventory (
  id,
  description,
  customer_id,
  category,
  freight_class,
  nmfc,
  unit_weight,
  unit_value,
  qty_on_hand,
  qty_reserved,
  reorder_point,
  max_qty,
  bin_location,
  hazmat,
  fragile,
  temp_controlled,
  active,
  created_at,
  updated_at
)
SELECT
  i.id,
  i.description,
  NULL,                                              -- customer_id (see assumption #2)
  COALESCE(NULLIF(TRIM(i.class), ''), 'General'),    -- category
  i.freight_class,
  i.nmfc,
  COALESCE(i.weight_unit, 0),                        -- unit_weight
  COALESCE(i.value_unit, 0),                         -- unit_value
  1000,                                              -- qty_on_hand (user-specified)
  0,                                                 -- qty_reserved
  100,                                               -- reorder_point (10% of qty)
  2000,                                              -- max_qty (so OMS bar shows ~50%)
  i.warehouse_loc,                                   -- bin_location
  COALESCE(i.hazmat, false),
  COALESCE(i.fragile, false),
  COALESCE(i.temp_ctrl, false),                      -- temp_controlled (note: column rename items→oms)
  true,                                              -- active
  now(),
  now()
FROM public.items i
WHERE NOT EXISTS (
  SELECT 1 FROM public.oms_inventory oi WHERE oi.id = i.id
);
