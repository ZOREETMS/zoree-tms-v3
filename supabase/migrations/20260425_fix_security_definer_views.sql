-- ═══════════════════════════════════════════════════════════════════
-- Migration: Fix SECURITY DEFINER views (advisor lint 0010)
-- Date:      2026-04-25
-- Author:    Sridhar
-- Reason:    Three OMS read-model views are owned by `postgres` and
--            run with the owner's permissions, bypassing RLS on the
--            underlying tables (PostgreSQL views default to a
--            SECURITY DEFINER-like model unless `security_invoker` is
--            set). On Postgres 15+ we can flip them in-place with
--            `ALTER VIEW ... SET (security_invoker = true)` — the view
--            then evaluates RLS as the calling role, which is what we
--            want.
--
-- Affected views (all in `public`):
--   • oms_inventory_available  → reads oms_inventory
--   • oms_inv_status           → reads oms_inventory + oms_customers
--   • oms_order_summary        → reads oms_orders + oms_customers
--                                + oms_locations + oms_order_lines
--
-- Note on access: the underlying oms_* tables carry the existing
-- `anon_all USING(true) WITH CHECK(true)` policy (load-bearing for
-- frontend/zoree-oms.html), so anon reads through these views
-- continue to work after the flip. The change only matters for
-- non-anon callers — they will now correctly see what their own
-- privileges allow, instead of the postgres role's view.
--
-- No dependent objects (verified via pg_depend); no need for CASCADE.
--
-- Rollback:
--   ALTER VIEW public.oms_inventory_available SET (security_invoker = false);
--   ALTER VIEW public.oms_inv_status          SET (security_invoker = false);
--   ALTER VIEW public.oms_order_summary       SET (security_invoker = false);
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER VIEW public.oms_inventory_available SET (security_invoker = true);
ALTER VIEW public.oms_inv_status          SET (security_invoker = true);
ALTER VIEW public.oms_order_summary       SET (security_invoker = true);

COMMIT;
