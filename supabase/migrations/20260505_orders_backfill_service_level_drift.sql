-- ════════════════════════════════════════════════════════════════════
-- Migration: orders — backfill TMS service_level drift
-- Date:      2026-05-05
-- Bug:       #33 follow-up (OMS Service Level not replicated to TMS)
--
-- Background
--   The OMS column was renamed `priority → service_level` and the OMS
--   form now writes the canonical TMS vocabulary. But TMS-side rows
--   created BEFORE that pipeline was complete have lingering drift:
--     • 7 orders with NULL service_level despite the linked OMS row
--       carrying a non-Standard value, because the historical
--       OMS→TMS push didn't always forward the field.
--     • 3 orders carrying the legacy literal `Expedite` (the OMS form
--       value before normalization landed) instead of the canonical
--       `Expedited`.
--   Shipments are clean (no drift detected). The drift is order-side
--   only.
--
-- Fix
--   Single forward-only data migration:
--     1. Copy non-NULL OMS service_level into TMS orders.service_level
--        where TMS is currently NULL.
--     2. Normalize legacy literals: `Expedite` → `Expedited`,
--        defensive `Critical` → `Time-Critical` (mirrors the same
--        translation applied to oms_orders in
--        20260505_oms_orders_priority_canonical_values.sql).
--
-- Forward-only: no down migration. The legacy literals are not on the
-- canonical vocabulary list and reverting would re-introduce the
-- normalization gap.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Pull through OMS service_level for TMS orders that currently have
--    NULL but where the linked oms_orders row has a value.
UPDATE public.orders o
   SET service_level = x.service_level,
       updated_at    = now()
  FROM public.oms_orders x
 WHERE x.tms_order_id    = o.id
   AND o.service_level   IS NULL
   AND x.service_level   IS NOT NULL;

-- 2. Normalize legacy literals to the canonical TMS vocabulary.
--    Mirrors the OMS-side rename so both sides agree.
UPDATE public.orders
   SET service_level = 'Expedited',
       updated_at    = now()
 WHERE service_level = 'Expedite';

UPDATE public.orders
   SET service_level = 'Time-Critical',
       updated_at    = now()
 WHERE service_level = 'Critical';

COMMIT;

-- Post-migration verification (run manually if needed):
--   SELECT service_level, COUNT(*) FROM public.orders GROUP BY service_level ORDER BY 2 DESC;
--   -- Expect canonical values only — no 'Expedite' or 'Critical', no
--   -- NULL where the OMS counterpart has a value.
