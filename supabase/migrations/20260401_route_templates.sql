CREATE TABLE IF NOT EXISTS route_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT DEFAULT 'TL',
  carrier TEXT,
  max_weight NUMERIC DEFAULT 44000,
  cost_override NUMERIC,
  miles_override NUMERIC,
  transit_days NUMERIC,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  stops JSONB NOT NULL DEFAULT '[]',
  total_miles NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS but allow all authenticated access
ALTER TABLE route_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access" ON route_templates FOR ALL USING (true) WITH CHECK (true);
