-- Mirror of api/migrations/029_add_carriers_cost_per_mile.sql
-- See that file for the full 8-item DB-rules header.
-- Adds the cost_per_mile column the CarriersPage form has been emitting
-- since day one, so that POST /api/db/carriers stops failing with
-- "column 'cost_per_mile' does not exist".

ALTER TABLE carriers
  ADD COLUMN IF NOT EXISTS cost_per_mile NUMERIC(10,4) NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'carriers' AND constraint_name = 'carriers_cost_per_mile_check'
  ) THEN
    ALTER TABLE carriers
      ADD CONSTRAINT carriers_cost_per_mile_check
      CHECK (cost_per_mile IS NULL OR cost_per_mile >= 0);
  END IF;
END $$;

COMMENT ON COLUMN carriers.cost_per_mile IS 'Average cost per mile (USD/mi) for the carrier. Surfaced in CarriersPage. NULL/0 means unset.';
