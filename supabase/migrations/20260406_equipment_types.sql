-- ============================================================
-- Migration: 20260406_equipment_types
-- Description: Create equipment_types master data table for
--   defining equipment/trailer types with weight and volume capacities.
-- Date: 2026-04-06
--
-- Affected APIs:
--   - GET/POST/PATCH/DELETE /api/db/equipment_types (generic CRUD)
--
-- Affected Services:
--   - frontend/src/services/equipmentService.js
--
-- Affected UI:
--   - frontend/src/pages/EquipmentMasterPage.jsx
--   - frontend/src/components/equipment/EquipmentTable.jsx
--   - frontend/src/components/equipment/EquipmentModal.jsx
--
-- Backfill: None — new table, no existing data to migrate.
--
-- Index Strategy:
--   - idx_equipment_types_status: filter by Active/Inactive
--   - idx_equipment_types_code: lookup by short code
--
-- Risks & Assumptions:
--   - No foreign key dependencies yet; future shipments may reference
--     equipment_types.id via a soft reference (text field).
--   - Safe to deploy: CREATE TABLE IF NOT EXISTS is idempotent.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_equipment_types_status;
--   DROP INDEX IF EXISTS idx_equipment_types_code;
--   DROP TABLE IF EXISTS equipment_types;
-- ============================================================

CREATE TABLE IF NOT EXISTS equipment_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT,
  description     TEXT,
  max_weight      NUMERIC DEFAULT 0,      -- lbs
  max_volume      NUMERIC DEFAULT 0,      -- cubic ft
  length          NUMERIC DEFAULT 0,      -- ft
  width           NUMERIC DEFAULT 0,      -- ft
  height          NUMERIC DEFAULT 0,      -- ft
  temp_controlled BOOLEAN DEFAULT false,
  hazmat_certified BOOLEAN DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active', 'Inactive')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Indexes based on expected query patterns
CREATE INDEX IF NOT EXISTS idx_equipment_types_status ON equipment_types (status);
CREATE INDEX IF NOT EXISTS idx_equipment_types_code   ON equipment_types (code);
