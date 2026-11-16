-- ═══════════════════════════════════════════════════════════════════
-- 048_carriers_capacity_fields.sql — engine capacity + fee inputs
-- ─────────────────────────────────────────────────────────────────────
-- Why: the engine's carriers[] array carries weight_cap_lbs and
-- volume_cap_cuft, and those caps are the only thing that constrains the
-- consolidator. Verified against the vendor's own bundled_300k.json:
-- 6,615 of 13,041 groups exceed 45,000 lbs of payload and 1,491 exceed
-- 80,000 lbs gross, because nothing capped them. carriers.max_weight was
-- NULL for all 11 rows, so the mapper had to skip every carrier.
--
-- Values are NOT invented: they are backfilled from this database's own
-- equipment_types rows by carrier mode —
--   TL  -> DV53 (Dry Van 53ft): 45,000 lbs / 3,800 cu ft
--   LTL -> LTL              :  20,000 lbs / 2,000 cu ft
-- A carrier whose mode matches neither is left NULL on purpose; the
-- mapper skips it with a reason rather than sending it uncapped.
--
-- NOT addressed here: carriers.cost_per_mile is 0.0000 for 10 of 11
-- carriers (only GXO has 2.0). That is real pricing and must come from
-- your rate data or the carrier contracts — seeding a made-up number
-- would silently mis-price every optimization run. The mapper already
-- skips carriers with cost_per_mile <= 0.
--
-- Rollback: columns are nullable additions; DROP COLUMN is safe.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.carriers
  ADD COLUMN IF NOT EXISTS base_fee           numeric(12,2),
  ADD COLUMN IF NOT EXISTS volume_cap_cuft    numeric(12,2),
  ADD COLUMN IF NOT EXISTS transit_multiplier numeric(6,3) NOT NULL DEFAULT 1.0;

ALTER TABLE public.carriers
  ADD CONSTRAINT carriers_base_fee_nonneg           CHECK (base_fee           IS NULL OR base_fee           >= 0) NOT VALID,
  ADD CONSTRAINT carriers_volume_cap_positive       CHECK (volume_cap_cuft    IS NULL OR volume_cap_cuft    >  0) NOT VALID,
  ADD CONSTRAINT carriers_transit_multiplier_range  CHECK (transit_multiplier >  0 AND transit_multiplier <= 10) NOT VALID;

-- Backfill capacity from equipment_types by mode. Only fills NULLs, so
-- re-running never clobbers an operator's manual correction.
UPDATE public.carriers c
SET max_weight      = COALESCE(c.max_weight,      e.max_weight::integer),
    volume_cap_cuft = COALESCE(c.volume_cap_cuft, e.max_volume)
FROM public.equipment_types e
WHERE e.code = CASE upper(c.mode) WHEN 'TL' THEN 'DV53' WHEN 'LTL' THEN 'LTL' END
  AND (c.max_weight IS NULL OR c.volume_cap_cuft IS NULL);

COMMENT ON COLUMN public.carriers.volume_cap_cuft    IS 'Per-load cubic capacity. Backfilled from equipment_types by mode in 048; override per carrier where the real fleet differs.';
COMMENT ON COLUMN public.carriers.base_fee           IS 'Flat per-load fee sent to the quantum engine as carriers[].base_fee. NULL means the mapper sends 0.';
COMMENT ON COLUMN public.carriers.transit_multiplier IS 'Transit-time scaling sent to the engine; 1.0 = baseline.';
