-- ════════════════════════════════════════════════════════════════════
-- Bug #33 verification: OMS ↔ TMS service_level drift check
-- Run against the Supabase project DB. Read-only — no writes.
--
-- Reports any remaining mismatch between oms_orders.service_level and
-- the linked orders.service_level. After the 2026-05-05 backfill, all
-- four queries should return 0 rows (or only canonical values for Q4).
-- ════════════════════════════════════════════════════════════════════

-- ─── Q1. Hard mismatches: both sides have a value, and they differ.
--         Should return 0 rows. ────────────────────────────────────
SELECT
  o.id                AS tms_order_id,
  x.id                AS oms_order_id,
  o.service_level     AS tms_service_level,
  x.service_level     AS oms_service_level,
  o.created_at        AS tms_created_at
FROM   public.orders     o
JOIN   public.oms_orders x ON x.tms_order_id = o.id
WHERE  o.service_level IS NOT NULL
  AND  x.service_level IS NOT NULL
  AND  o.service_level <> x.service_level
ORDER BY o.created_at DESC;

-- ─── Q2. TMS NULL but OMS has a value (replication gap).
--         Should return 0 rows. ────────────────────────────────────
SELECT
  o.id                AS tms_order_id,
  x.id                AS oms_order_id,
  x.service_level     AS oms_service_level,
  o.created_at        AS tms_created_at
FROM   public.orders     o
JOIN   public.oms_orders x ON x.tms_order_id = o.id
WHERE  o.service_level IS NULL
  AND  x.service_level IS NOT NULL
ORDER BY o.created_at DESC;

-- ─── Q3. Legacy / non-canonical literals on either side.
--         Should return 0 rows. ────────────────────────────────────
WITH canonical(value) AS (
  VALUES ('Standard'), ('Expedited'), ('Economy'),
         ('Guaranteed'), ('Time-Critical'), ('White Glove')
)
SELECT 'orders'      AS table_name, id, service_level
FROM   public.orders
WHERE  service_level IS NOT NULL
  AND  service_level NOT IN (SELECT value FROM canonical)
UNION ALL
SELECT 'oms_orders'  AS table_name, id, service_level
FROM   public.oms_orders
WHERE  service_level IS NOT NULL
  AND  service_level NOT IN (SELECT value FROM canonical);

-- ─── Q4. Distribution summary (sanity check).
--         Useful as a one-shot dashboard. ──────────────────────────
SELECT 'orders'     AS table_name,
       COALESCE(service_level, '∅ NULL') AS value,
       COUNT(*)     AS n
FROM   public.orders
GROUP  BY service_level
UNION ALL
SELECT 'oms_orders' AS table_name,
       COALESCE(service_level, '∅ NULL') AS value,
       COUNT(*)     AS n
FROM   public.oms_orders
GROUP  BY service_level
ORDER  BY table_name, n DESC;
