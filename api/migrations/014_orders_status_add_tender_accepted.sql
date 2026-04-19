-- Migration: 014_orders_status_add_tender_accepted
-- Date: 2026-04-19
-- Author: Claude (AI-assisted)
-- Description: REQ-13 — allow 'Tender Accepted' on orders.status.
--              The existing constraint `chk_orders_status_controlled`
--              whitelists a fixed set of statuses and rejects new ones.
--              We drop and recreate it with 'Tender Accepted' included so
--              confirmOrdersForShipment() can mirror the shipment's
--              accepted-tender state on each linked order row.
--
-- Affected APIs/UI:
--   frontend/src/constants/orders.js                  — new badge + row color
--   frontend/src/components/orders/OrderDetailModal.jsx — status dropdown option
--   frontend/src/services/shipmentOrderService.js     — uses 'Tender Accepted'
--   frontend/src/pages/OrdersPage.jsx                  — REQ-12 hides tender btn
--                                                        when status ∈ {Tendered,
--                                                        Tender Accepted, ...}
--
-- Backfill: none. Existing rows already use the previous whitelist.
-- Index changes: none.
--
-- Rollback SQL:
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_status_controlled;
--   ALTER TABLE orders
--     ADD CONSTRAINT chk_orders_status_controlled
--     CHECK (status IN ('Unplanned','Planned','Consolidated','Tendered',
--                       'In Transit','Delivered','On Hold','Planning Failed',
--                       'Cancelled'));
--
-- Risks: low — strictly additive whitelist expansion.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_status_controlled;

ALTER TABLE orders
  ADD CONSTRAINT chk_orders_status_controlled
  CHECK (status IN (
    'Unplanned',
    'Planned',
    'Consolidated',
    'Tendered',
    'Tender Accepted',     -- REQ-13
    'In Transit',
    'Delivered',
    'On Hold',
    'Planning Failed',
    'Cancelled'
  ));
