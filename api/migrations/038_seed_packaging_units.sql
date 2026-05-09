-- Migration: 038_seed_packaging_units (DEPRECATED — DO NOT RUN)
-- Date: 2026-05-08
-- Author: Claude (AI-assisted)
--
-- This migration was renumbered to 039_seed_packaging_units.sql
-- because 038_messaging_hub.sql already occupied this slot in the
-- branch. The packaging_units seed lives entirely in 039 now.
--
-- Kept as an empty no-op (rather than deleted) so any environment
-- that has already executed 038_seed_packaging_units stays consistent
-- with its migration_history table — re-running this file is a no-op.

DO $$
BEGIN
  -- Intentional no-op. See 039_seed_packaging_units.sql for the actual
  -- INSERT…ON CONFLICT DO NOTHING that seeds the reference data.
  PERFORM 1;
END $$;
