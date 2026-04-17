# ZoreeTMS — Shipment Lifecycle Design

**Purpose:** single lifecycle model that all seven requirements (REQ-01..REQ-07) plug into.
Written so REQ-level work doesn't accidentally invent conflicting state machines.

**Sources:** `C:\Zoree\Requirements\requirements.xlsx` (live, read 2026-04-16),
existing code in `api/services/shipments.js`, `api/services/orders.js`,
`api/services/bulkPlanExecution.js`, `api/services/rolePermissions.js`.

---

## 1. Three coupled state machines

The system has three *separate* domain entities whose lifecycles cross. Keeping
them separate is what makes REQ-02 (history) tractable — each event knows its
entity and transition.

### 1.1 Order (`orders.status`)

```
  [OMS: Booked]              <- externally owned, OMS side
        |
        | REQ-01: auto-sync (OMS -> Middleware -> TMS)
        v
  Synced  --->  Unplanned  --->  Planning  --->  Planned
                                                    |
                                                    | (shipment moves;
                                                    |  order rides with it)
                                                    v
                                               Tendered -> Dispatched
                                                    |           |
                                                    v           v
                                                PickedUp -> InTransit -> Delivered -> Closed

  Any non-terminal state can transition to: Cancelled, OnHold
  Planned -> Unplanned allowed via "unassign" (captured by REQ-02)
```

Terminal states: `Delivered`, `Closed`, `Cancelled`.

### 1.2 Shipment (`shipments.status`)

```
  Draft  --->  Planned  --->  Tendering  --->  Tendered
                 |               |                |
                 | (unplan all)  | (no carrier)   v
                 v               v            Dispatched
              Cancelled      Cancelled            |
                                                  v
                                           InTransit -> Delivered -> Billed -> Reconciled -> Closed
                                                                        |
                                                                        +-> Disputed -> Reconciled
```

Cost-affecting transitions (REQ-03 hooks here):

- `Draft -> Planned` : initial cost set by rate engine.
- `Planned` (any add/remove order) : **auto-recalc** — the REQ-03 feature.
- `Planned -> Tendering` : snapshot cost becomes the "expected cost" used by
  REQ-06's tolerance check later.

After `Dispatched`, cost is **frozen**. Adding orders to a moving shipment is
blocked (business rule, surface in UI).

### 1.3 Invoice (`carrier_invoices.status`)

```
  Received --->  Matched  --->  UnderReview  --->  Approved  ---> SentToAP ---> Paid
     |             |                                   |
     |             |                                   +-> Rejected
     |             v
     |         Consolidated (REQ-07: one invoice, N shipments)
     |             |
     |             v
     |         AllMatched -> UnderReview ...
     |
     +-> Unmatched (needs human pairing)
```

REQ-06 tolerance logic lives on the `UnderReview -> Approved|Rejected`
transition. REQ-07 adds the `Consolidated -> AllMatched` fan-out.

---

## 2. How each requirement maps into the lifecycle

| REQ | Transition(s) touched | New data surface |
|---|---|---|
| REQ-01 auto order sync | `OMS:Booked -> Synced -> Unplanned` | middleware webhook → `orders` insert; no button, no job |
| REQ-02 change history | **every** transition on all three machines, plus any field edit | new `audit_log` table capturing (entity, entity_id, action, before, after, actor, ts) |
| REQ-03 add order to shipment + recalc | `Order: Unplanned -> Planned` & `Shipment: Planned` self-loop (cost recalc) | order action menu → `POST /shipments/:id/orders`; service triggers rate re-evaluation |
| REQ-04 roles | authorization gate in front of every transition | `user_roles`, `access_features`, `role_feature_grants` (partially exists) |
| REQ-05 bulk plan perf | N × `Order: Unplanned -> Planned` + M × `Shipment: Draft -> Planned` in a single batch | telemetry: `bulk_plan_runs(started_at, finished_at, order_count, shipment_count, ms_elapsed)` |
| REQ-06 invoice tolerance | `Invoice: UnderReview -> Approved|Rejected` | `carrier_tolerances(carrier, pct, abs_usd)`; compare `invoice.total` vs `shipment.expected_cost` |
| REQ-07 consolidated invoice | `Invoice: Received -> Consolidated -> AllMatched -> UnderReview` then REQ-06 logic on the **sum** of matched shipments | `invoice_shipment_links(invoice_id, shipment_id, allocated_amount)` |

---

## 3. Events / audit log (REQ-02 foundation)

One table, one write-path, everyone benefits.

