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
