-- =============================================================================
-- Migration: 20260426_oms_orders_strip_po_copy_suffix
-- Purpose:   Strip accumulated " (copy)" / " (copy) (copy) ..." suffixes from
--            oms_orders.po_number that were appended every time an order was
--            duplicated via the legacy OMS "Copy order" action.
-- =============================================================================
--
-- Schema Changes: None (data-only cleanup).
--
-- Data Changes:
--   - For every oms_orders row whose po_number ends with one or more
--     " (copy)" tokens (case-insensitive, any number of repetitions),
--     trim ALL trailing " (copy)" tokens and any residual whitespace.
--   - Empty strings remain empty; NULLs are untouched.
--
-- Code Fix (companion, landed in this changeset):
--   - frontend/zoree-oms.html  copyOrder() no longer appends " (copy)" to
--     the PO of the new draft. The new order keeps the source PO verbatim
--     so the user can edit it before booking.
--
-- Rollback:
--   Not reversible — the original suffix carried no semantic information
--   (it was a UI artifact of how many times the order was duplicated).
--   A manual restore would only reintroduce the defect this migration
--   removes.
--
-- Affected APIs/Services/UI:
--   - UI: frontend/zoree-oms.html Sales Orders grid (PO column under
--          ORD-### in the order list) — values display without the
--          trailing "(copy)" tokens after this migration.
--   - API/services: read-only impact; no contract changes.
--
-- Risks/Assumptions:
--   - Regex anchors on the END of the string only, so a PO that legitimately
--     contains the substring "(copy)" in the middle (e.g. "PO (copy of 7)")
--     is NOT mutated — only trailing repetitions are stripped.
--   - Match is case-insensitive to catch "(Copy)" / "(COPY)" variants
--     should they exist.
-- =============================================================================

update public.oms_orders
   set po_number = nullif(
                     regexp_replace(
                       po_number,
                       '(\s*\(copy\))+\s*$',
                       '',
                       'gi'
                     ),
                     ''
                   )
 where po_number ~* '(\s*\(copy\))+\s*$';
