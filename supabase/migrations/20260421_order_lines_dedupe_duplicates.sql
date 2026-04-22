-- =============================================================================
-- Migration: 20260421_order_lines_dedupe_duplicates
-- Purpose:   Remove duplicate order_lines rows created by ID-format drift
--            between the TMS API (`ORD-XXX-L001`, zero-padded) and the OMS
--            sync writer (`ORD-XXX-L1`, unpadded). Both writers upsert with
--            onConflict:'id' so mismatched IDs insert a second row instead
--            of updating one, violating the logical key (order_id,line_num).
-- =============================================================================
--
-- Schema Changes: None (data-only dedupe).
--
-- Data Changes:
--   - Delete the unpadded `Lx` row from each (order_id,line_num) pair where
--     BOTH copies have identical item_id, qty_ordered, unit_weight,
--     total_weight, and description. The padded `Lxxx` row is the canonical
--     form used by every writer after this migration.
--
-- Known Exclusions (handled in a separate follow-up):
--   - 4 orders have divergent data between the padded and unpadded copies
--     (ORD-090387 L1, ORD-168059 L1, ORD-725882 L1, ORD-786747 L1). These
--     require a manual decision on which row wins and are intentionally
--     NOT touched by this migration. A UNIQUE(order_id,line_num) constraint
--     will be added in a follow-up once those rows are resolved.
--
-- Code Fix (companion, already landed in this changeset):
--   - api/services/orderLineIds.js          (NEW — canonical builder)
--   - api/server.js                          (uses helper)
--   - api/services/orderIngest.js            (uses helper)
--   - frontend/services/omsSync/pushOrderService.js (aligns to padded format)
--
-- Rollback:
--   Not reversible — the deleted rows were exact duplicates of the retained
--   rows (verified pre-migration). A manual restore would reintroduce the
--   defect.
--
-- Affected APIs/Services/UI:
--   - UI: ShipmentsPage line-items table no longer shows duplicate lines
--   - API: POST /api/orders/:id/lines, POST /api/ingest/orders (orderIngest)
--   - Sync: ZoreeMW.services.omsSync.pushOrder
--
-- Risks/Assumptions:
--   - Dedupe predicate requires ALL of (item_id, qty_ordered, unit_weight,
--     total_weight, description) to match between padded/unpadded copies.
--     Any row where they differ is left intact.
-- =============================================================================

delete from public.order_lines u
using public.order_lines p
where u.order_id    = p.order_id
  and u.line_num    = p.line_num
  and u.id         <> p.id
  and u.id          ~ '-L[0-9]+$'
  and u.id         !~ '-L[0-9]{3}$'                -- u is the unpadded copy
  and p.id          ~ '-L[0-9]{3}$'                -- p is the padded canonical
  and coalesce(u.item_id,'')     = coalesce(p.item_id,'')
  and coalesce(u.description,'') = coalesce(p.description,'')
  and u.qty_ordered              = p.qty_ordered
  and u.unit_weight              = p.unit_weight
  and u.total_weight             = p.total_weight;