```
audit_log
  id               uuid pk
  tenant_id        text
  entity_type      text   -- 'order' | 'shipment' | 'invoice'
  entity_id        text
  action           text   -- 'create' | 'edit' | 'plan' | 'unassign'
                          -- | 'tender' | 'accept' | 'reject'
                          -- | 'cost_recalc' | 'status_change'
                          -- | 'invoice_match' | 'invoice_approve' | 'invoice_reject'
  field            text   -- nullable, for 'edit' rows
  before_value     jsonb
  after_value      jsonb
  actor_user_id    text
  actor_username   text
  actor_role       text
  created_at       timestamptz default now()
  index (entity_type, entity_id, created_at desc)
```

Write path: every mutating service function in `api/services/*` calls a single
`logAudit({...})` helper before returning. No UI code writes audit rows.

This is what makes REQ-02 one table instead of seven ad-hoc history screens.

---

## 4. Roles & feature grants (REQ-04)

```
roles
  key         primary key   -- 'planner' | 'finance' | 'admin' | future custom
  label       text
  is_system   bool           -- built-ins can't be deleted

access_features   (already partially exists)
  feature_key  pk            -- 'orders.plan', 'shipments.edit',
                             -- 'rates.edit', 'invoices.approve',
                             -- 'invoices.reject', 'tolerance.edit',
                             -- 'ap.send', 'audit.view', 'roles.manage'
  label, description, module

role_feature_grants
  role_key, feature_key       composite pk
  granted bool

user_roles
  user_id, tenant_id, role_key
```

Default grants:

| feature | planner | finance | admin |
|---|---|---|---|
| orders.plan | YES | no | YES |
| shipments.edit | YES | no | YES |
| rates.edit | YES | no | YES |
| invoices.approve | no | YES | YES |
| invoices.reject | no | YES | YES |
| tolerance.edit | no | YES | YES |
| ap.send | no | YES | YES |
| audit.view | YES | YES | YES |
| roles.manage | no | no | YES |

Authorization point: `api/middleware/authorize.js` looks up
`role_feature_grants` by the user's role and the route's declared feature key.
Frontend uses the **same** grant map to hide menus (no duplication of access
rules in UI code).

---

## 5. Data model additions (proposed migrations)

Numbering continues from existing `004_add_dock_issue_to_shipments.sql`.

- `005_create_audit_log.sql` — table above, indexes, RLS by `tenant_id`.
- `006_add_lifecycle_status_columns.sql` — add `expected_cost` to `shipments`;
  normalize enum values for `shipments.status` and `orders.status`.
- `007_create_carrier_tolerances.sql` — `carrier_tolerances(carrier, pct, abs_usd, tenant_id)`.
- `008_create_invoice_tables.sql` — `carrier_invoices`, `invoice_shipment_links`,
  `invoice_audit` view joining on `audit_log`.
- `009_create_role_feature_grants.sql` — roles, grants (if not already present).
- `010_create_bulk_plan_runs.sql` — perf telemetry for REQ-05.

Every migration file gets the mandatory header (Description | Affected
APIs/UI/services | Backfill | Rollback | Risks) per `zoree_db_rules`.

---

## 6. REQ-03 cost recalc rule (the one that bites if under-specified)

When an order is added to an existing `Planned` shipment:

1. Load current shipment row (lock via `SELECT ... FOR UPDATE` in a transaction).
2. Reject if `status` ∉ {`Draft`, `Planned`}.
3. Update `shipments.weight += order.weight`, append `order.id` to `order_ids`.
4. Recompute cost:
   - `base   = weight * rate_per_mile * miles / 100`   (CWT basis, matches
     existing `estimateCost()` in `shipments.js`)
   - `fsc    = base * fsc_pct`
   - `access = sum(accessorials)`
   - `total  = round2(base + fsc + access)`
5. Write both the shipment update and an `audit_log` row with
   `action='cost_recalc'`, `before_value={weight, total_cost}`,
   `after_value={weight, total_cost}`.
6. Return new shipment to caller in one response (so the UI can re-render
   without a second round-trip).

Idempotency: calling twice with the same order id must be a no-op (check
`order_ids` includes `order.id`).

---

## 7. REQ-06 tolerance rule

```
delta_pct = abs(invoice.total - shipment.expected_cost) / shipment.expected_cost
delta_abs = abs(invoice.total - shipment.expected_cost)
tol = carrier_tolerances[invoice.carrier]  // falls back to tenant default

if delta_pct <= tol.pct OR delta_abs <= tol.abs_usd:
    status = 'Approved'; queue for AP
else:
    status = 'Rejected'; raise to finance review
```

Both pct and abs_usd being present lets you handle small shipments (pct too
noisy) and big shipments (abs too loose) without extra config.

---

## 8. REQ-07 consolidated invoice rule

An invoice is consolidated if it references ≥2 shipment ids (from the invoice
body or a cover sheet). Pipeline:

