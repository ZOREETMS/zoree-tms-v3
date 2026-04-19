-- Migration: 016_change_history_add_invoice_action
-- Date: 2026-04-19
-- Author: Claude (AI-assisted)
-- Description: REQ-20 — broaden `change_history.action` to include 'invoice'
--              so shipment history rows for invoice approve/reject can be
--              written alongside the existing order/shipment lifecycle
--              events. Parallel to migration 009 (entity_type whitelist).
--
-- Affected APIs/UI:
--   api/services/invoiceAudit.js          — writes 'invoice' per-shipment row
--   frontend/src/pages/ShipmentsPage.jsx  — REQ-20 Shipment Change History UI
--                                           renders it with the 🧾 icon
--
-- Backfill: none.
-- Index changes: none.
--
-- Rollback SQL:
--   ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_action_check;
--   ALTER TABLE change_history
--     ADD CONSTRAINT change_history_action_check
--     CHECK (action IN ('create','edit','delete','plan','unassign','tender','untender','status'));
--
-- Risks: low — strictly additive whitelist expansion.

ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_action_check;

ALTER TABLE change_history
  ADD CONSTRAINT change_history_action_check
  CHECK (action IN (
    'create',
    'edit',
    'delete',
    'plan',
    'unassign',
    'tender',
    'untender',
    'status',
    'invoice'     -- REQ-20
  ));
