-- ============================================================
-- Migration: Enforce controlled status values for orders/shipments
-- Description: Adds deployment-safe check constraints with backfill for null/blank statuses
-- Date: 2026-04-13
-- Affected: Orders page, Shipments page, bulk planning services
-- Rollback/Fallback: Drop constraints and defaults if rollback is required
-- ============================================================

-- Backfill null/blank statuses to safe defaults before constraints
UPDATE orders
SET status = 'Unplanned',
    updated_at = now()
WHERE status IS NULL OR btrim(status) = '';

-- Normalize common legacy/variant order statuses before adding constraints
UPDATE orders
SET status = CASE
  WHEN lower(btrim(status)) IN ('unplanned', 'new', 'open', 'pending plan', 'pending planning') THEN 'Unplanned'
  WHEN lower(btrim(status)) IN ('planned', 'plan complete') THEN 'Planned'
  WHEN lower(btrim(status)) IN ('consolidated', 'grouped') THEN 'Consolidated'
  WHEN lower(btrim(status)) IN ('tendered', 'tender sent') THEN 'Tendered'
  WHEN lower(btrim(status)) IN ('in transit', 'in_transit', 'intransit', 'dispatched') THEN 'In Transit'
  WHEN lower(btrim(status)) IN ('delivered', 'complete', 'completed', 'closed') THEN 'Delivered'
  WHEN lower(btrim(status)) IN ('planning failed', 'planning_failed', 'failed planning') THEN 'Planning Failed'
  WHEN lower(btrim(status)) IN ('cancelled', 'canceled') THEN 'Cancelled'
  WHEN lower(btrim(status)) IN ('exception', 'error') THEN 'Exception'
  ELSE status
END,
updated_at = now();

UPDATE shipments
SET status = 'Planned',
    updated_at = now()
WHERE status IS NULL OR btrim(status) = '';

-- Normalize common legacy/variant shipment statuses before constraints
UPDATE shipments
SET status = CASE
  WHEN lower(btrim(status)) IN ('planned', 'new', 'open') THEN 'Planned'
  WHEN lower(btrim(status)) IN ('consolidated', 'grouped') THEN 'Consolidated'
  WHEN lower(btrim(status)) IN ('tendered', 'tender sent') THEN 'Tendered'
  WHEN lower(btrim(status)) IN ('in transit', 'in_transit', 'intransit', 'dispatched') THEN 'In Transit'
  WHEN lower(btrim(status)) IN ('delivered', 'complete', 'completed', 'closed') THEN 'Delivered'
  WHEN lower(btrim(status)) IN ('cancelled', 'canceled') THEN 'Cancelled'
  WHEN lower(btrim(status)) IN ('exception', 'error') THEN 'Exception'
  ELSE status
END,
updated_at = now();

-- Set defaults for new rows
ALTER TABLE orders
  ALTER COLUMN status SET DEFAULT 'Unplanned';

ALTER TABLE shipments
  ALTER COLUMN status SET DEFAULT 'Planned';

-- Controlled values for order status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_orders_status_controlled') THEN
    ALTER TABLE orders
      ADD CONSTRAINT chk_orders_status_controlled
      CHECK (
        status IN (
          'Unplanned',
          'Planned',
          'Consolidated',
          'Tendered',
          'In Transit',
          'Delivered',
          'Planning Failed',
          'Cancelled',
          'Exception'
        )
      ) NOT VALID;
  END IF;
END $$;

-- Controlled values for shipment status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_shipments_status_controlled') THEN
    ALTER TABLE shipments
      ADD CONSTRAINT chk_shipments_status_controlled
      CHECK (
        status IN (
          'Planned',
          'Consolidated',
          'Tendered',
          'In Transit',
          'Delivered',
          'Cancelled',
          'Exception'
        )
      ) NOT VALID;
  END IF;
END $$;

-- Validate now that null/blank values are backfilled.
-- If there are other out-of-spec values, validation fails safely and can be cleaned up separately.
ALTER TABLE orders VALIDATE CONSTRAINT chk_orders_status_controlled;
ALTER TABLE shipments VALIDATE CONSTRAINT chk_shipments_status_controlled;
