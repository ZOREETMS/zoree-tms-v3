-- ═══════════════════════════════════════════════════════════════════
-- ⚠ ARCHIVED — DO NOT RUN
-- Moved out of supabase/migrations/ on 2026-04-25.
-- Status: applied manually via the Supabase SQL editor on/around
--         2026-04-08; never registered in supabase_migrations.schema_migrations.
-- Superseded by: supabase/migrations/20260425_fix_rls_advisor_errors.sql
--                (and the rls_disabled_in_public errors it cleared on
--                tables created after this file was authored).
-- Kept here for historical reference only. The current source of truth
-- for RLS policy state is the live database + the 2026-04-25 migration.
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- Migration: Enable RLS + service_role-only policies (hybrid security)
-- Date: 2026-04-08
-- Reason: Supabase security advisory — tables publicly accessible via anon key
-- Strategy:
--   1. Create any missing tables from prior migrations
--   2. Enable RLS on ALL public tables
--   3. Explicit service_role-only policy on each table (defense in depth)
--   4. Blocks anon key access completely
--   5. Backend unaffected — service_role bypasses RLS
-- ═══════════════════════════════════════════════════════════════════

-- ── Phase 0: Create missing table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_types (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT,
  description     TEXT,
  max_weight      NUMERIC DEFAULT 0,
  max_volume      NUMERIC DEFAULT 0,
  length          NUMERIC DEFAULT 0,
  width           NUMERIC DEFAULT 0,
  height          NUMERIC DEFAULT 0,
  temp_controlled BOOLEAN DEFAULT false,
  hazmat_certified BOOLEAN DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'Active'
                  CHECK (status IN ('Active', 'Inactive')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_equipment_types_status ON equipment_types (status);
CREATE INDEX IF NOT EXISTS idx_equipment_types_code   ON equipment_types (code);

-- ── Phase 1: Drop old permissive policy ───────────────────────────
DROP POLICY IF EXISTS "Allow all access" ON route_templates;

-- ── Phase 2: Enable RLS on ALL public tables ──────────────────────
ALTER TABLE carriers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE crossdock_hubs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE dock_appointments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE dock_schedules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types      ENABLE ROW LEVEL SECURITY;
ALTER TABLE items                ENABLE ROW LEVEL SECURITY;
ALTER TABLE lane_preferences     ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mw_event_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mw_requests          ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_dock_schedule    ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_inv_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_inventory        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_locations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_order_lines      ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE oms_stage_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE planning_parameters  ENABLE ROW LEVEL SECURITY;
ALTER TABLE rates                ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipment_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles             ENABLE ROW LEVEL SECURITY;

-- ── Phase 3: Force RLS even for table owners ──────────────────────
ALTER TABLE carriers             FORCE ROW LEVEL SECURITY;
ALTER TABLE crossdock_hubs       FORCE ROW LEVEL SECURITY;
ALTER TABLE dock_appointments    FORCE ROW LEVEL SECURITY;
ALTER TABLE dock_schedules       FORCE ROW LEVEL SECURITY;
ALTER TABLE documents            FORCE ROW LEVEL SECURITY;
ALTER TABLE drivers              FORCE ROW LEVEL SECURITY;
ALTER TABLE equipment_types      FORCE ROW LEVEL SECURITY;
ALTER TABLE items                FORCE ROW LEVEL SECURITY;
ALTER TABLE lane_preferences     FORCE ROW LEVEL SECURITY;
ALTER TABLE locations            FORCE ROW LEVEL SECURITY;
ALTER TABLE mw_event_log         FORCE ROW LEVEL SECURITY;
ALTER TABLE mw_requests          FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_customers        FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_dock_schedule    FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_inv_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_inventory        FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_locations        FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_order_lines      FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_orders           FORCE ROW LEVEL SECURITY;
ALTER TABLE oms_stage_log        FORCE ROW LEVEL SECURITY;
ALTER TABLE order_history        FORCE ROW LEVEL SECURITY;
ALTER TABLE order_lines          FORCE ROW LEVEL SECURITY;
ALTER TABLE orders               FORCE ROW LEVEL SECURITY;
ALTER TABLE planning_parameters  FORCE ROW LEVEL SECURITY;
ALTER TABLE rates                FORCE ROW LEVEL SECURITY;
ALTER TABLE route_templates      FORCE ROW LEVEL SECURITY;
ALTER TABLE shipment_events      FORCE ROW LEVEL SECURITY;
ALTER TABLE shipments            FORCE ROW LEVEL SECURITY;
ALTER TABLE system_config        FORCE ROW LEVEL SECURITY;
ALTER TABLE tms_messages         FORCE ROW LEVEL SECURITY;
ALTER TABLE vehicles             FORCE ROW LEVEL SECURITY;

-- ── Phase 4: Service-role-only policies (defense in depth) ────────
--    DROP IF EXISTS first so this migration is re-runnable.
--    service_role bypasses RLS, so backend access is unchanged.
--    anon and authenticated roles get zero access.

DROP POLICY IF EXISTS "service_role_only" ON carriers;
CREATE POLICY "service_role_only" ON carriers             FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON crossdock_hubs;
CREATE POLICY "service_role_only" ON crossdock_hubs       FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON dock_appointments;
CREATE POLICY "service_role_only" ON dock_appointments    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON dock_schedules;
CREATE POLICY "service_role_only" ON dock_schedules       FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON documents;
CREATE POLICY "service_role_only" ON documents            FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON drivers;
CREATE POLICY "service_role_only" ON drivers              FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON equipment_types;
CREATE POLICY "service_role_only" ON equipment_types      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON items;
CREATE POLICY "service_role_only" ON items                FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON lane_preferences;
CREATE POLICY "service_role_only" ON lane_preferences     FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON locations;
CREATE POLICY "service_role_only" ON locations            FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON mw_event_log;
CREATE POLICY "service_role_only" ON mw_event_log         FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON mw_requests;
CREATE POLICY "service_role_only" ON mw_requests          FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_customers;
CREATE POLICY "service_role_only" ON oms_customers        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_dock_schedule;
CREATE POLICY "service_role_only" ON oms_dock_schedule    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_inv_transactions;
CREATE POLICY "service_role_only" ON oms_inv_transactions FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_inventory;
CREATE POLICY "service_role_only" ON oms_inventory        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_locations;
CREATE POLICY "service_role_only" ON oms_locations        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_order_lines;
CREATE POLICY "service_role_only" ON oms_order_lines      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_orders;
CREATE POLICY "service_role_only" ON oms_orders           FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON oms_stage_log;
CREATE POLICY "service_role_only" ON oms_stage_log        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON order_history;
CREATE POLICY "service_role_only" ON order_history        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON order_lines;
CREATE POLICY "service_role_only" ON order_lines          FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON orders;
CREATE POLICY "service_role_only" ON orders               FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON planning_parameters;
CREATE POLICY "service_role_only" ON planning_parameters  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON rates;
CREATE POLICY "service_role_only" ON rates                FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON route_templates;
CREATE POLICY "service_role_only" ON route_templates      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON shipment_events;
CREATE POLICY "service_role_only" ON shipment_events      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON shipments;
CREATE POLICY "service_role_only" ON shipments            FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON system_config;
CREATE POLICY "service_role_only" ON system_config        FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON tms_messages;
CREATE POLICY "service_role_only" ON tms_messages         FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_only" ON vehicles;
CREATE POLICY "service_role_only" ON vehicles             FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
