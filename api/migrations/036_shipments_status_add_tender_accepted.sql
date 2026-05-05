-- Migration: 036_shipments_status_add_tender_accepted
-- Date: 2026-05-05
-- Author: Claude (AI-assisted)
-- Target DB: Supabase project hosting `shipments`.
--
-- Description:
--   QA #61 ("Tender Accepted shows on Order but not Shipment"):
--   on accept, the mobile carrier-portal flow keeps shipment status
--   at 'Tendered' because it cannot write 'Tender Accepted' (see the
--   workaround comment at api/server.js:1198). The result is an Order
--   row at 'Tender Accepted' paired with a Shipment row still at
--   'Tendered' — exactly the desync QA reports.
--
--   The existing CHECK constraint `chk_shipments_status_controlled`
--   whitelists a fixed set of shipment statuses and rejects new ones.
--   This migration widens it by exactly one value: 'Tender Accepted'.
--   Strictly additive — existing rows are unaffected and no other
--   code path needs to change to remain correct.
--
-- Schema changes:
--   - DROP + recreate `chk_shipments_status_controlled` with
--     'Tender Accepted' added to the whitelist.
--
-- Migration files:
--   - This file (forward-only).
--
-- Backfill / data migration needs:
--   None. No existing rows hold the new value; the runtime code
--   change in the same commit will start writing it.
--
-- Index changes:    None.
-- Constraint changes:
--   - chk_shipments_status_controlled: drop + recreate with one new
--     value. We DROP IF EXISTS first because the constraint was
--     created in an earlier (collapsed) migration — the repo
--     references it by name at api/server.js:1198 but the original
--     DDL is not committed to api/migrations/.
--
-- Rollback considerations:
--   Forward-only per the project DB rules. To revert, run:
--
--     ALTER TABLE shipments DROP CONSTRAINT IF EXISTS chk_shipments_status_controlled;
--     ALTER TABLE shipments
--       ADD CONSTRAINT chk_shipments_status_controlled
--       CHECK (status IN (
--         'Planned','Tendered','Confirmed','In Transit',
--         'Delivered','Cancelled','Exception','Tender Rejected'
--       ));
--
--   If any rows have meanwhile been written with the new value, the
--   rollback will fail until they are re-mapped (e.g. 'Tender
--   Accepted' → 'Tendered').
--
-- Affected APIs/services/UI:
--   api/routes/shipments.js                  — extend VALID list in
--                                               PATCH /:id/status to
--                                               accept 'Tender
--                                               Accepted'
--   mobile/src/services/carrierPortalService.ts
--                                            — saveTenderResponse
--                                              now writes 'Tender
--                                              Accepted' on accept
--                                              (was 'Tendered')
--   api/server.js                            — the 'Confirmed' →
--                                              'Tendered' workaround
--                                              at line ~1198 can be
--                                              re-evaluated after
--                                              this lands but is left
--                                              alone here to keep the
--                                              migration purely
--                                              additive.
--
-- Risks / assumptions:
--   - We assume the live constraint matches the runtime VALID list at
--     api/routes/shipments.js (the 7 values in the rollback DDL
--     above). If the deployed constraint is narrower the migration
--     still succeeds (DROP IF EXISTS + recreate); if it is wider the
--     recreate will trip on existing rows and the migration will fail
--     loudly — preferable to silently masking a data-quality issue.
--   - Low risk: strictly additive whitelist expansion.

BEGIN;

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS chk_shipments_status_controlled;

ALTER TABLE shipments
  ADD CONSTRAINT chk_shipments_status_controlled
  CHECK (status IN (
    'Planned',
    'Tendered',
    'Tender Accepted',     -- QA #61
    'Tender Rejected',
    'Confirmed',
    'In Transit',
    'Delivered',
    'Cancelled',
    'Exception'
  ));

COMMIT;
