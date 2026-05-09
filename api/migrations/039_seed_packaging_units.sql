-- Migration: 039_seed_packaging_units
-- Date: 2026-05-08
-- Author: Claude (AI-assisted)
-- Description: Bug #172 — packaging_units table was shipping empty,
--              so DB Explorer / Item Master / shipment dimension UIs
--              had no reference data to pick from. This migration
--              seeds the standard set of pallet, tote, drum, carton,
--              and crate sizes used across the plan & ship flows.
--
--              Note: numbered 039 rather than 038 because
--              038_messaging_hub.sql already exists in this branch.
--
-- Schema changes (DDL):
--   None. The packaging_units table already exists; we only INSERT.
--
-- Affected APIs/UI:
--   frontend/src/pages/ItemMasterPage          — dropdowns now populated
--   frontend/src/pages/DbExplorerPage          — packaging_units quick query non-empty
--   mobile/src/screens/items/ItemFormScreen    — packaging picker non-empty
--
-- Backfill / data:
--   This IS the backfill. Idempotent — every row uses ON CONFLICT (id)
--   DO NOTHING so re-running the migration on a tenant that already
--   has these codes is a no-op.
--
-- Index changes: none.
-- Constraint changes: none.
--
-- Rollback SQL:
--   DELETE FROM packaging_units WHERE id IN (
--     'PALLET-48x40','PALLET-48x48','PALLET-48x42','PALLET-EURO',
--     'TOTE-LG','TOTE-SM','DRUM-55GAL','DRUM-30GAL',
--     'CARTON-S','CARTON-M','CARTON-L','CARTON-XL',
--     'CRATE-WOOD','CRATE-PLASTIC','GAYLORD','BAG-FIBC'
--   );
--
-- Risks:
--   Low. ON CONFLICT (id) DO NOTHING means a customer-defined row with
--   the same code wins. Dimensions/weights are industry-standard
--   defaults; tenants who want tighter values just run an UPDATE.

INSERT INTO packaging_units (
  id, description, type, material,
  len, wid, hgt, tare, max_load, stack,
  returnable, nested, hazmat,
  cost, supplier, status
) VALUES
  -- ── Pallets ─────────────────────────────────────────────────
  ('PALLET-48x40', 'GMA Standard Pallet 48x40',          'Pallet',  'Wood',         48, 40, 6, 40,  4600, 1, true,  false, false, 12.50, 'Standard',  'Active'),
  ('PALLET-48x48', 'Square Pallet 48x48',                 'Pallet',  'Wood',         48, 48, 6, 50,  4500, 1, true,  false, false, 14.00, 'Standard',  'Active'),
  ('PALLET-48x42', 'Pharma Pallet 48x42',                 'Pallet',  'Wood',         48, 42, 6, 45,  4400, 1, true,  false, false, 13.25, 'Standard',  'Active'),
  ('PALLET-EURO',  'EURO EPAL 1200x800',                  'Pallet',  'Wood',         47, 31, 6, 55,  3300, 1, true,  false, false, 16.00, 'Euro Pool', 'Active'),

  -- ── Totes ──────────────────────────────────────────────────
  ('TOTE-LG',      'Large Stackable Tote 27x16x12',       'Tote',    'Plastic',      27, 16, 12, 6,   100, 6, true,  true,  false,  9.50, 'Akro-Mils', 'Active'),
  ('TOTE-SM',      'Small Tote 18x12x9',                  'Tote',    'Plastic',      18, 12,  9, 3,    50, 8, true,  true,  false,  4.75, 'Akro-Mils', 'Active'),

  -- ── Drums ──────────────────────────────────────────────────
  ('DRUM-55GAL',   '55-Gallon Steel Drum',                'Drum',    'Steel',        24, 24, 35, 45,  500, 2, true,  false, true,  35.00, 'Greif',     'Active'),
  ('DRUM-30GAL',   '30-Gallon Plastic Drum',              'Drum',    'Plastic',      20, 20, 30, 22,  280, 2, true,  false, true,  22.00, 'Mauser',    'Active'),

  -- ── Cartons ────────────────────────────────────────────────
  ('CARTON-S',     'Small Carton 12x9x6',                 'Carton',  'Corrugated',   12,  9,  6, 1,    35, 4, false, false, false,  0.85, 'Uline',     'Active'),
  ('CARTON-M',     'Medium Carton 18x12x10',              'Carton',  'Corrugated',   18, 12, 10, 2,    65, 4, false, false, false,  1.40, 'Uline',     'Active'),
  ('CARTON-L',     'Large Carton 24x18x12',               'Carton',  'Corrugated',   24, 18, 12, 4,    95, 3, false, false, false,  2.25, 'Uline',     'Active'),
  ('CARTON-XL',    'XL Carton 30x24x18',                  'Carton',  'Corrugated',   30, 24, 18, 6,   140, 2, false, false, false,  3.95, 'Uline',     'Active'),

  -- ── Crates / specialty ─────────────────────────────────────
  ('CRATE-WOOD',    'Wooden Export Crate 48x40x36',       'Crate',   'Wood',         48, 40, 36, 95,  2200, 2, true,  false, false, 78.00, 'Custom',    'Active'),
  ('CRATE-PLASTIC', 'Reusable Plastic Crate 48x40x30',    'Crate',   'Plastic',      48, 40, 30, 60,  1600, 3, true,  true,  false, 55.00, 'Buckhorn',  'Active'),
  ('GAYLORD',       'Triple-Wall Gaylord 48x40x36',       'Bin',     'Corrugated',   48, 40, 36, 28,  1800, 2, false, false, false, 18.50, 'Uline',     'Active'),
  ('BAG-FIBC',      'FIBC Super Sack 35x35x47',           'Bag',     'Polypropylene',35, 35, 47, 5,   2200, 1, false, false, false, 14.75, 'BulkBags',  'Active')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE packaging_units IS
  'Reference data: standard pallet/tote/drum/carton sizes used by Item Master, plan & ship dimensioning, and DB Explorer. Seeded by migration 039. Tenants can add their own rows freely.';
