-- Migration: 004_add_dock_issue_to_shipments
-- Date: 2026-04-08
-- Author: Claude (AI-assisted)
-- Description: Add dock_issue column to shipments table.
--              When dock capacity is exceeded during planning, the planner flags
--              the shipment with a dock_issue message instead of assigning an
--              out-of-range dock slot.
--
-- Schema Change:
--   Table: shipments (ALTER)
--   Column: dock_issue TEXT (nullable) — human-readable dock capacity issue message
--
-- Rollback:
--   ALTER TABLE shipments DROP COLUMN IF EXISTS dock_issue;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dock_issue TEXT;

COMMENT ON COLUMN shipments.dock_issue IS 'Dock capacity issue message. Set when planner cannot assign a dock slot within warehouse operating hours.';
