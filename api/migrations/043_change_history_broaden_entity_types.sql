-- Migration: 043_change_history_broaden_entity_types
-- Date: 2026-05-10
-- Author: Claude (AI-assisted)
-- Description: REQ-02 (Phase-4 follow-up). Broaden the change_history
--              entity_type whitelist so the generic /api/db/:table writers
--              can audit non-shipment master data: lane_preferences,
--              locations, drivers, vehicles, equipment_types,
--              dock_appointments, documents, planning_parameters.
--
--              Rationale (from web↔mobile parity audit, 2026-05-09):
--              the generic /api/db/:table POST/PATCH/DELETE handlers in
--              api/server.js previously special-cased only shipments
--              (recordRawPatchAudit). Every other allowed table — used
--              by both the React TMS web app AND the React Native
--              mobile app via DbApi.upsert — bypassed change_history
--              entirely. This is a shared issue, not a mobile
--              regression: closing it on the server fixes both
--              clients in one shot.
--
-- Affected APIs/UI:
--   api/services/changeHistory.js       — ALLOWED_ENTITIES expanded in lockstep
--   api/services/genericTableAudit.js   — NEW: maps table → entity, fires audit
--   api/server.js                       — POST/PATCH/DELETE /api/db/:table
--                                         delegate to genericTableAudit (no
--                                         business logic added inline; per
--                                         CLAUDE_RULES §6 + §9)
--   api/__tests__/genericTableAudit.test.js — NEW unit tests
--
--   No UI surface changes here. The web History tab is order/shipment
--   only; surfacing master-data history in the UI is a follow-up.
--
-- Backfill:
--   None. Audit starts now. Existing master-data rows have no historical
--   diffs to reconstruct from prior state — accepted by design, mirrors
--   how migration 006 introduced change_history originally.
--
-- Index changes:
--   None. The existing (entity_type, entity_id, created_at DESC) index
--   already supports point-lookups for the new entity types.
--
-- Constraint changes:
--   ~ change_history_entity_type_check broadened from
--       ('order','shipment','rate','carrier','invoice')
--     to
--       ('order','shipment','rate','carrier','invoice',
--        'lane_preference','location','driver','vehicle',
--        'equipment','dock_appointment','document','planning_param')
--
-- Rollback SQL:
--   ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_entity_type_check;
--   ALTER TABLE change_history
--     ADD CONSTRAINT change_history_entity_type_check
--     CHECK (entity_type IN ('order','shipment','rate','carrier','invoice'));
--   -- Note: rolling back leaves rows for the new entity types in place;
--   -- they will fail subsequent inserts but existing rows are not removed.
--   -- Run this only if you also accept that the new audit rows stay in
--   -- the table as historical records.
--
-- Risks:
--   Low. The change is additive at the constraint level. Existing
--   audit-write call sites are untouched — they use the old entity
--   types ('order','shipment','rate','carrier','invoice') and continue
--   to validate against the broader whitelist. No data is deleted or
--   moved.

ALTER TABLE change_history DROP CONSTRAINT IF EXISTS change_history_entity_type_check;

ALTER TABLE change_history
  ADD CONSTRAINT change_history_entity_type_check
  CHECK (entity_type IN (
    'order','shipment','rate','carrier','invoice',
    'lane_preference','location','driver','vehicle',
    'equipment','dock_appointment','document','planning_param'
  ));

COMMENT ON CONSTRAINT change_history_entity_type_check ON change_history IS
  'REQ-02 audit-trail entity whitelist. Broadened by migration 043 to cover master-data tables written via the generic /api/db/:table routes (Phase-4 audit-coverage fix from web↔mobile parity audit, 2026-05-10).';
