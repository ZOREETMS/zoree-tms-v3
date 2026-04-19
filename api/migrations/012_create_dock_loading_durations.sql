-- Migration: 012_create_dock_loading_durations
-- Date: 2026-04-18
-- Author: Claude (AI-assisted)
-- Description: Move mode→dock-loading-duration mapping out of the
--              hardcoded frontend constant LOAD_DURATION_BY_MODE
--              (frontend/src/constants/docks.js) and into a dedicated
--              lookup table so Operations can edit it from the Planning
--              Parameters page without a redeploy.
--
-- Affected APIs/UI:
--   api/server.js                                         — +1 entry in ALLOWED whitelist
--   frontend/src/lib/api.js                               — DbApi.dockLoadingDurations()
--   frontend/src/services/dockLoadingDurationsService.js  (NEW) — fetch/update + in-memory cache
--   frontend/src/components/planning-parameters/
--     DockDurationsSection.jsx                            (NEW) — numeric editor section
--   frontend/src/pages/PlanningParametersPage.jsx         — renders new section
--   frontend/src/services/dockService.js                  — reads from cache instead of constant
--   frontend/src/services/ordersService.js                — same (2 call sites)
--   frontend/src/App.jsx                                  — warm cache at boot
--
-- Backfill:
--   Seeds rows matching the current constant values so deploy is zero-
--   behavior-change: TL=120, LTL=90, Partial=90, Air=60.
--
-- Index changes:
--   PK on `mode` is sufficient (≤10 rows ever — lookup table).
--
-- Constraint changes:
--   + CHECK duration_minutes > 0 AND duration_minutes <= 600 (10h ceiling)
--   + CHECK mode <> ''
--
-- Rollback SQL:
--   DROP TABLE IF EXISTS dock_loading_durations;
--   (Frontend continues to work — dockLoadingDurationsService falls back
--   to the LOAD_DURATION_BY_MODE constant when the fetch fails/empties.)
--
-- Risks:
--   Low. New table, pure additive. Existing shipments store their own
--   loading_start/loading_end so in-flight appointments are unaffected.
--   Only *future* auto-assignments pick up admin edits.

CREATE TABLE IF NOT EXISTS dock_loading_durations (
  mode             TEXT        PRIMARY KEY,
  duration_minutes INTEGER     NOT NULL,
  label            TEXT        NULL,
  enabled          BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'dock_loading_durations'
      AND constraint_name = 'dock_loading_durations_duration_range_check'
  ) THEN
    ALTER TABLE dock_loading_durations
      ADD CONSTRAINT dock_loading_durations_duration_range_check
      CHECK (duration_minutes > 0 AND duration_minutes <= 600);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'dock_loading_durations'
      AND constraint_name = 'dock_loading_durations_mode_nonempty_check'
  ) THEN
    ALTER TABLE dock_loading_durations
      ADD CONSTRAINT dock_loading_durations_mode_nonempty_check
      CHECK (mode <> '');
  END IF;
END $$;

COMMENT ON TABLE  dock_loading_durations IS
  'Mode → default loading window (minutes) used by the dock scheduler when auto-assigning new appointments. Editable from Planning Parameters page.';
COMMENT ON COLUMN dock_loading_durations.mode             IS 'Shipment mode key — matches the uppercase `mode` on the shipments table (TL, LTL, Partial, Air).';
COMMENT ON COLUMN dock_loading_durations.duration_minutes IS 'Default loading window in minutes for this mode. Per-appointment overrides still take precedence.';
COMMENT ON COLUMN dock_loading_durations.enabled          IS 'When false, the scheduler falls back to the frontend constant for this mode.';

-- RLS: service role only; the API is the broker (same pattern as user_profiles).
ALTER TABLE dock_loading_durations ENABLE ROW LEVEL SECURITY;

-- Backfill with current constant values so deploy is zero-behavior-change.
INSERT INTO dock_loading_durations (mode, duration_minutes, label, enabled)
VALUES
  ('TL',      120, 'Truckload',              TRUE),
  ('LTL',      90, 'Less-than-Truckload',    TRUE),
  ('Partial',  90, 'Partial',                TRUE),
  ('Air',      60, 'Air',                    TRUE)
ON CONFLICT (mode) DO NOTHING;
