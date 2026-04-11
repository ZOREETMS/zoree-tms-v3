-- Add MBOL/CBOL fields to shipments table
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS master_shipment_id TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS bol_type TEXT DEFAULT 'standard';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS stop_from INTEGER;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS stop_to INTEGER;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS route_template_id TEXT;
