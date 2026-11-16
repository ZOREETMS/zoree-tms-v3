-- ═══════════════════════════════════════════════════════════════════
-- 052_domains.sql
-- ─────────────────────────────────────────────────────────────────────
-- Why: one Zoree TMS install serves more than one client. Each client's
-- orders, shipments, invoices, carriers and rates must stay in its own
-- data partition (an OTM-style "domain") so a planner working for one
-- client never sees, rates against, or audits another client's data.
-- First use: Kestrel Bay Logistics (BackOps panel pilot) — KESTREL_BAY.
--
-- 1. Schema changes (DDL)
--    + table public.domains            (code PK, name, active, audit fields)
--    + table public.user_domain_access (user_id → user_profiles, domain_code,
--                                       is_default; PK user_id+domain_code)
--    + column domain_code TEXT NOT NULL DEFAULT 'ZOREE' REFERENCES domains(code)
--      on the top-level tables:
--        orders, shipments, invoices, carriers, rates, locations, items,
--        documents, invoice_intakes, email_order_intake, agent_runs
--      Child tables (order_lines, shipment_legs, shipment_events,
--      invoice_cost_lines, shipment_accessorial_approvals,
--      carrier_fsc_schedules …) inherit the domain through their parent FK
--      and get no column (normalized; no second source of truth).
--
-- 2. Migration files: this file only.
--
-- 3. Backfill
--    - Every existing row takes the column default 'ZOREE'.
--    - Kestrel Bay carriers (CAR-KB-*) and their contract rates
--      (lane LIKE 'KB · %') move to KESTREL_BAY.
--    - Every enabled user gets ZOREE (default). admin@zoree.io also gets
--      KESTREL_BAY.
--
-- 4. Indexes (query patterns: list screens filter domain + newest first;
--    rating filters domain + mode)
--    + idx_orders_domain_created     (domain_code, created_at DESC)
--    + idx_shipments_domain_created  (domain_code, created_at DESC)
--    + idx_invoices_domain_created   (domain_code, created_at DESC)
--    + idx_rates_domain_mode         (domain_code, mode)
--    + idx_carriers_domain           (domain_code)
--    + uq_user_domain_default        one default domain per user (partial unique)
--
-- 5. Constraints
--    + domains.code CHECK: upper-case letters, digits, underscore (2–32)
--    + FK domain_code → domains(code) ON UPDATE CASCADE (no delete cascade:
--      a domain with data cannot be deleted)
--    + user_domain_access FKs → user_profiles ON DELETE CASCADE, → domains
--    + RLS on both new tables, no anon policies (service role only).
--      The anon_all policies on orders/shipments/rates stay as they are —
--      they are load-bearing for zoree-oms.html / zoree-middleware.html.
--
-- 6. Rollback
--    Behaviour: set DOMAIN_SCOPING=off in api/.env → the API stops filtering
--    by domain; no data is touched.
--    Schema (only if the feature is abandoned):
--      ALTER TABLE <each table above> DROP COLUMN IF EXISTS domain_code;
--      DROP TABLE IF EXISTS public.user_domain_access;
--      DROP TABLE IF EXISTS public.domains;
--
-- 7. Affected APIs / services / UI
--    NEW  api/services/domains/{domainCodes,domainContext,domainScope,
--                               scopedFetch,domainAccess}.js
--    NEW  api/middleware/domainScope.js   (resolves the request's domain)
--    NEW  GET /api/domains/mine
--    CHG  api/server.js                   (installs scoped fetch + middleware;
--                                          lane quote cache keyed by domain)
--    CHG  api/services/supabase.js        (client uses the scoped fetch)
--    NEW  frontend domain switcher (sidebar), lib/api.js sends X-Zoree-Domain
--
-- 8. Risks / assumptions
--    - Scoping is enforced in the Express API (service role bypasses RLS).
--      zoree-oms.html / zoree-middleware.html, the mobile app, the Teams bot
--      and the Zoree MCP connector do not send a domain → they work in ZOREE.
--    - Background jobs (pollers, agents on a timer) run in ZOREE.
--    - Carriers and rates are per domain; no shared PUBLIC domain yet.
--    - Row ids stay globally unique (primary keys unchanged).
-- ═══════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.domains (
  code        TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_by  TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT domains_code_check CHECK (code ~ '^[A-Z0-9_]{2,32}$')
);

INSERT INTO public.domains (code, name, created_by) VALUES
  ('ZOREE',       'Zoree',                 'migration 052'),
  ('KESTREL_BAY', 'Kestrel Bay Logistics', 'migration 052')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.user_domain_access (
  user_id      UUID        NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  domain_code  TEXT        NOT NULL REFERENCES public.domains(code) ON UPDATE CASCADE,
  is_default   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_by   TEXT        NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, domain_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_domain_default
  ON public.user_domain_access (user_id) WHERE is_default;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','shipments','invoices','carriers','rates','locations',
                           'items','documents','invoice_intakes','email_order_intake','agent_runs']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS domain_code TEXT NOT NULL DEFAULT %L', t, 'ZOREE');
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                   WHERE table_schema = 'public' AND table_name = t AND constraint_name = t || '_domain_code_fkey') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (domain_code) REFERENCES public.domains(code) ON UPDATE CASCADE',
                     t, t || '_domain_code_fkey');
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_domain_created    ON public.orders    (domain_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shipments_domain_created ON public.shipments (domain_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_domain_created  ON public.invoices  (domain_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rates_domain_mode        ON public.rates     (domain_code, mode);
CREATE INDEX IF NOT EXISTS idx_carriers_domain          ON public.carriers  (domain_code);

-- Backfill: Kestrel Bay master data
UPDATE public.carriers SET domain_code = 'KESTREL_BAY', updated_at = NOW() WHERE id LIKE 'CAR-KB-%';
UPDATE public.rates    SET domain_code = 'KESTREL_BAY' WHERE lane LIKE 'KB · %';

-- Backfill: user access
INSERT INTO public.user_domain_access (user_id, domain_code, is_default, created_by)
SELECT id, 'ZOREE', TRUE, 'migration 052' FROM public.user_profiles WHERE COALESCE(disabled, FALSE) = FALSE
ON CONFLICT (user_id, domain_code) DO NOTHING;

INSERT INTO public.user_domain_access (user_id, domain_code, is_default, created_by)
SELECT id, 'KESTREL_BAY', FALSE, 'migration 052' FROM public.user_profiles WHERE lower(email) = 'admin@zoree.io'
ON CONFLICT (user_id, domain_code) DO NOTHING;

ALTER TABLE public.domains            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_domain_access ENABLE ROW LEVEL SECURITY;

COMMIT;

NOTIFY pgrst, 'reload schema';
