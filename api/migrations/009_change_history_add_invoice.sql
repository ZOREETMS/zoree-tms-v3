-- Migration: 009_change_history_add_invoice
-- Date: 2026-04-17
-- Author: Claude (AI-assisted)
-- Description: Broaden the REQ-02 change_history entity whitelist to
--              include 'invoice' so REQ-06 invoice status transitions
--              can be audited through the same table.
--
-- Affected APIs/UI:
--   api/services/changeHistory.js — whitelist constant updated in lockstep
--   api/services/invoiceAudit.js  — writes 'create' + 'status' events
--
-- Backfill: none.
-- Index changes: none.
-- Rollback SQL:
--   ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_entity_type_check;
--   ALTER TABLE change_history
--     ADD CONSTRAINT change_history_entity_type_check
--     CHECK (entity_type IN ('order','shipment','rate','carrier'));
--
-- Risks: low — only broadens the whitelist.

ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_entity_type_check;

ALTER TABLE change_history
  ADD CONSTRAINT change_history_entity_type_check
  CHECK (entity_type IN ('order','shipment','rate','carrier','invoice'));
