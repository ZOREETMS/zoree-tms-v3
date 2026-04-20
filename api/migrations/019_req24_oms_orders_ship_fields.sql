-- Migration: 019_req24_oms_orders_ship_fields
-- Date: 2026-04-20
-- Author: Claude (AI-assisted)
-- Description: REQ-24 (OMS follow-up to migration 018) — the original
--              migration 018 added ship_from_name / ship_to_name to the
--              TMS `orders` and `shipments` tables. This sibling
--              migration adds the same four-field Location shape
--              (name / city / state) to the OMS `oms_orders` table so
--              users can enter a free-text ship-from / ship-to directly
--              in the OMS sales-order modal instead of selecting from
--              the `locations` picker.
--
--              ZIP columns (origin_zip / dest_zip) already exist on
--              oms_orders, so we only add the name / city / state
--              columns here.
--
-- Affected APIs/UI:
--   frontend/zoree-oms.html                           — New Sales Order
--                                                       modal: 4 text
--                                                       inputs per side
--   frontend/services/omsSync/pushOrderService.js     — reads typed
--                                                       values instead
--                                                       of locs[id]
--   api/services/orderIngest.js                       — no change (the
--                                                       TMS side still
--                                                       maps ship_from_name
--                                                       / ship_to_name
--                                                       via migration 018)
--
-- Columns added (IF NOT EXISTS — safe on partially-migrated envs):
--   oms_orders.ship_from_name  TEXT
--   oms_orders.ship_from_city  TEXT
--   oms_orders.ship_from_state TEXT
--   oms_orders.ship_to_name    TEXT
--   oms_orders.ship_to_city    TEXT
--   oms_orders.ship_to_state   TEXT
--
-- Backfill:
--   None. Historical OMS rows keep NULL for the new columns. The OMS
--   UI falls back to parsing origin_location / destination when the
--   new columns are NULL, so existing orders still render.
--
-- Denormalization note:
--   The OMS retains the `origin_location` and `destination` TEXT
--   columns (which currently store a location id / composed address).
--   Those remain the canonical inputs for legacy reporting and the
--   TMS push payload. The new columns are additive and editable, and
--   the UI composes `destination` = "CITY, ST ZIP" at write time from
--   the typed fields. A future migration could deprecate
--   origin_location once all OMS consumers read the new columns.
--
-- Index changes: none — these are label fields, not query keys.
-- Constraint changes: none — free text, nullable.
--
-- Rollback SQL:
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_from_name;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_from_city;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_from_state;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_to_name;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_to_city;
--   ALTER TABLE oms_orders DROP COLUMN IF EXISTS ship_to_state;
--
-- Risks: low — strictly additive, nullable columns.

ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_from_name  TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_from_city  TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_from_state TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_to_name    TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_to_city    TEXT;
ALTER TABLE oms_orders ADD COLUMN IF NOT EXISTS ship_to_state   TEXT;

COMMENT ON COLUMN oms_orders.ship_from_name IS
  'REQ-24: OMS-entered origin location name (free text). Replaces the select-from-locations picker.';
COMMENT ON COLUMN oms_orders.ship_from_city IS
  'REQ-24: OMS-entered origin city. Forms the CITY part of the composed origin_location string.';
COMMENT ON COLUMN oms_orders.ship_from_state IS
  'REQ-24: OMS-entered origin 2-letter state code.';
COMMENT ON COLUMN oms_orders.ship_to_name IS
  'REQ-24: OMS-entered destination location name (free text).';
COMMENT ON COLUMN oms_orders.ship_to_city IS
  'REQ-24: OMS-entered destination city.';
COMMENT ON COLUMN oms_orders.ship_to_state IS
  'REQ-24: OMS-entered destination 2-letter state code.';
