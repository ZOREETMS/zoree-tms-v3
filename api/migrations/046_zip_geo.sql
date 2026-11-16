-- ═══════════════════════════════════════════════════════════════════
-- 046_zip_geo.sql — US ZIP → coordinate / state reference
-- ─────────────────────────────────────────────────────────────────────
-- Why: the Otodus Quantum engine requires origin/destination lat-lon and
-- a region label on every shipment. Zoree had no source for either:
-- `locations` carries lat/lng but only 1 of 1,113 orders has both
-- location ids, while 984 of 1,113 carry both zips. This table makes the
-- zip path viable and is consumed by api/services/quantumEngineMapper.js
-- (via an injected resolveGeo) and api/constants/usRegions.js.
--
-- Source: US ZIP centroid dataset (active US ZIPs with coordinates),
-- 41,387 rows. Centroids are approximations — good for regional
-- clustering and consolidation grouping, NOT for door-to-door mileage.
-- Real mileage (shipments.miles / PC*Miler) must always win; the mapper
-- already prefers it and only falls back to haversine x circuity here.
--
-- Reference data, not transactional: no tenant_id. Forward-only, additive.
-- Rollback: DROP TABLE public.zip_geo (nothing else reads it yet).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.zip_geo (
  zip         text PRIMARY KEY,
  lat         numeric(9,6)  NOT NULL,
  lng         numeric(9,6)  NOT NULL,
  city        text,
  state       char(2)       NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  updated_at  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT zip_geo_lat_range CHECK (lat  BETWEEN -90  AND 90),
  CONSTRAINT zip_geo_lng_range CHECK (lng  BETWEEN -180 AND 180),
  CONSTRAINT zip_geo_zip_format CHECK (zip ~ '^[0-9]{5}$')
);

COMMENT ON TABLE  public.zip_geo IS 'US ZIP centroid reference for quantum engine geo mapping. Approximate centroids — not for door-to-door mileage.';
COMMENT ON COLUMN public.zip_geo.state IS 'Two-letter code; maps to engine region via api/constants/usRegions.js. Territories (PR/VI/GU) and military (AA/AE/AP) intentionally map to no region so the mapper skips them loudly.';

-- No secondary indexes: the only access pattern is lookup by zip (the PK).
