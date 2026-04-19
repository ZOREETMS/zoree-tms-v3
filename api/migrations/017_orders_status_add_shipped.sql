-- Migration: 017_orders_status_add_shipped
-- Date: 2026-04-19
-- Author: Claude (AI-assisted)
-- Description: REQ-23 — allow 'Shipped' on orders.status so the
--              OMS→TMS ship-confirm ingest can propagate warehouse
--              departure onto every order linked to the shipment.
--              Parallels migration 014 (Tender Accepted).
--
-- Affected APIs/UI:
--   api/routes/ingest.js (NEW POST /oms-ship-confirm) — writes status
--   api/services/shipConfirm.js (NEW)                 — orchestration
--   frontend/src/constants/orders.js                  — badge + row color
--   frontend/src/components/orders/OrderDetailModal.jsx — status option
--   frontend/zoree-oms.html                            — PUSH_SHIP_STATUS
--                                                       routed through
--                                                       MW TMS API
--
-- Backfill: none — existing orders keep their current status values.
-- Index changes: none.
--
-- Rollback SQL:
--   ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_orders_status_controlled;
--   ALTER TABLE orders
--     ADD CONSTRAINT chk_orders_status_controlled
--     CHECK (status IN ('Unplanned','Planned','Consolidated','Tendered',
--                       'Tender Accepted','In Transit','Delivered',
--                       'On Hold','Planning Failed','Cancelled'));
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
    'Tender Accepted',
    'Shipped',           -- REQ-23
    'In Transit',
    'Delivered',
    'On Hold',
    'Planning Failed',
    'Cancelled'
  ));
