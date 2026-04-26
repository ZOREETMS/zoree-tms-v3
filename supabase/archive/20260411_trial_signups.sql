-- ═══════════════════════════════════════════════════════════════════
-- ⚠ ARCHIVED — DO NOT RUN
-- Moved out of supabase/migrations/ on 2026-04-25.
-- Status: NEVER applied (was not registered in
--         supabase_migrations.schema_migrations and the policies it
--         creates do not exist in the live DB). The trial_signups
--         table itself was created by another path (likely an api/
--         migrations/ run or manual DDL); only the RLS portion was
--         missing.
-- Superseded by: supabase/migrations/20260425_fix_rls_advisor_errors.sql
--                — see the trial_signups section, which enables RLS
--                + adds service_role_only and anon_insert policies
--                using a `DROP POLICY IF EXISTS` pattern for re-runnability.
-- Kept here for historical reference only.
-- ═══════════════════════════════════════════════════════════════════

-- Trial signups from marketing landing page
-- Stores lead data, triggers email notifications via API endpoint

CREATE TABLE IF NOT EXISTS trial_signups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  monthly_shipments TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'active', 'expired', 'converted')),
  source TEXT DEFAULT 'landing_page',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_signups_email ON trial_signups(email);
CREATE INDEX IF NOT EXISTS idx_trial_signups_status ON trial_signups(status);
CREATE INDEX IF NOT EXISTS idx_trial_signups_created ON trial_signups(created_at DESC);

-- RLS: service role can do everything, anon can only insert
ALTER TABLE trial_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON trial_signups
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Anon can insert" ON trial_signups
  FOR INSERT WITH CHECK (true);
