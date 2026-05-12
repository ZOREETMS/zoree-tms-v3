-- ════════════════════════════════════════════════════════════════════
-- 20260511_items_add_stack_un_haz_class.sql
--
-- Add the three columns the Item Master edit form has always written
-- but the items table never had: stack, un, haz_class. The save path
-- (frontend/src/services/itemMasterPayload.js → buildItemRow) emits
-- these keys; PostgREST currently rejects the whole upsert with
-- PGRST204 ("Could not find the 'fclass' column of 'items' in the
-- schema cache") — but fclass is just the first unknown column it
-- happens to surface. Renaming fclass→freight_class etc. in the
-- payload (separate commit) exposes the next three unknown keys,
-- which are these.
--
-- The form has working UI fields (Max Stack Height, UN Number, Hazmat
-- Class) on ItemMasterPage.jsx lines 779, 793, 794 — adding the
-- columns is the correct fix per the QA-validated form design rather
-- than silently dropping user input on save.
--
-- IMPACT ANALYSIS (per zoree_db_rules.pdf §"Required Output"):
--   1. Schema changes      : ADD COLUMN items.stack     integer DEFAULT 1
--                            ADD COLUMN items.un        text    DEFAULT ''
--                            ADD COLUMN items.haz_class text    DEFAULT ''
--   2. Migration files     : THIS FILE.
--   3. Backfill            : Defaults applied on add; existing rows
--                            receive stack=1, un='', haz_class=''.
--                            No separate UPDATE pass needed.
--   4. Index changes       : NONE. No queries filter on these fields;
--                            they are display/regulatory metadata.
--   5. Constraint changes  : NONE. All three nullable-with-default.
--                            stack uses integer DEFAULT 1 to match the
--                            form's default (EMPTY_ITEM.stack = 1).
--   6. Rollback            : Forward-only per repo convention. To undo:
--                              ALTER TABLE public.items
--                                DROP COLUMN IF EXISTS stack,
--                                DROP COLUMN IF EXISTS un,
--                                DROP COLUMN IF EXISTS haz_class;
--   7. Affected UI / API   : Item Master page edit form (save path) —
--                            stops failing with PGRST204 once the
--                            companion payload-fix lands. No read-side
--                            changes required: ItemMasterPage already
--                            reads these keys directly (it.stack,
--                            editItem.un, editItem.haz_class).
--   8. Risks / assumptions :
--        - IF NOT EXISTS makes this idempotent; safe to re-run.
--        - No existing rows have these columns, so defaults populate
--          on add and no historic data is overwritten.
--        - REQ-02 audit pipeline (genericTableAudit) writes via the
--          /api/db generic endpoint — column-additions don't require
--          audit-pipeline changes; the audit row captures the full
--          before/after JSON regardless of which keys are present.
--        - oms_inventory carries its own hazmat metadata fields and
--          is unaffected by this change.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS stack     integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS un        text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS haz_class text    DEFAULT '';

COMMENT ON COLUMN public.items.stack
  IS 'Max stack height (units) — written by Item Master form (REQ-IM-stack).';
COMMENT ON COLUMN public.items.un
  IS 'UN number for hazmat-regulated items (e.g. "UN3480"). Empty for non-hazmat rows.';
COMMENT ON COLUMN public.items.haz_class
  IS 'Hazmat classification code (e.g. "9" for lithium batteries). Empty for non-hazmat rows.';
