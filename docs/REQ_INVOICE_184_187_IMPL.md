# Invoicing Issues 184–187 — Implementation Steps

Per `docs/CLAUDE_RULES.md` (modular layers, services-first) and `docs/zoree_db_rules.pdf` (versioned migrations + 8-item checklist). This document is the design contract that the code changes below must satisfy. Each issue has its own section followed by the file-by-file delivery plan.

Sample data referenced by issue 185: shipment `SHP-2026-273786`, invoice `INV-15573`.

---

## Current state (audit)

- `invoices` table (migration 008) has `shipment_id`, `shipment_ids[]`, `agreed_cost`, `invoiced_amount`, `status` (CHECK includes `'On Hold'`). It does **not** have `bol_ids`.
- No child cost-line table — only the two scalars `agreed_cost` and `invoiced_amount`.
- `submitInvoice` (api/services/invoiceAudit.js) is the single writer. It runs `decide()` and forces an Approved/Rejected outcome based on tolerance — there is no "create as On Hold for review" path.
- The Shipments page already has a 🧾 Invoice button (`ShipmentsPage.jsx` lines 760, 1663) but it just navigates to `/freight-invoices?shipment=<id>`, which auto-opens the **New Invoice modal** for the user to fill in. That is exactly what issue 184 says to remove.
- Shipment cost shape: `shipments.rate`, `shipments.fuel_surcharge`, `shipments.accessorials`, `shipments.total_cost`, `shipments.bol_number`.

Highest existing migration: `api/migrations/041_*` and `supabase/migrations/20260509_*`. Next API migration is **042**.

---

## Issue 184 — Invoice button auto-creates the invoice

**Behavior change.** When the planner clicks 🧾 Invoice on a shipment, the server creates the invoice in one shot using shipment data. The user is taken to the invoice in view/edit mode. The Freight Invoices page must stop popping the "New Invoice" form on `?shipment=<id>`.

**Idempotency.** If the shipment already has an open (non-Cancelled) invoice, the button reuses it instead of creating a duplicate.

## Issue 185 — Invoice inherits shipment costs and starts On Hold

The auto-created invoice copies `rate`, `fuel_surcharge`, `accessorials`, `total_cost` from the shipment into structured cost lines (see issue 186) and sets `status = 'On Hold'`. The tolerance/decide() path is **bypassed** for direct-from-shipment invoices — there is no carrier variance to compute when the costs are sourced from the shipment itself. Finance approves or rejects later from the invoice page, which goes through the existing `manualDecide` path.

## Issue 186 — Invoice cost vs approved cost per line

New child table `invoice_cost_lines`:

| column | type | notes |
|---|---|---|
| id | UUID PK | |
| invoice_id | TEXT NOT NULL | FK → invoices.id, ON DELETE CASCADE |
| cost_type | TEXT NOT NULL | CHECK in (`base`, `fuel_surcharge`, `accessorial`, `discount`, `other`) |
| description | TEXT | required when cost_type IN (`accessorial`, `other`) |
| invoice_cost | NUMERIC(12,2) NOT NULL | what carrier sent (or shipment cost for direct create) |
| approved_cost | NUMERIC(12,2) NOT NULL | defaults to invoice_cost |
| line_order | INT NOT NULL DEFAULT 0 | stable display order |
| tenant_id | TEXT | |
| created_at, updated_at | TIMESTAMPTZ | |

UI: each cost row shows two columns — Invoice Cost (read-only) and Approved Cost (editable, defaulted to Invoice Cost). Editing the approved cost goes through `PATCH /api/invoices/:id/cost-lines/:lineId` which calls `recordFieldDiffs` (REQ-02).

## Issue 187 — shipment_id + BOL ids on every invoice

- Add `bol_ids TEXT[]` to `invoices` (next to existing `shipment_id` and `shipment_ids`).
- Direct-from-shipment invoices populate `bol_ids` from the linked shipment(s)' `bol_number`. MBOL parents bring along their CBOL children's BOLs.
- Carrier-submitted invoices: when both `shipmentId` and `bolId` are provided, the service verifies that the BOL on file for that shipment matches before running the cost decision. Mismatch → invoice is created in status `Rejected` with reason `"BOL on submitted invoice does not match shipment of record."`

---

## DB change checklist (rule 8 of zoree_db_rules.pdf)

1. **Schema changes.** Add column `invoices.bol_ids TEXT[]`. Create table `invoice_cost_lines`. No drops.
2. **Migration files.** `api/migrations/042_invoice_cost_lines_and_bol.sql` (forward-only).
3. **Backfill.** Existing `invoices` rows: `bol_ids` left NULL — historical invoices keep working. No cost-line backfill (legacy invoices keep using `agreed_cost`/`invoiced_amount` scalars; cost-line UI shows scalars when no lines exist).
4. **Index changes.** `idx_invoice_cost_lines_invoice_id` (FK lookup); GIN index on `invoices.bol_ids` is **not** added — query patterns are `WHERE id = ?` then read; if AP starts searching by BOL we add it later.
5. **Constraint changes.** CHECK on `cost_type`; NOT NULL on `invoice_cost`/`approved_cost`; FK with CASCADE on invoice delete; CHECK `approved_cost >= 0` and `invoice_cost >= 0`.
6. **Rollback.** `DROP TABLE invoice_cost_lines; ALTER TABLE invoices DROP COLUMN bol_ids;` (documented in the migration header).
7. **Affected APIs / services / UI.** Listed below in the file-by-file plan.
8. **Risks / assumptions.** (a) Nullable `bol_ids` keeps old invoices valid. (b) Cost-line table is additive — old code that only reads scalars still works during transition. (c) `invoice_cost_lines.invoice_cost` is mutable so a corrected carrier resubmit can be reflected; the audit trail captures changes via `recordFieldDiffs`.

