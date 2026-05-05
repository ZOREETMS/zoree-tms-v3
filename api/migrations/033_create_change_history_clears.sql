-- Migration: 033_create_change_history_clears
-- Date:      2026-05-04
-- Author:    Claude (AI-assisted)
-- Feature:   Persistent "Clear History" markers (TMS bug #1)
--
-- Purpose
-- ───────
-- Bug report: "History not permanently cleared; records reappear after
-- reopening the order even after clicking Clear History." Before this
-- migration, the Clear History button at
--   frontend/src/components/orders/OrderDetailModal.jsx:283
-- routed through OrdersPage.jsx#onClearHistory, but the persistence
-- layer (POST /api/orders/:id/history/clear → recordClear → INSERT into
-- change_history_clears) had no table to write into. Every click was
-- failing server-side; the marker was never recorded; the next reopen
-- re-fetched the full audit ledger.
--
-- We deliberately do NOT delete change_history rows on Clear: REQ-02
-- requires the audit ledger to be append-only and immutable. Instead
-- we record a per-(entity_type, entity_id) "cleared_at" marker, and
-- api/services/changeHistory.js#getHistory filters out rows older than
-- the latest marker. DBAs can still query change_history directly and
-- see everything; only the History tab UI hides pre-clear rows.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   New table public.change_history_clears:
--     id            BIGSERIAL    PRIMARY KEY
--     entity_type   TEXT         NOT NULL    -- 'order' | 'shipment' | 'rate' | 'carrier' | 'invoice'
--                                              (mirrors change_history.entity_type allow-list)
--     entity_id     TEXT         NOT NULL
--     cleared_at    TIMESTAMPTZ  NOT NULL    DEFAULT now()
--     cleared_by    TEXT                     -- username/email captured from session
--     cleared_by_id UUID                     -- auth.users.id when available
--     metadata      JSONB        NOT NULL    DEFAULT '{}'::jsonb
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   None. New feature; no historical Clear events to replay. The table
--   starts empty and getLatestClearAt returns NULL for every entity,
--   which means getHistory degrades to its prior "show all rows"
--   behaviour — i.e. a no-op until the user clicks Clear.
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   Composite index on (entity_type, entity_id, cleared_at DESC).
--   Hot path: every getHistory() call runs
--     SELECT cleared_at
--       FROM change_history_clears
--      WHERE entity_type = $1 AND entity_id = $2
--      ORDER BY cleared_at DESC
--      LIMIT 1;
--   The DESC index lets that query land on the first index row without
--   a sort. Without the index it would scan + sort the table on every
--   modal open.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   chk_clears_entity_type — same allow-list as
--   change_history.ALLOWED_ENTITIES (api/services/changeHistory.js:6)
--   so the two tables stay semantically aligned. Adding a sixth entity
--   type means updating both check constraints in lockstep.
--
--   No FK from change_history → change_history_clears: clears can
--   reference entities that no longer have any change_history rows
--   (e.g. a future "clear before delete" flow), and getHistory() does
--   the temporal join in application code, not via a DB constraint.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   API (services layer — no UI hits the DB directly):
--     • api/services/changeHistoryClears.js (new)
--         recordClear({ entityType, entityId, user, metadata })
--         getLatestClearAt(entityType, entityId)
--     • api/services/changeHistory.js#getHistory
--         joins on getLatestClearAt and filters created_at > clearedAt
--   Routes:
--     • POST /api/orders/:id/history/clear     (api/server.js)
--     • POST /api/shipments/:id/history/clear  (api/server.js)
--         both gated to roles: admin, planner.
--   Frontend services:
--     • frontend/src/lib/api.js
--         OrdersApi.clearHistory / ShipmentsApi.clearHistory
--     • frontend/src/services/historyService.js
--         clearOrderHistory / clearShipmentHistory
--   Frontend pages:
--     • frontend/src/pages/OrdersPage.jsx#onClearHistory
--         calls clearOrderHistory(oid) then reloadOrderHistory(oid).
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   DROP TABLE IF EXISTS public.change_history_clears CASCADE;
--   Effect: getLatestClearAt catches the missing-relation error and
--   returns NULL, so getHistory falls back to "show every row forever"
--   (the legacy behaviour). No FK back-pointers, so rollback is safe.
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Authorization: anyone passing the admin/planner role gate on the
--     POST endpoints can hide audit history for any order/shipment.
--     Mitigated by (a) the role gate itself and (b) the audit ledger
--     remaining intact in change_history — DBAs and any future
--     "show pre-clear rows" admin tool can still read it.
--   • RLS: not enabled. All reads/writes go through the Node API using
--     the SUPABASE_SERVICE_KEY. If this table is ever exposed via the
--     anon key, RLS must be added in a follow-up migration.
--   • Concurrency: two simultaneous Clear clicks insert two marker
--     rows; getLatestClearAt uses ORDER BY cleared_at DESC LIMIT 1 so
--     the later one wins, which is the intended semantics.
--   • Storage: one row per Clear click. Even at 1k clicks/day this is
--     <50MB/year of JSONB. Negligible.

BEGIN;

CREATE TABLE IF NOT EXISTS public.change_history_clears (
  id            BIGSERIAL   PRIMARY KEY,
  entity_type   TEXT        NOT NULL,
  entity_id     TEXT        NOT NULL,
  cleared_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cleared_by    TEXT,
  cleared_by_id UUID,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_clears_entity_type
    CHECK (entity_type IN ('order', 'shipment', 'rate', 'carrier', 'invoice'))
);

CREATE INDEX IF NOT EXISTS idx_change_history_clears_entity
  ON public.change_history_clears (entity_type, entity_id, cleared_at DESC);

COMMENT ON TABLE public.change_history_clears IS
  'REQ-02 / TMS bug #1: per-entity Clear History markers. The History '
  'tab filters change_history rows older than the latest cleared_at '
  'for the entity. Audit rows themselves are never deleted; this is a '
  'visibility marker, not a tombstone. Written by '
  'api/services/changeHistoryClears.js#recordClear and read by '
  '#getLatestClearAt on every getHistory() call.';

COMMIT;

-- Verification (run separately):
--   -- 1. Table + index land in the right schema
--   SELECT to_regclass('public.change_history_clears')                    AS table_oid,
--          to_regclass('public.idx_change_history_clears_entity')         AS index_oid;
--
--   -- 2. Allow-list constraint mirrors change_history
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'public.change_history_clears'::regclass
--      AND contype = 'c';
--
--   -- 3. Smoke test the round-trip the API uses
--   --    (substitute a real order id; safe — only writes a marker row)
--   -- INSERT INTO public.change_history_clears (entity_type, entity_id, cleared_by)
--   --   VALUES ('order', 'ORD-TEST-001', 'verification');
--   -- SELECT cleared_at FROM public.change_history_clears
--   --  WHERE entity_type = 'order' AND entity_id = 'ORD-TEST-001'
--   --  ORDER BY cleared_at DESC LIMIT 1;
--   -- DELETE FROM public.change_history_clears WHERE entity_id = 'ORD-TEST-001';
