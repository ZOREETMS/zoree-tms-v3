-- ═══════════════════════════════════════════════════════════════════
-- Migration: Pin function search_path (advisor lint 0011)
-- Date:      2026-04-25
-- Author:    Sridhar
-- Reason:    Six trigger / utility functions in `public` were created
--            without a fixed `search_path`. With a mutable search_path,
--            an unprivileged user can shadow built-in operators or
--            tables and run code in the function's security context.
--            Setting `search_path = ''` forces fully-qualified names
--            inside the function bodies and removes the attack surface.
--
-- Affected functions (all in `public`, all zero-arg trigger fns):
--   • set_updated_at                — generic updated_at toucher
--   • update_documents_updated_at   — documents table trigger
--   • update_wdc_updated_at         — warehouse_dock_config trigger
--   • fn_carriers_name_uppercase    — uppercases carriers.name
--   • fn_rates_carrier_uppercase    — uppercases rates.carrier
--   • fn_shipments_carrier_uppercase — uppercases shipments.carrier
--
-- Note: ALTER FUNCTION ... SET search_path does NOT touch the function
-- body. If any of these reference unqualified table names internally,
-- they will start to fail. I verified the three uppercase trigger fns
-- only touch NEW.<col> (no table refs); the updated_at fns only touch
-- NEW.updated_at. Safe to pin.
--
-- Rollback:
--   ALTER FUNCTION public.<name>() RESET search_path;
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

ALTER FUNCTION public.set_updated_at()                  SET search_path = '';
ALTER FUNCTION public.update_documents_updated_at()     SET search_path = '';
ALTER FUNCTION public.update_wdc_updated_at()           SET search_path = '';
ALTER FUNCTION public.fn_carriers_name_uppercase()      SET search_path = '';
ALTER FUNCTION public.fn_rates_carrier_uppercase()      SET search_path = '';
ALTER FUNCTION public.fn_shipments_carrier_uppercase()  SET search_path = '';

COMMIT;