---

## File-by-file delivery plan

Order matches the rules (DB → service → route → frontend → audit/test).

### 1. DB migration

- `api/migrations/042_invoice_cost_lines_and_bol.sql` — add `invoices.bol_ids`, create `invoice_cost_lines`, indexes, comments, rollback notes.

### 2. API services

- `api/services/invoiceCostLines.js` — **new**. Pure functions to translate a shipment row → a normalized cost-line array (`{cost_type, description, invoice_cost, approved_cost, line_order}`); CRUD helpers `listForInvoice`, `replaceForInvoice` (single transaction), `updateLine` (writes history diff). The translation is unit-testable.
- `api/services/invoiceFromShipment.js` — **new**. `createInvoiceFromShipment({ shipmentId, user })` resolves the shipment (and its CBOL children if MBOL), generates the cost lines via the helper above, inserts the invoice with status `'On Hold'`, writes the cost lines, calls `history.recordChangeBatch` (invoice `create` + `status` + per-shipment `invoice` rows mirroring `submitInvoice`).
- `api/services/invoiceAudit.js` — **edit**.
  1. `submitInvoice` accepts a new optional `bolId` field. When `bolId` is given alongside `shipmentId`, validate against `shipments.bol_number` before running `decide()`. Mismatch ⇒ status `'Rejected'` with the BOL-mismatch reason; `bol_ids = [bolId]` is still written.
  2. Add `bol_ids` to `EDIT_FIELD_MAP` and the diff fields in `editInvoice` so audit captures changes.
  3. Both `submitInvoice` and `createInvoiceFromShipment` write the `bol_ids` array.

### 3. API routes

- `api/routes/invoices.js` — **edit**.
  1. New `POST /:id/cost-lines/:lineId` (PATCH) route → `invoiceCostLines.updateLine`.
  2. New `GET /:id/cost-lines` → `invoiceCostLines.listForInvoice`.
- `api/routes/shipments.js` — **edit**. New `POST /:id/invoice` route → `invoiceFromShipment.createInvoiceFromShipment`. Returns `{ invoice, costLines, reused: boolean }`. Idempotent — if an open invoice exists for this shipment, return that one with `reused: true`. Finance/admin gated (mirrors invoice routes).

### 4. Frontend services + API client

- `frontend/src/lib/api.js` — **edit**. Add `InvoicesApi.listCostLines(id)`, `InvoicesApi.updateCostLine(id, lineId, patch)`, and `ShipmentsApi.createInvoice(shipmentId)`.
- `frontend/src/services/invoiceService.js` — **edit**. Add `costLineLabel(cost_type)` and `sumApproved(lines)` helpers. No fetch logic here (services-first; that lives in `lib/api.js`).

### 5. Frontend pages + components

- `frontend/src/pages/ShipmentsPage.jsx` — **edit**. Replace both 🧾 Invoice navigations (line ~760 in the detail modal and line ~1663 in the row action) with `await ShipmentsApi.createInvoice(s.id)` then `navigate('/freight-invoices?invoice=' + result.invoice.id)`. Add a tiny optimistic `busy` state per row.
- `frontend/src/pages/FreightInvoicesPage.jsx` — **edit**. Stop auto-opening create modal on `?shipment=<id>`. Handle new param `?invoice=<id>` — open the existing invoice in edit mode. Keep `?shipment=<id>` only as a search-prefilter (legacy URL still works).
- `frontend/src/components/invoices/InvoiceModal.jsx` — **edit**. Render a Cost Lines table when `invoice.id` exists: columns `Type | Description | Invoice Cost (read-only) | Approved Cost (editable)`. PATCH on blur. Hide line-edit when `canEdit === false`.
- `frontend/src/components/invoices/InvoiceCostLines.jsx` — **new**. Extracts the cost-lines table (per Rule 6 — keep the modal under ~300 lines).

### 6. History / REQ-02

- `createInvoiceFromShipment` mirrors `submitInvoice`'s history call shape: invoice `create` + `status` (`Pending` → `On Hold`) + per-shipment `invoice` action rows.
- `invoiceCostLines.updateLine` writes a `recordFieldDiffs` row keyed on `entityType: 'invoice', field: 'cost_line.<line_order>.<cost_type>.approved_cost'` so the History drawer surfaces approved-cost changes.

### 7. Tests / verification

- `api/__tests__/invoiceFromShipment.test.mjs` — unit tests for the cost-line builder and the idempotency rule.
- Existing tests (`invoiceAuditEdit.test.mjs`, `invoicePayloadMapping.test.mjs`) updated for the new `bol_ids` field and `EDIT_FIELD_MAP` entries.
- Manual smoke: open SHP-2026-273786, click 🧾 Invoice, expect a new invoice on hold with the same cost breakdown, navigate to invoice page, edit one approved cost, see history row.

---

## Out of scope (not in this PR)

- AP integration (sending On Hold → Approved → AP webhook). The `manualDecide` path already covers the manual-approval case once cost-line approvals are in place.
- Cost-line backfill for historical invoices — left null on purpose; the modal renders the legacy scalars when no lines exist.
- BOL search index (GIN on `invoices.bol_ids`). Add when AP queries actually need it.
