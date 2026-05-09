-- Migration: 040_message_log_anon_inbound_policy
-- Date: 2026-05-08
-- Author: Claude (AI-assisted)
-- Description: Bug #174 — the OMS bundle (zoree-oms.html) pushes new
--              orders to TMS by writing directly to Supabase with the
--              anon key (frontend/services/omsSync/pushOrderService.js).
--              That bypasses /api/ingest/oms-orders, which is the only
--              path that records an inbound `order_creation` row in
--              message_log. Net result: Message Hub showed unrelated
--              outbound traffic (planning details) but no inbound for
--              the OMS-side order creation, while the Inbound tab sat
--              empty.
--
--              Rather than hide message_log behind a service-only
--              writer (which would require routing the OMS push
--              through Express and breaking the existing direct-to-
--              Supabase access pattern that mw_*/oms_* tables already
--              use), we add a scoped RLS policy that lets the OMS
--              and Carrier anon clients INSERT inbound rows only.
--              Service-role writers (api/services/messagingHub/writer.js)
--              continue to bypass RLS as today.
--
-- Schema changes (DDL):
--   - ALTER TABLE message_log ENABLE ROW LEVEL SECURITY
--   - CREATE POLICY anon_inbound_oms_carrier ON message_log
--       FOR INSERT TO anon WITH CHECK (
--         direction = 'inbound'
--         AND source_system IN ('oms','carrier')
--         AND target_system = 'tms'
--       )
--
-- Affected APIs/services/UI:
--   frontend/services/omsSync/pushOrderService.js — inserts an inbound
--                                                   order_creation row
--                                                   after each TMS push.
--   api/services/messagingHub/writer.js          — unchanged; still the
--                                                   single writer for
--                                                   service-role traffic.
--   frontend/src/pages/MessagingHubPage           — populates inbound
--                                                   tab automatically
--                                                   once rows land.
--
-- Backfill / data:
--   None. We do not backfill historical OMS pushes — the hub's purpose
--   is forward-looking visibility from this point on.
--
-- Index changes: none.
-- Constraint changes: an additive RLS policy. No CHECK or FK changes.
--
-- Rollback SQL:
--   DROP POLICY IF EXISTS anon_inbound_oms_carrier ON message_log;
--   ALTER TABLE message_log DISABLE ROW LEVEL SECURITY;
--
-- Risks:
--   Low. The policy is INSERT-only and rejects rows that don't meet
--   ALL of: direction='inbound' AND source IN ('oms','carrier') AND
--   target='tms'. Anon cannot read or update existing rows, cannot
--   write outbound traffic, and cannot impersonate TMS as the source.
--   The single-writer guarantee for service-role traffic is preserved
--   because the policy only applies to the `anon` role.
--
-- Assumptions:
--   - The repo's other anon-write tables (mw_*, oms_*, orders, etc.)
--     are already accessed through the same anon key from the OMS
--     bundle, so adding message_log to that surface is consistent
--     with the existing access pattern documented in
--     frontend/zoree-oms.html.
--   - Tenant scoping on inbound writes is acceptable at the application
--     layer (pushOrderService stamps tenant_id explicitly) — the
--     message_log default 'zoree-default' suffices in single-tenant
--     installs and is overridden when the OMS bundle has a tenant set.

-- Defensive: enable RLS only if it isn't already on (some staging envs
-- enabled it manually during the messaging hub rollout).
ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_inbound_oms_carrier ON message_log;
CREATE POLICY anon_inbound_oms_carrier ON message_log
  FOR INSERT
  TO anon
  WITH CHECK (
    direction = 'inbound'
    AND source_system IN ('oms', 'carrier')
    AND target_system = 'tms'
  );

COMMENT ON POLICY anon_inbound_oms_carrier ON message_log IS
  'Bug #174: lets OMS / Carrier anon clients (zoree-oms.html, carrier-portal HTML) write inbound order_creation / tender_response rows so the Messaging Hub Inbound tab is not empty. Service-role writers bypass RLS untouched.';
