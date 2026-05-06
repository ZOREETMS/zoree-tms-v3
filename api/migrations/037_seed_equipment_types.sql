-- ============================================================
-- Migration: 037_seed_equipment_types
-- Description:
--   Seed the equipment_types master table with the 12 canonical
--   trailer types previously living only as SEED_EQUIPMENT in
--   frontend/src/services/equipmentService.js. Until now the
--   Equipment Master page rendered those rows from the in-memory
--   seed (the fallback in getEquipmentList()) because the DB table
--   was empty, which made it look like the data was stored when it
--   actually wasn't.
--
--   This migration is the prerequisite for the planner's LTL/TL
--   ceiling lookup against equipment_types.max_weight (api/services/
--   equipmentLimits.js + frontend/src/services/
--   equipmentLimitsService.js). With the table empty, that lookup
--   throws and bulk-plan would 503 — so the data has to land first.
--
-- Date: 2026-05-05
--
-- Affected APIs:
--   - GET/POST/PATCH/DELETE /api/db/equipment_types (already wired,
--     just gets non-empty rows now)
--   - POST /api/bulk-plan/rate (LTL ceiling resolution succeeds
--     instead of 503'ing)
--   - POST /api/ltl/quote (no direct change — the gate is upstream
--     in /api/bulk-plan/rate)
--
-- Affected Services:
--   - api/services/equipmentLimits.js (getLtlMaxWeight / getTlMaxWeight)
--   - frontend/src/services/equipmentLimitsService.js (fetchEquipmentLimits / useEquipmentLimits)
--   - frontend/src/services/equipmentService.js (SEED_EQUIPMENT fallback
--     becomes a tests-only safety net — UI now reads real rows)
--
-- Affected UI:
--   - frontend/src/pages/EquipmentMasterPage.jsx (renders DB rows)
--   - frontend/src/pages/OrdersPage.jsx#openPlanModal (uses ltlMax)
--   - frontend/src/components/orders/PlanConfirmationModal.jsx
--     (equipment dropdown shows DB-sourced max weights)
--
-- Backfill:
--   12 rows inserted via ON CONFLICT (id) DO NOTHING. Idempotent —
--   running twice is a no-op. If a row already exists with the same
--   id, it is left alone (admins may have edited it via the UI).
--
-- Risks & Assumptions:
--   - Assumes equipment_types schema from migration 20260406_equipment_types
--     (id, name, code, max_weight, max_volume, length, width, height,
--      temp_controlled, hazmat_certified, status).
--   - Values mirror frontend SEED_EQUIPMENT exactly so the UI's pre-
--     migration appearance is preserved. LTL.max_weight = 20000 is the
--     value that unblocks ORD-844109 (16,800 lb COLLEGE PARK GA →
--     SAN JOSE CA) on the LTL/CzarLite branch.
--   - No FK references on equipment_types.id today; safe to insert.
--
-- Rollback:
--   DELETE FROM equipment_types
--    WHERE id IN ('EQ-001','EQ-002','EQ-003','EQ-004','EQ-005','EQ-006',
--                 'EQ-007','EQ-008','EQ-009','EQ-010','EQ-011','EQ-012');
-- ============================================================

INSERT INTO equipment_types (
  id, name, code, description,
  max_weight, max_volume, length, width, height,
  temp_controlled, hazmat_certified, status
) VALUES
  ('EQ-001','Dry Van 53ft','DV53','Standard 53ft dry van trailer',45000,3800,53,8.5,9,false,false,'Active'),
  ('EQ-002','Dry Van 48ft','DV48','Standard 48ft dry van trailer',44000,3400,48,8.5,9,false,false,'Active'),
  ('EQ-003','Reefer 53ft','RF53','53ft refrigerated trailer',43000,3600,53,8.5,9,true,false,'Active'),
  ('EQ-004','Reefer 48ft','RF48','48ft refrigerated trailer',42000,3200,48,8.5,9,true,false,'Active'),
  ('EQ-005','Flatbed 53ft','FB53','53ft flatbed trailer',48000,0,53,8.5,0,false,false,'Active'),
  ('EQ-006','Flatbed 48ft','FB48','48ft flatbed trailer',47000,0,48,8.5,0,false,false,'Active'),
  ('EQ-007','LTL','LTL','Less-than-truckload shared trailer',20000,2000,53,8.5,9,false,false,'Active'),
  ('EQ-008','Step Deck','SD48','48ft step deck trailer',43000,0,48,8.5,10,false,false,'Active'),
  ('EQ-009','Tanker','TANK','Liquid bulk tanker trailer',45000,6800,42,8,0,false,true,'Active'),
  ('EQ-010','Intermodal Container 40ft','IM40','40ft intermodal shipping container',44800,2350,40,8,8.5,false,false,'Active'),
  ('EQ-011','Sprinter Van','SPRN','Sprinter/cargo van for small shipments',3500,400,12,6,6,false,false,'Active'),
  ('EQ-012','Straight Truck 26ft','ST26','26ft box truck / straight truck',10000,1500,26,8,8,false,false,'Active')
ON CONFLICT (id) DO NOTHING;
