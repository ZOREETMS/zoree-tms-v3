-- Migration: 020_req24_drop_origin_location_fk
-- Date: 2026-04-20
-- Author: Claude (AI-assisted)
-- Description: REQ-24 (OMS follow-up to migrations 018/019) — remove the
--              foreign key constraint on oms_orders.origin_location so
--              that column can hold the free-text composed address
--              string ("CITY, ST ZIP") produced by the typed Ship From
--              fields. Before REQ-24 this column held a location id
--              (e.g. "LOC-ATL-01") that referenced a row in the
--              `locations` table; the picker UX is gone, so the FK
--              now blocks every new order entered via the typed inputs.
--
--              The destination column already behaves as free text
--              (no FK), so this change brings origin_location into
--              line with it.
--
-- Affected APIs/UI:
--   frontend/zoree-oms.html                           — already writes
--                                                       the composed
--                                                       address string
--   frontend/services/omsSync/pushOrderService.js     — already falls
--                                                       back to the
--                                                       legacy
--                                                       locations
--                                                       lookup only
--                                                       when the typed
--                                                       ship_from_*
--                                                       columns are
--                                                       empty, so
--                                                       historical
--                                                       rows continue
--                                                       to resolve.
--
-- Backfill:
--   None. Existing rows keep their current origin_location values
--   (location ids on pre-REQ-24 rows, free text on new rows).
--
-- Rollback SQL (only safe if all new-style rows are first replaced
-- with location ids that exist in the locations table — otherwise
-- re-adding the FK will fail on orphan rows):
--   ALTER TABLE oms_orders
--     ADD CONSTRAINT oms_orders_origin_location_fkey
--     FOREIGN KEY (origin_location) REFERENCES locations(id);
--
-- Risks: low. `locations` table is untouched; only the referential
-- constraint on oms_orders.origin_location is dropped. Any reporting
-- query that joined oms_orders → locations on origin_location still
-- works the same way (PostgreSQL doesn't require a FK to allow joins)
-- but will return no rows for new REQ-24 orders where origin_location
-- holds free text. That's the intended behavior.

ALTER TABLE oms_orders
  DROP CONSTRAINT IF EXISTS oms_orders_origin_location_fkey;

COMMENT ON COLUMN oms_orders.origin_location IS
  'REQ-24: free-text composed origin address string ("CITY, ST ZIP"). '
  'Historically held a location id referencing locations(id); after '
  'migration 020 this column is no longer constrained and mirrors the '
  'free-text behavior of destination. The canonical typed parts live '
  'in ship_from_name / ship_from_city / ship_from_state / origin_zip '
  '(migration 019).';
