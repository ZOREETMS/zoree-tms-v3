-- Migration: 018_req24_ship_from_to_name_columns
-- Date: 2026-04-20
-- Author: Claude (AI-assisted)
-- Description: REQ-24 — ship-from and ship-to on orders and shipments should
--              expose Location Name, City, State, and ZIP as independently
--              editable fields. Previously the OMS / TMS only stored a
--              free-form origin/dest string plus a ZIP; the location name
--              was either lost or smuggled in as a prefix on the origin
--              string ("Dallas Warehouse, Dallas, TX 75207"). This migration
--              gives the name its own column on both tables, and makes sure
--              the companion zip columns exist on shipments (orders already
--              had origin_zip/dest_zip via earlier migrations).
--
-- Affected APIs/UI:
--   frontend/src/pages/OrdersPage.jsx                  — form state + save
--   frontend/src/components/orders/NewOrderModal.jsx   — new-order form
--   frontend/src/components/orders/OrderDetailModal.jsx — edit tab
--   frontend/src/services/ordersService.js             — createNewOrder
--                                                        payload mapping
--   frontend/src/pages/ShipmentsPage.jsx               — shipment detail
--                                                        display + edit
--   frontend/src/services/shipmentService.js           — field passthrough
--   api/services/orderIngest.js                        — already maps
--                                                        ship_from_name /
--                                                        ship_to_name (no
--                                                        change required)
--
-- Columns added (IF NOT EXISTS — safe to run on environments where a
-- subset already exists from earlier ad-hoc fixes):
--   orders.ship_from_name     TEXT
--   orders.ship_to_name       TEXT
--   shipments.ship_from_name  TEXT
--   shipments.ship_to_name    TEXT
--   shipments.origin_zip      TEXT
--   shipments.dest_zip        TEXT
--
-- Backfill:
--   None. Historical rows keep NULL for the new name columns. The UI
--   falls back to parsing the existing origin/dest string if the name
--   column is NULL, so existing orders continue to render correctly.
--
-- Denormalization note (justifies not removing `origin` / `dest`):
--   This migration is additive: it leaves the legacy `origin` / `dest`
--   free-text columns in place. That's a deliberate trade-off against
--   db-rules §"Avoid duplicate sources of truth" — normalizing the
--   address into only {name, city, state, zip} would require touching
--   the planner, BOL generation, route-optimizer, map rendering, and
--   ~20 other code paths that read `origin` / `dest` as "CITY, ST ZIP"
--   strings. That refactor is out of scope for REQ-24 (UI-level
--   request). For now: `origin` / `dest` are treated as *derived*
--   strings composed at write time (see
--   frontend/src/types/location.js → buildAddressString), and
--   `origin_zip` / `dest_zip` / `ship_from_name` / `ship_to_name` are
--   the authoritative inputs. Any future REQ that deprecates `origin`
--   / `dest` should do so via a separate migration + backfill +
--   cross-codebase read-path audit.
--
-- Index changes: none — these are label fields, not query keys.
-- Constraint changes: none — free text, nullable.
--
-- Rollback SQL:
--   ALTER TABLE orders    DROP COLUMN IF EXISTS ship_from_name;
--   ALTER TABLE orders    DROP COLUMN IF EXISTS ship_to_name;
--   ALTER TABLE shipments DROP COLUMN IF EXISTS ship_from_name;
--   ALTER TABLE shipments DROP COLUMN IF EXISTS ship_to_name;
--   ALTER TABLE shipments DROP COLUMN IF EXISTS origin_zip;
--   ALTER TABLE shipments DROP COLUMN IF EXISTS dest_zip;
--
-- Risks: low — strictly additive, nullable columns, no backfill.

ALTER TABLE orders    ADD COLUMN IF NOT EXISTS ship_from_name TEXT;
ALTER TABLE orders    ADD COLUMN IF NOT EXISTS ship_to_name   TEXT;

ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ship_from_name TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ship_to_name   TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS origin_zip     TEXT;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS dest_zip       TEXT;

COMMENT ON COLUMN orders.ship_from_name IS
  'REQ-24: human-friendly origin location name (e.g. "Dallas Warehouse"). Stored independently of the origin address string so the UI can render name / city / state / zip as separate editable fields.';
COMMENT ON COLUMN orders.ship_to_name IS
  'REQ-24: human-friendly destination location name (e.g. "Cisco DC-East"). Stored independently of the dest address string.';
COMMENT ON COLUMN shipments.ship_from_name IS
  'REQ-24: human-friendly origin location name, replicated from the OMS order at shipment creation time and editable on the shipment detail page.';
COMMENT ON COLUMN shipments.ship_to_name IS
  'REQ-24: human-friendly destination location name, replicated from the OMS order at shipment creation time and editable on the shipment detail page.';
COMMENT ON COLUMN shipments.origin_zip IS
  'REQ-24: origin ZIP carried through from the OMS order; editable on the shipment detail page.';
COMMENT ON COLUMN shipments.dest_zip IS
  'REQ-24: destination ZIP carried through from the OMS order; editable on the shipment detail page.';
