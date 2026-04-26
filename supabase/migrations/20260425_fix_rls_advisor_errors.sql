-- ═══════════════════════════════════════════════════════════════════
-- Migration: Fix Supabase Security Advisor errors (RLS)
-- Date:      2026-04-25
-- Author:    Sridhar
-- Reason:    Production advisor flagged 8 tables in `public` exposed via
--            PostgREST without RLS, plus 1 table with RLS-on / no-policy.
--
-- Scope (only what is safe given the two HTML frontends that bypass the
-- Express API and depend on the existing `anon_all` policies):
--   • Enable RLS + service_role-only on tables touched ONLY by the
--     Express API (service role bypasses RLS, so backend is unaffected).
--   • Anon-INSERT carve-out on `trial_signups` (marketing landing page
--     posts directly with the anon key).
--   • Drop the dated backup table `rates_czarlite_wt_backup_20260422`
--     (data dumped to `supabase/archive/...csv` first).
--   • Add `service_role_only` policy to `dock_loading_durations` to
--     resolve its rls_enabled_no_policy info-level lint.
--
-- Out of scope (intentionally NOT touched):
--   • The 13 `anon_all USING(true) WITH CHECK(true)` policies on
--     mw_*, oms_*, orders, order_lines, shipments — these are
--     load-bearing for `frontend/zoree-oms.html` and
--     `frontend/zoree-middleware.html` which hit Supabase directly
--     via the anon key. Tightening them requires migrating those
--     apps first; tracked separately.
--
-- Affected APIs / services / UI:
--   • api/services/rolePermissions.js, userManagement.js, changeHistory.js
--     — use service role, unaffected.
--   • marketing/index.html → trial_signups insert — preserved by anon
--     INSERT carve-out.
--   • frontend/src/services/dockLoadingDurationsService.js — calls go
--     through Express API, unaffected.
--
-- Rollback: every CREATE POLICY is preceded by DROP IF EXISTS so the
-- migration is idempotent and re-runnable. To revert:
--   ALTER TABLE <name> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS service_role_only ON <name>;
-- The dropped backup table can be restored from the CSV at
-- `supabase/archive/rates_czarlite_wt_backup_20260422.csv`.
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

-- ── Phase 1: Drop dated backup table ──────────────────────────────
-- 3 rows, dumped to supabase/archive/rates_czarlite_wt_backup_20260422.csv
DROP TABLE IF EXISTS public.rates_czarlite_wt_backup_20260422;

-- ── Phase 2: Enable RLS on the 8 flagged tables + dock_loading ────
ALTER TABLE public.access_roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_features           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_feature_permissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_history            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_dock_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_signups             ENABLE ROW LEVEL SECURITY;
-- dock_loading_durations already has RLS enabled (info-level lint:
-- "RLS enabled but no policy"). We add service_role_only below.

ALTER TABLE public.access_roles              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.access_features           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_feature_permissions  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.change_history            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_dock_config     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.trial_signups             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dock_loading_durations    FORCE ROW LEVEL SECURITY;

-- ── Phase 3: service_role_only policies (defense in depth) ────────
-- service_role bypasses RLS by default; these explicit policies make
-- the intent visible in pg_policy and survive any future role changes.

DROP POLICY IF EXISTS service_role_only ON public.access_roles;
CREATE POLICY service_role_only ON public.access_roles
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.access_features;
CREATE POLICY service_role_only ON public.access_features
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.role_feature_permissions;
CREATE POLICY service_role_only ON public.role_feature_permissions
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.invoices;
CREATE POLICY service_role_only ON public.invoices
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.change_history;
CREATE POLICY service_role_only ON public.change_history
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.warehouse_dock_config;
CREATE POLICY service_role_only ON public.warehouse_dock_config
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS service_role_only ON public.dock_loading_durations;
CREATE POLICY service_role_only ON public.dock_loading_durations
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Phase 4: trial_signups (anon INSERT for marketing form) ───────
-- See marketing/index.html — public landing page posts directly
-- with the anon key. SELECT/UPDATE/DELETE remain service-role only.

DROP POLICY IF EXISTS service_role_only ON public.trial_signups;
CREATE POLICY service_role_only ON public.trial_signups
  FOR ALL TO public
  USING      (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS anon_insert ON public.trial_signups;
CREATE POLICY anon_insert ON public.trial_signups
  FOR INSERT TO anon
  WITH CHECK (true);

COMMIT;
