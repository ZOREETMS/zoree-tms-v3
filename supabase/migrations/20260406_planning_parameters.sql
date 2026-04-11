-- ============================================================
-- Migration: Create planning_parameters table
-- Description: Configuration table for enabling/disabling planning features
-- Date: 2026-04-06
-- Affected: Planning Parameters UI, bulk planning, route optimization
-- Rollback: DROP TABLE IF EXISTS planning_parameters;
-- ============================================================

CREATE TABLE IF NOT EXISTS planning_parameters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  label           TEXT NOT NULL,
  description     TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  category        TEXT DEFAULT 'general',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Index on key for fast lookups by feature key
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_parameters_key ON planning_parameters (key);

-- ============================================================
-- Seed data (initial planning parameters)
-- ============================================================

INSERT INTO planning_parameters (key, label, description, category, enabled)
VALUES
  ('lane_preferences', 'Lane Preferences', 'Use lane preference rules when matching carriers to shipments during planning', 'planning', true),
  ('multistop_consolidation', 'Multi-stop Consolidation', 'Combine compatible orders into multi-stop routes during bulk planning', 'planning', true)
ON CONFLICT (key) DO NOTHING;
