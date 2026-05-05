-- Migration: 034_orders_add_ref_num
-- Date:      2026-05-04
-- Author:    Claude (AI-assisted)
-- Feature:   Add the user-editable Reference # column to `orders`
--            (TMS bug #2 — History tab missing Reference # / PO Number /
--             Service Level edits).
--
-- Purpose
-- ───────
-- The Order Detail "Edit" tab has shipped with a Reference # input for
-- several iterations and the entire stack was wired up to persist + audit
-- it:
--
--   • frontend/src/pages/OrdersPage.jsx#saveOrderEdit
--       sends `ref_num` in the PATCH /api/orders/:id body (line 613)
--   • api/services/orderMutations.js#apiOrderToDbPatch
--       maps `refNum` / `ref_num` → `patch.ref_num` (line 25)
--   • api/server.js#ORDER_HISTORY_FIELDS
--       lists `ref_num` (alongside `po_number`, `service_level`) so
--       recordFieldDiffs writes an audit row when it changes (line 52)
--   • frontend/src/services/historyService.js
--       maps `ref_num` → "Reference #" label in the History tab (line 30)
--
-- BUT the `orders` table never had a `ref_num` column — the migration to
-- add it was missed when the previous bug-fix landed (only the audit map
-- and the patch builder were updated). As a result every PATCH
-- /api/orders/:id included `ref_num: <value or null>`, PostgREST returned
--   400 — column "ref_num" of relation "orders" does not exist
-- and `dbUpdate` threw. The endpoint returned 500, the optimistic UI
-- merged the form values into the modal anyway (so the user thought the
-- save worked), but no row was actually updated and `recordFieldDiffs`
-- never ran. Knock-on: NONE of the three fields (Reference #, PO Number,
-- Service Level) landed in `change_history`, even though only `ref_num`
-- is the "missing" column — the other two were collateral damage from
-- the failed PATCH. That is the user-visible "History tab is missing
-- edits" symptom.
--
-- Fix: add the column. After this migration the existing code paths
-- (which all already speak `ref_num`) start working unchanged.
--
-- ───────────────────────────────────────────────────────────────
-- 1. SCHEMA CHANGES
-- ───────────────────────────────────────────────────────────────
--   orders.ref_num   TEXT  (nullable, free-text)
--
--   Free-text mirrors the sibling columns (`po_number`, `bol_number`,
--   `pro_number`) — those are also TEXT/nullable with no constraint, so
--   `ref_num` joins them rather than introducing a new pattern.
--
--   Distinct from `orders.oms_order_ref` (added in 005_add_oms_sync_…),
--   which holds the upstream OMS order identifier and is NOT
--   user-editable. `ref_num` is purely a user-facing label.
--
-- ───────────────────────────────────────────────────────────────
-- 2. BACKFILL
-- ───────────────────────────────────────────────────────────────
--   None. Pre-existing orders have no historical Reference # to recover
--   (the column never existed); they correctly stay NULL until edited.
--   The History tab will start recording diffs from the first edit
--   after this migration runs — which is the desired behaviour for an
--   audit ledger. Re-running this migration is a no-op (`IF NOT EXISTS`).
--
-- ───────────────────────────────────────────────────────────────
-- 3. INDEX CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. `ref_num` is for display + audit, not a query predicate. The
--   sibling text columns (`po_number`, `bol_number`, `pro_number`) are
--   also unindexed; matching that convention. If reporting later
--   requires lookup by ref_num, add a partial index in a follow-up
--   migration.
--
-- ───────────────────────────────────────────────────────────────
-- 4. CONSTRAINT CHANGES
-- ───────────────────────────────────────────────────────────────
--   None. Free-text TEXT, nullable, no UNIQUE or FK — Reference # is a
--   user-supplied identifier (often an external customer's reference)
--   and may legitimately repeat across orders.
--
-- ───────────────────────────────────────────────────────────────
-- 5. AFFECTED APIs / SERVICES / UI
-- ───────────────────────────────────────────────────────────────
--   No code changes required. The following call sites already speak
--   `ref_num` and just need the column to exist:
--
--   API:
--     • PATCH /api/orders/:id (api/server.js)
--         — apiOrderToDbPatch already maps the body, ORDER_HISTORY_FIELDS
--           already includes ref_num for recordFieldDiffs.
--     • POST  /api/orders     (api/server.js)
--         — same apiOrderToDbPatch path.
--     • api/services/orderIngest.js
--         — OMS → TMS mapper already passes ref_num through where the
--           OMS payload carries it.
--   Frontend:
--     • frontend/src/pages/OrdersPage.jsx
--         — `saveOrderEdit` sends `ref_num`; `editForm` hydrates from
--           `o.ref_num`; `createOrder` sends `ref_num`.
--     • frontend/src/components/orders/OrderDetailModal.jsx
--         — read view shows `o.ref_num`; edit view binds to
--           `editForm.refNum`.
--     • frontend/src/components/orders/NewOrderModal.jsx
--         — new-order form already has the Reference # input.
--     • frontend/src/components/bulk-plan/OrderEditModal.jsx
--         — bulk-plan inline editor already binds Reference #.
--     • frontend/src/services/historyService.js
--         — `ref_num: "Reference #"` label map for the History tab.
--
-- ───────────────────────────────────────────────────────────────
-- 6. ROLLBACK (break-glass only — migrations are forward-only)
-- ───────────────────────────────────────────────────────────────
--   ALTER TABLE orders DROP COLUMN IF EXISTS ref_num;
--
-- ───────────────────────────────────────────────────────────────
-- 7. RISKS & ASSUMPTIONS
-- ───────────────────────────────────────────────────────────────
--   • Additive, nullable column — zero risk to existing reads/writes.
--     PostgREST schema cache refreshes automatically; no service restart
--     strictly required.
--   • No backfill, so legacy rows render Reference # = "" in the modal
--     (consistent with current behaviour — they were always empty).
--   • Edits made AFTER this migration produce one `change_history` row
--     per changed field (`ref_num`, `po_number`, `service_level`) via
--     the existing recordFieldDiffs writer; no audit-side changes.
--   • Idempotent. Already applied in production via the Supabase MCP
--     (supabase_migrations.schema_migrations entries
--     `033_orders_add_ref_num` and `033_add_ref_num_to_orders` — both
--     ran the same `ALTER TABLE … IF NOT EXISTS` against `orders.ref_num`
--     during the bug-fix session on 2026-05-04). This file is the
--     in-repo file-of-record for that schema change so the
--     api/migrations/ directory remains the single source of truth
--     (CLAUDE_RULES — DB rules: "all schema changes go through migration
--     files — never ad hoc").

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS ref_num TEXT;

COMMENT ON COLUMN orders.ref_num IS
  'User-editable Reference # (free-text). Surfaced in the Order Detail '
  'Edit tab and audited by api/server.js#ORDER_HISTORY_FIELDS via '
  'recordFieldDiffs. Mirrors the sibling text columns po_number / '
  'bol_number / pro_number — nullable, no uniqueness constraint, no '
  'index. Distinct from oms_order_ref (the upstream OMS traceability '
  'ID, not user-editable). Added in migration 034 to fix the History '
  'tab gap where Reference # / PO Number / Service Level edits were '
  'silently dropped because the PATCH body always included ref_num and '
  'PostgREST rejected the whole request.';

COMMIT;

-- Verification (run separately after applying):
--   -- 1. Column exists and is nullable.
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND table_name   = 'orders'
--      AND column_name  = 'ref_num';
--
--   -- 2. End-to-end: PATCH an order's ref_num via the TMS API and
--   --    confirm a change_history row was written.
--   --    (Run from the app — not from SQL — so the recordFieldDiffs
--   --     writer fires.)
--   SELECT entity_id, field, old_value, new_value, username, created_at
--     FROM change_history
--    WHERE entity_type = 'order'
--      AND field       IN ('ref_num', 'po_number', 'service_level')
--    ORDER BY created_at DESC
--    LIMIT 10;
