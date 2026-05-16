-- Migration: 044_lane_preferences_add_disabled
-- Date:      2026-05-15
-- Author:    Claude (AI-assisted)
-- Feature:   Add a `disabled` flag to lane_preferences so a row can be
--            paused without being deleted (QA #324).
--
-- Purpose
-- ───────
-- The mobile Lane Preferences row-action sheet exposes Edit / Disable
-- / Delete to match the web information architecture, but
-- lane_preferences had no `disabled` column — so "Disable" had to map
-- to Delete, which made the action destructive when QA expected it to
-- be reversible. Adding a nullable-default-false boolean lets the
-- planner pause a lane preference (e.g. for a temporary capacity
-- issue) and re-enable it later without re-entering the row.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   lane_preferences.disabled  BOOLEAN NOT NULL DEFAULT FALSE
--
--   NOT NULL with a default so every existing row reads as "enabled"
--   after the migration runs. Callers that don't know about the
--   column continue to behave the way they did before — the planning
--   pipeline only short-circuits when disabled = TRUE.
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   None required. DEFAULT FALSE applies to every existing row at
--   ALTER TABLE time.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. The planner already filters lane prefs by (origin, dest,
--   mode) and the WHERE-disabled predicate combines with that lookup
--   without needing its own index — disabled rows are expected to be
--   the minority.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None enforced. The mobile form writes TRUE / FALSE; web's form
--   will pick the column up when its Lane Preferences page is taught
--   the Disable action (follow-up — out of scope here).
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API:
--     • PATCH /api/db/lane_preferences/:id — generic upsert path
--       already accepts the new column; genericTableAudit (REQ-02
--       Phase 4) writes change_history entries for the disable /
--       re-enable toggle alongside every other lane_preferences edit.
--   Frontend:
--     • mobile/src/screens/lanes/LanePreferencesScreen.tsx
--       — long-press action sheet now offers Disable distinct from
--       Delete, PATCHing { disabled: true }. Re-enable is reached by
--       editing the row.
--     • frontend/src/pages/LanePreferencesPage.jsx — follow-up: add a
--       row-level Disable toggle and surface disabled rows with a
--       muted style. Not blocking the column landing.
--   Planner:
--     • Lane preference application (frontend/src/services/
--       ordersService.js + api/services/ordersService) should ignore
--       rows where disabled = TRUE so a paused lane stops gating the
--       carrier selection. The application code change is a separate,
--       small follow-up — adding the column first makes it landable
--       without coupling the schema rollout to the application logic.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE lane_preferences DROP COLUMN IF EXISTS disabled;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Application code that selects lane_preferences with SELECT *
--     will pick up the new column transparently. Callers using
--     positional bindings would break — `git grep` shows none today.
--   • The mobile form patches `{ disabled: true }`; tenants on a
--     pre-044 schema will see PostgREST return a 400 with "column
--     'disabled' of relation lane_preferences does not exist", which
--     surfaces through the existing Alert.alert error path. The
--     migration should land before the mobile build that depends on
--     the column is rolled out.

BEGIN;

ALTER TABLE lane_preferences
  ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN lane_preferences.disabled IS
  'When TRUE, the planning pipeline should skip this lane preference '
  'as if it did not exist. Set via the Disable row-action in the '
  'Lane Preferences screen; reversible by editing the row. Added in '
  'migration 044 for QA #324.';

COMMIT;

-- Verification (run separately):
--   SELECT
--     COUNT(*) FILTER (WHERE disabled IS TRUE)  AS disabled,
--     COUNT(*) FILTER (WHERE disabled IS FALSE) AS enabled,
--     COUNT(*)                                  AS total
--   FROM lane_preferences;
