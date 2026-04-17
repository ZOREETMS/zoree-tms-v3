-- Migration: 006_create_change_history
-- Date: 2026-04-16
-- Author: Claude (AI-assisted)
-- Description: REQ-02 Change history capture with username.
--              Adds a universal change_history table so the TMS can record
--              edits, planning assigns, tendering, and unassign events
--              across orders and shipments. Rows are append-only; every
--              record carries who made the change, when, which field moved,
--              and the before/after values. The service layer is the only
--              writer — no writes from the UI proxy.
--
-- Affected APIs/UI:
--   api/services/changeHistory.js (NEW)       — recordChange/recordChangeBatch/getHistory
--   api/server.js                             — hooks history into
--                                               POST /api/orders (create),
--                                               PATCH /api/orders/:id (edit + unassign),
--                                               DELETE /api/orders/:id (delete),
--                                               POST /api/tender/email (tender),
--                                               GET /api/orders/:id/history, GET /api/shipments/:id/history (new)
--   api/services/bulkPlanExecution.js         — emits 'plan' events when orders are assigned to shipments
--   frontend/src/services/historyService.js (NEW) — fetch history by entity
--   frontend/src/components/HistoryDrawer.jsx (NEW) — shared modal drawer
--   frontend/src/pages/OrdersPage.jsx         — wires the drawer to the detail modal
--
-- Backfill:
--   None. History starts now. Older state is not reconstructable from
--   prior rows — the design accepts that and only records events from
--   this migration forward.
--
-- Index changes:
--   + idx_change_history_entity       — supports GET /api/orders/:id/history
--   + idx_change_history_created_at   — supports recent-activity reports
--   + idx_change_history_username     — supports per-user audit reports
--
-- Constraint changes:
--   + CHECK (entity_type IN ('order','shipment','rate','carrier'))
--   + CHECK (action IN ('create','edit','delete','plan','unassign','tender','untender','status'))
--
-- Rollback SQL:
--   DROP INDEX IF EXISTS idx_change_history_username;
--   DROP INDEX IF EXISTS idx_change_history_created_at;
--   DROP INDEX IF EXISTS idx_change_history_entity;
--   DROP TABLE IF EXISTS change_history;
--
-- Risks:
--   Low. New table, no modification to existing data. Volume scales with
--   write activity; indexes chosen to support the most common queries
--   (entity lookup, user history). metadata jsonb is optional context.

CREATE TABLE IF NOT EXISTS change_history (
  id            BIGSERIAL    PRIMARY KEY,
  entity_type   TEXT         NOT NULL,
  entity_id     TEXT         NOT NULL,
  action        TEXT         NOT NULL,
  field         TEXT         NULL,            -- NULL for non-field actions (create/delete/plan/tender/unassign)
  old_value     TEXT         NULL,
  new_value     TEXT         NULL,
  username      TEXT         NOT NULL,         -- email or display name at time of action
  user_id       TEXT         NULL,             -- Supabase auth user id (uuid as text)
  user_role     TEXT         NULL,             -- role at time of action
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  tenant_id     TEXT         NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'change_history' AND constraint_name = 'change_history_entity_type_check'
  ) THEN
    ALTER TABLE change_history
      ADD CONSTRAINT change_history_entity_type_check
      CHECK (entity_type IN ('order','shipment','rate','carrier'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'change_history' AND constraint_name = 'change_history_action_check'
  ) THEN
    ALTER TABLE change_history
      ADD CONSTRAINT change_history_action_check
      CHECK (action IN ('create','edit','delete','plan','unassign','tender','untender','status'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_change_history_entity     ON change_history (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_history_created_at ON change_history (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_change_history_username   ON change_history (username, created_at DESC);

COMMENT ON TABLE  change_history           IS 'Append-only audit log for REQ-02. Captures who changed what, when, and why across orders/shipments/rates/carriers.';
COMMENT ON COLUMN change_history.action    IS 'create | edit | delete | plan | unassign | tender | untender | status';
COMMENT ON COLUMN change_history.metadata  IS 'Optional JSON context: e.g. shipment_id on plan/unassign, carrier on tender.';