1. `Received` → parser emits `invoice_shipment_links` rows (one per claimed
   shipment).
2. Any link without a matching `shipments.id` → invoice → `Unmatched`.
3. All links resolved → `Consolidated` → `AllMatched` → `UnderReview`.
4. Tolerance check compares `invoice.total` vs
   `sum(shipments.expected_cost)` across linked shipments.
5. On approve: write allocated amount per link (straight proportional by
   `expected_cost`) so finance can later see per-shipment spend.

---

## 9. REQ sequencing (why this order)

1. **REQ-02 first in code** (even though it's #2 in the list). The audit_log
   table is a dependency of every later REQ's acceptance criteria
   ("show me history of ...").
2. **REQ-04 next.** Role middleware has to exist before the new endpoints in
   REQ-03/05/06/07 land, otherwise we retrofit auth and break tests.
3. REQ-01 — middleware webhook.
4. REQ-03 — add-to-shipment + cost recalc (exercises audit + roles).
5. REQ-05 — bulk plan perf (exercises the full order→shipment path at scale).
6. REQ-06 — invoice tolerance (needs `expected_cost` written by REQ-05/03).
7. REQ-07 — consolidated invoice (adds fan-out on top of REQ-06).

I'll still report against REQ numbers the way `tms-cycle` expects, but the
implementation order above is what actually works.

---

## 10. Answered open questions (2026-04-16)

| Question | Answer | Implication |
|---|---|---|
| Default tolerance when a carrier has no row | **5% OR $5** (either one triggers Approved) | `carrier_tolerances` gets a tenant-level default row seeded at migration 007; lookup falls back to it |
| OMS ↔ Middleware ↔ TMS shape | OMS and Middleware are **pages in the same frontend** (`frontend/src/pages/`), not separate services | REQ-01 is an **in-app** auto-sync, not a webhook. Booking on the OMS page writes straight through the existing API; the Middleware page reflects queue state. No cross-service integration to stub. |
| Planner / finance / admin user fixtures | **Create them as part of REQ-04** (planner + finance users seeded; admin already exists) | Seed migration 009 inserts test users; Playwright fixture reads creds from env |
| Audit log retention | **6 months** | Partition `audit_log` by month; add a nightly cleanup job (or Supabase scheduled function) that drops partitions older than 180 days |
| Consolidated invoice format (REQ-07) | **JSON or PDF upload** — user uploads the file | Parser has two paths: JSON → direct mapping to `invoice_shipment_links`; PDF → text extraction + regex for shipment IDs (format `SHP-YYYY-NNNN` per `bulkPlanExecution.js`). Unmatched → `Unmatched` status for manual pairing. |

### REQ-01 revised flow (given OMS/Middleware are standalone HTML pages)

Architecture actually found in the repo:

```
  frontend/zoree-oms.html         (standalone HTML + supabase-js)
     - has "Send to Middleware → TMS" button  (line 748)   <-- violates REQ-01
     - has "↻ Sync TMS" button                (line 391)    <-- violates REQ-01
     - writes to oms_orders, oms_order_lines
     - enqueues cmds in mw_requests or calls _execDirect to TMS.orders

  frontend/zoree-middleware.html   (standalone HTML + supabase-js)
     - Auto-Sync OFF by default   (line 326-328)            <-- violates REQ-01
     - "Run Full Sync" button                               <-- violates REQ-01
     - polls mw_requests, processes each, writes to TMS tables

  frontend/src/ (React TMS app)
     - OrdersPage.jsx reads from orders table
     - needs to auto-refresh so operator doesn't click reload
```

REQ-01 fix (implementation plan):

1. In `zoree-oms.html`: on every `saveOrder()` success, immediately call the
   existing `_dispatch('PUSH_ORDER', ...)` (or `_execDirect` for the zero-
   latency path). Hide the "Send to Middleware → TMS" and "↻ Sync TMS"
   buttons behind an admin-only debug flag so ops can't manually gate it.
2. In `zoree-middleware.html`: default `auto-sync-interval` to `5s` and start
   it on page load (`toggleAutoSync()` called from boot if not already on).
   Remove the "OFF" default; keep the pause control for debugging only.
3. In `frontend/src/pages/OrdersPage.jsx`: subscribe to the Supabase realtime
   channel on the `orders` table (insert events), or fall back to a 5s poll.
   Either way the TMS orders table refreshes without user action.
4. Audit_log entry `action='create'` written server-side when the TMS
   `orders` row is inserted (handled inside `api/services/orders.js`).

Acceptance (REQ-01 test): book order on OMS page → switch to TMS orders page
without clicking anything else → order visible within a few seconds.
FAIL if a "Send to TMS" button or manual refresh is needed.
