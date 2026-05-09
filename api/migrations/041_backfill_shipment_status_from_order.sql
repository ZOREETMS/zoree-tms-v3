-- Migration: 041_backfill_shipment_status_from_order
-- Date: 2026-05-09
-- Author: Claude (AI-assisted) — QA bug #61
-- Target DB: Supabase project hosting `orders` and `shipments`.
--
-- Description:
--   One-off data correction (NOT a schema change). QA #61 reports a
--   tender-accept on the mobile app leaving the linked shipment behind:
--     "Status shows as Tender Accepted in Order but not updated in
--      Shipment."
--
--   A point-in-time snapshot of the DB on 2026-05-09 found ~43 distinct
--   shipments where a linked order is at 'Tender Accepted' but the
--   shipment is still 'Tendered' (42) or 'Planned' (1). All affected
--   orders share the same updated_at (2026-05-06 01:51:37.13305+00),
--   indicating a bulk write that bypassed the order-side cascade in
--   api/services/orderMutations.syncLinkedShipmentForOrderStatus
--   (the helper called from PATCH /api/orders/:id at server.js).
--
--   The forward fix is already in place in code:
--     - api/services/orderMutations.js  exports
--       syncLinkedShipmentForOrderStatus() — single source of truth
--       for order-status -> shipment-status (Tendered + Tender Accepted).
--     - api/server.js (PATCH /api/orders/:id) calls it on every status
--       change, so order-side tender-accepts written via the API will
--       not produce new drift.
--     - mobile/src/services/carrierPortalService.ts patches the
--       shipment FIRST, then orders, which exercises a parallel path
--       through PATCH /api/db/shipments/:id (recordRawPatchAudit).
--
--   This migration reconciles the rows that already drifted.
--
-- ──────────────────────────────────────────────────────────────────
-- Required output checklist (zoree_db_rules.pdf):
--
-- 1. Schema changes:     None. Data-only migration.
-- 2. Migration file(s):  This file (api/migrations/041).
-- 3. Backfill / data:    UPDATE shipments SET status='Tender Accepted'
--                        for affected rows. INSERT audit rows into
--                        change_history per shipment (one per shipment).
-- 4. Index changes:      None.
-- 5. Constraint changes: None — relies on migration 036
--                        (chk_shipments_status_controlled) which
--                        already whitelists 'Tender Accepted'.
-- 6. Rollback:           Forward-only data correction. Capture the
--                        affected set with the SELECT block below
--                        BEFORE running the UPDATE in production if a
--                        targeted revert may be required.
-- 7. Affected APIs/services/UI:
--                        - api/services/orderMutations.js (forward fix
--                          already present — no change here)
--                        - api/services/shipments.js (forward audit
--                          via recordRawPatchAudit)
--                        - frontend/src/pages/ShipmentsPage.jsx
--                          (renders corrected status)
--                        - mobile/src/state/useRealtimeData.ts
--                          (live-refresh once Realtime is configured —
--                          see mobile-bug #60)
-- 8. Risks / assumptions:
--                        - Assumes orders.shipment_id is the canonical
--                          linkage (matches the runtime cascade).
--                        - Mirrors the user's choice to include
--                          shipments.status='Planned' in scope (one
--                          row, SHP-2026-7441 at the time of writing).
--                        - Skips terminal statuses (Delivered /
--                          Cancelled / Tender Rejected) and any
--                          shipment that already advanced past
--                          Tender Accepted ('In Transit', 'Confirmed',
--                          'Exception') — those must not regress.
--                        - Idempotent: WHERE clause filters out
--                          shipments already at 'Tender Accepted', so
--                          re-running the migration is a no-op.
--                        - Audit row uses username='system' /
--                          user_role='migration' to match the
--                          convention from migration 026.
--
-- ──────────────────────────────────────────────────────────────────
-- Pre-flight SELECT (run BEFORE the UPDATE in production to capture
-- the affected set for a potential targeted revert):
--
--   SELECT s.id          AS shipment_id,
--          s.status      AS old_shipment_status,
--          o.id          AS sample_order_id,
--          o.status      AS order_status
--     FROM shipments s
--     JOIN orders o ON o.shipment_id = s.id
--    WHERE o.status = 'Tender Accepted'
--      AND s.status IN ('Planned', 'Tendered')
--    ORDER BY s.id;
-- ──────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Audit row per affected shipment so the correction is visible in
--    the History drawer. DISTINCT ON keeps it to one row per shipment
--    even when several linked orders satisfy the join.
INSERT INTO change_history (
  entity_type, entity_id, action, field, old_value, new_value,
  username, user_id, user_role, metadata, created_at
)
SELECT DISTINCT ON (s.id)
  'shipment',
  s.id,
  'status',
  'status',
  s.status,
  'Tender Accepted',
  'system',                  -- username (NOT NULL — see migration 006)
  NULL,                      -- user_id
  'migration',               -- user_role
  jsonb_build_object(
    'via',                  'migration-041-backfill',
    'triggerOrderStatus',   'Tender Accepted',
    'triggerOrderId',       o.id,
    'priorShipmentStatus',  s.status,
    'reason',               'order at Tender Accepted; shipment was ' || s.status
  ),
  NOW()
FROM shipments s
JOIN orders o ON o.shipment_id = s.id
WHERE o.status = 'Tender Accepted'
  AND s.status IN ('Planned', 'Tendered')
ORDER BY s.id, o.id;  -- deterministic pick of the audit-row order.id

-- 2. Apply the correction.
UPDATE shipments s
   SET status     = 'Tender Accepted',
       updated_at = NOW()
  FROM orders o
 WHERE o.shipment_id = s.id
   AND o.status      = 'Tender Accepted'
   AND s.status     IN ('Planned', 'Tendered');

COMMIT;

-- ──────────────────────────────────────────────────────────────────
-- Post-flight verification (expect zero rows after the migration):
--
--   SELECT s.id, s.status, o.id, o.status
--     FROM shipments s JOIN orders o ON o.shipment_id = s.id
--    WHERE o.status = 'Tender Accepted'
--      AND s.status IN ('Planned', 'Tendered');
-- ──────────────────────────────────────────────────────────────────
