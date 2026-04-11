-- Add missing columns to the locations table for full Location Master functionality
ALTER TABLE locations ADD COLUMN IF NOT EXISTS customer text DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lat numeric DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS lng numeric DEFAULT 0;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS ahphone text DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS hours text DEFAULT '';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS trailer integer DEFAULT 53;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS liftgate text DEFAULT 'No';
ALTER TABLE locations ADD COLUMN IF NOT EXISTS appt boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS hazmat boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS resi boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS inside_delivery boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS sort_segregate boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS twic boolean DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
