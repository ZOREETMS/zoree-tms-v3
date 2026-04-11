-- Migration: 003_create_warehouse_dock_config
-- Date: 2026-04-08
-- Author: Claude (AI-assisted)
-- Description: Create warehouse_dock_config table for per-warehouse dock scheduling settings.
--              Replaces hardcoded WAREHOUSE_DOCK_CONFIG in frontend constants.
--              Each warehouse (identified by origin string) can have its own door count,
--              max appointments per door, operating hours, etc.
--
-- Schema Change:
--   Table: warehouse_dock_config (NEW)
--   Columns: id, warehouse, num_doors, max_per_door, max_hours_per_door, start_hour, end_hour
--
-- Affected APIs/Services/UI:
--   - API: Generic CRUD at /api/db/warehouse_dock_config (add to ALLOWED whitelist)
--   - Frontend: dockScheduleService.js — fetchDockConfigs(), saveDockConfig()
--   - Frontend: DockSchedulingPage.jsx — config panel per warehouse
--   - Frontend: dockService.js — uses DB config for dock assignment
--
-- Backfill: Seed Atlanta GA 30350 with 2 doors, 4 hrs/door, 06:00-10:00
--
-- Index:
--   - UNIQUE on warehouse column (one config per warehouse)
--
-- Risks:
--   - None. New table, no existing data affected.
--   - warehouse is a text field matching order/shipment origin strings (uppercase)
--
-- Rollback:
--   DROP TABLE IF EXISTS warehouse_dock_config;

-- Forward migration
CREATE TABLE IF NOT EXISTS warehouse_dock_config (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse           TEXT NOT NULL UNIQUE,
  num_doors           INTEGER NOT NULL DEFAULT 6,
  max_per_door        INTEGER NOT NULL DEFAULT 4,
  max_hours_per_door  INTEGER NOT NULL DEFAULT 14,
  start_hour          INTEGER NOT NULL DEFAULT 6,
  end_hour            INTEGER NOT NULL DEFAULT 20,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Index for lookup by warehouse
CREATE INDEX IF NOT EXISTS idx_wdc_warehouse ON warehouse_dock_config (warehouse);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_wdc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wdc_updated_at ON warehouse_dock_config;
CREATE TRIGGER trg_wdc_updated_at
  BEFORE UPDATE ON warehouse_dock_config
  FOR EACH ROW
  EXECUTE FUNCTION update_wdc_updated_at();

-- Seed: Atlanta GA 30350
INSERT INTO warehouse_dock_config (warehouse, num_doors, max_per_door, max_hours_per_door, start_hour, end_hour)
VALUES ('ATLANTA, GA 30350', 2, 2, 4, 6, 10)
ON CONFLICT (warehouse) DO NOTHING;

COMMENT ON TABLE warehouse_dock_config IS 'Per-warehouse dock scheduling configuration. One row per warehouse origin.';
COMMENT ON COLUMN warehouse_dock_config.warehouse IS 'Uppercase origin string matching orders/shipments (e.g. ATLANTA, GA 30350)';
COMMENT ON COLUMN warehouse_dock_config.num_doors IS 'Number of dock doors available at this warehouse';
COMMENT ON COLUMN warehouse_dock_config.max_per_door IS 'Maximum appointments per door per day';
COMMENT ON COLUMN warehouse_dock_config.max_hours_per_door IS 'Maximum operating hours per door per day';
COMMENT ON COLUMN warehouse_dock_config.start_hour IS 'Dock operating start hour (0-23)';
COMMENT ON COLUMN warehouse_dock_config.end_hour IS 'Dock operating end hour (0-23)';
