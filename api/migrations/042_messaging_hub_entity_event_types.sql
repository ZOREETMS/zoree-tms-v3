-- ============================================================
-- Migration: Messaging Hub — entity-sync + carrier-event message types
--
-- Purpose: Extend the Messaging Hub so that entity-master syncs (items,
-- locations) and operational carrier events (pickup / in-transit /
-- exception, etc.) are captured as first-class hub messages, alongside
-- the existing 6-hop OMS↔TMS↔Carrier lifecycle.
--
-- These three codes are referenced by message_log.message_type (FK →
-- message_type_lookup, ON DELETE RESTRICT), so the lookup rows MUST
-- exist before any writer.recordInbound/recordOutbound call can persist
-- a row of these types. Adding a code is an INSERT (not an ALTER TYPE)
-- by design — see migration 038 §1.
--
--   ITEM_SYNC     — OMS/ERP → TMS item (SKU) master sync
--   LOCATION_SYNC — OMS/ERP → TMS location master sync
--   CARRIER_EVENT — Carrier → TMS operational milestone
--                   (Picked Up / In Transit / Arrived / Exception / …)
--
-- Date: 2026-05-20
-- Owner: TMS Platform
-- Related: docs/messaging-hub/plan.md, migration 038_messaging_hub.sql
--
-- Design notes:
--   - Additive and idempotent (ON CONFLICT DO NOTHING) per
--     docs/zoree_db_rules.pdf §Migration 1 (forward-only, re-runnable).
--   - No schema change — seed-only into an existing lookup table, so no
--     index/constraint churn and no rollback risk to message_log.
--   - 'edge' classifies the message lane the same way migration 038 did:
--     OMS_TMS for master-data syncs, TMS_CARRIER for carrier events.
--
-- Rollback (lower envs only — DB rules forbid auto-rollback in prod;
-- operational pause is the MESSAGING_HUB_PERSIST=false feature flag):
--   DELETE FROM message_type_lookup
--     WHERE code IN ('ITEM_SYNC','LOCATION_SYNC','CARRIER_EVENT');
--   -- (will fail if message_log rows already reference them — expected,
--   --  matching the ON DELETE RESTRICT contract.)
-- ============================================================

INSERT INTO message_type_lookup (code, label, edge, description) VALUES
  ('ITEM_SYNC',     'Item Sync',     'OMS_TMS',     'OMS/ERP → TMS item (SKU) master sync'),
  ('LOCATION_SYNC', 'Location Sync', 'OMS_TMS',     'OMS/ERP → TMS location master sync'),
  ('CARRIER_EVENT', 'Carrier Event', 'TMS_CARRIER', 'Carrier → TMS operational milestone (pickup, in-transit, arrival, exception, etc.)')
ON CONFLICT (code) DO NOTHING;
