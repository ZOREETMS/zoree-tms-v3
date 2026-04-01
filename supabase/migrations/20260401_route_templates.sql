CREATE TABLE IF NOT EXISTS route_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT DEFAULT 'TL',
  carrier TEXT,
  max_weight NUMERIC DEFAULT 44000,
  cost_override NUMERIC,
  status TEXT DEFAULT 'Active',
  notes TEXT,
  stops JSONB NOT NULL DEFAULT '[]',
  total_miles NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
