-- Migration: 026_backfill_order_status_from_shipment
-- Date: 2026-04-22
-- Author: Claude (AI-assisted)
-- Target DB: Supabase project hosting `orders` and `shipments`.
--
-- Description:
--   One-off data correction (NOT a schema change). Until today, two
--   code paths could move a shipment to 'In Transit' / 'Delivered'
--   without propagating the status onto linked orders:
--
--     1. PATCH /api/shipments/:id          (generic row patch)
--     2. PATCH /api/shipments/:id/status   (quick status update)
--
--   Only the timeline-event path (api/services/shipmentEvents.js) and
--   the OMS ship-confirm path (api/services/shipConfirm.js) propagated.
--   As a result, orders such as ORD-841629 stayed at 'Tender Accepted'
--   even though their shipment was already 'In Transit'.
--
--   Forward fix lands in the same commit:
--     - api/services/shipmentEvents.js  — exports
--       syncLinkedOrdersForShipmentStatus() as the single source of
--       truth for shipment-status → order-status.
--     - api/services/shipments.js       — updateShipment() now calls
--       the helper on every status transition.
--
--   This migration reconciles rows that are already out of sync.
--
-- Schema changes:     None. Data-only migration.
-- Index changes:      None.
-- Constraint changes: None (relies on 014 + 017 whitelist — both
--                     'In Transit' and 'Shipped' are already allowed;
--                     we normalize on 'In Transit' to match the
--                     shipmentEvents.js SHIPMENT_STATUS_TO_ORDER_STATUS
--                     map — the single source of truth).
--
-- Backfill rules (mirror the runtime helper exactly):
--   - Only touch orders whose `shipment_id` points at a shipment whose
--     status is in {'In Transit','Delivered'}.
--   - Only touch orders that are NOT in a terminal state
--     ('Delivered','Cancelled'). Terminal states never regress.
--   - Idempotent: WHERE clause filters out orders already aligned.
--
-- Rollback considerations:
--   Forward-only data correction. To capture the affected set for a
--   potential targeted revert, run the SELECT in the commented block
--   below BEFORE executing the UPDATEs in production:
--
--     -- SELECT o.id AS order_id, o.status AS old_status, s.status AS ship_status
--     --   FROM orders o JOIN shipments s ON s.id = o.shipment_id
--     --  WHERE s.status IN ('In Transit','Delivered')
--     --    AND o.status NOT IN ('Delivered','Cancelled')
--     --    AND o.status IS DISTINCT FROM (
--     --      CASE s.status WHEN 'In Transit' THEN 'In Transit'
--     --                    WHEN 'Delivered'  THEN 'Delivered' END);
--
-- Affected APIs/services/UI:
--   api/services/shipments.js            — forward fix (updateShipment)
--   api/services/shipmentEvents.js       — shared sync helper
--   api/routes/shipments.js              — threads user/via context
--   frontend/src/pages/OrdersPage.jsx    — reflects corrected status
--   frontend/src/pages/ShipmentsPage.jsx — reflects corrected status
--
-- Risks / assumptions:
--   - Assumes shipments.order_ids is reflected on orders.shipment_id
--     (both are maintained by the planner/consolidation flow).
--   - Writes an audit row per updated order via change_history so the
--     correction is traceable (matches the runtime helper).
--   - Low risk: only the `status` column changes, never regresses a
--     terminal state.

BEGIN;

-- 1. Write audit rows so the correction is visible in the history drawer.
--    Uses the real change_history schema (migration 006): old_value /
--    new_value / username (NOT NULL). 'system' is the conventional
--    username for data-migration writes.
INSERT INTO change_history (
  entity_type, entity_id, action, field, old_value, new_value,
  username, user_id, user_role, metadata, created_at
)
SELECT
  'order',
  o.id,
  'status',
  'status',
  o.status,
  CASE s.status
    WHEN 'In Transit' THEN 'In Transit'
    WHEN 'Delivered'  THEN 'Delivered'
  END,
  'system',                 -- username (NOT NULL)
  NULL,                     -- user_id
  'migration',              -- user_role
  jsonb_build_object(
    'via', 'migration-026-backfill',
    'shipmentId', s.id,
    'shipmentStatus', s.status
  ),
  NOW()
FROM orders o
JOIN shipments s ON s.id = o.shipment_id
WHERE s.status IN ('In Transit', 'Delivered')
  AND o.status NOT IN ('Delivered', 'Cancelled')
  AND o.status IS DISTINCT FROM (
    CASE s.status
      WHEN 'In Transit' THEN 'In Transit'
      WHEN 'Delivered'  THEN 'Delivered'
    END
  );

-- 2. Apply the correction.
UPDATE orders o
   SET status = CASE s.status
                  WHEN 'In Transit' THEN 'In Transit'
                  WHEN 'Delivered'  THEN 'Delivered'
                END,
       updated_at = NOW()
  FROM shipments s
 WHERE s.id = o.shipment_id
   AND s.status IN ('In Transit', 'Delivered')
   AND o.status NOT IN ('Delivered', 'Cancelled')
   AND o.status IS DISTINCT FROM (
     CASE s.status
       WHEN 'In Transit' THEN 'In Transit'
       WHEN 'Delivered'  THEN 'Delivered'
     END
   );

COMMIT;
