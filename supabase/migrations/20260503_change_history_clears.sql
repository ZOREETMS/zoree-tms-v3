-- =============================================================================
-- Migration: 20260503_change_history_clears
-- Purpose:   Track per-entity "history cleared" events so the History tab in
--            OrderDetailModal / ShipmentDetailModal can offer a Clear History
--            action that persists across reopen/refresh — without
--            destroying the underlying audit rows in change_history.
--
-- Bug fix: TMS bug #1 (Reported 04/22) — "History not permanently cleared;
--          records reappear after reopening order even after clicking Clear
--          History." The previous frontend-only handler at
--          frontend/src/pages/OrdersPage.jsx:1537 only mutated component
--          state. This migration introduces the persistence layer the new
--          /api/orders/:id/history/clear endpoint writes to.
-- =============================================================================
--
-- Background:
--   change_history is the immutable, append-only audit ledger for every
--   order/shipment/rate/carrier/invoice mutation (REQ-02). For
--   compliance reasons we cannot delete rows just because the planner
--   wants a cleaner UI. Instead we record a per-(entity, timestamp)
--   "cleared at" marker and filter the History tab to rows newer than
--   the marker.
--
-- Schema Changes:
--   New table public.change_history_clears:
--     id           bigserial primary key
--     entity_type  text not null   — 'order' | 'shipment' (mirror of change_history.entity_type)
--     entity_id    text not null
--     cleared_at   timestamptz not null default now()
--     cleared_by   text             — username/email captured from session
--     cleared_by_id uuid            — auth.users.id when available
--     metadata     jsonb not null default '{}'::jsonb
--   plus a partial index on (entity_type, entity_id, cleared_at desc)
--   so the latest-clear lookup the changeHistory service runs on every
--   getHistory() call is a single index seek, not a sort over all rows.
--
-- Data Changes: none. Existing change_history rows are untouched.
--
-- Constraint Changes:
--   chk_clears_entity_type — same allow-list as change_history.entity_type
--   to keep the two tables semantically aligned.
--
-- Rollback:
--   drop table if exists public.change_history_clears cascade;
--   The clear-state is non-recoverable on rollback; History tab returns
--   to the legacy "show every row forever" behaviour. No FK from
--   change_history → change_history_clears, so rollback is safe.
--
-- Affected APIs / Services / UI:
--   - api/services/changeHistoryClears.js (new)  — record + lookup
--   - api/services/changeHistory.js              — getHistory() now joins
--                                                   on the latest clear
--                                                   and filters rows older
--                                                   than that timestamp
--   - api/server.js                              — POST /api/orders/:id/history/clear
--                                                   POST /api/shipments/:id/history/clear
--   - frontend/src/lib/api.js                    — OrdersApi.clearHistory /
--                                                   ShipmentsApi.clearHistory
--   - frontend/src/services/historyService.js    — clearOrderHistory /
--                                                   clearShipmentHistory
--   - frontend/src/pages/OrdersPage.jsx          — onClearHistory wired
--                                                   to the service +
--                                                   reload from server
--
-- Risks / Assumptions:
--   - Anyone with the role gate on POST /api/orders/:id/history/clear can
--     clear the visible history of any order. Audit-trail itself is not
--     destroyed — DBAs can still query change_history directly.
--   - The new table is anon-readable via the existing global anon
--     policies elsewhere in the schema only if explicitly granted; we
--     leave it RLS-disabled here because all writes/reads go through the
--     service-role key in api/services/changeHistoryClears.js.
-- =============================================================================

create table if not exists public.change_history_clears (
  id            bigserial primary key,
  entity_type   text        not null,
  entity_id     text        not null,
  cleared_at    timestamptz not null default now(),
  cleared_by    text,
  cleared_by_id uuid,
  metadata      jsonb       not null default '{}'::jsonb,
  constraint chk_clears_entity_type
    check (entity_type in ('order', 'shipment', 'rate', 'carrier', 'invoice'))
);

-- The hot path is "give me the latest cleared_at for (entity_type,
-- entity_id)". A composite descending index on cleared_at lets that
-- lookup land on the first index row.
create index if not exists idx_change_history_clears_entity
  on public.change_history_clears (entity_type, entity_id, cleared_at desc);

comment on table public.change_history_clears is
  'REQ-02 / TMS bug #1: per-entity Clear History markers. The History tab filters change_history rows with created_at < the latest cleared_at for the entity. Audit rows themselves are never deleted.';
