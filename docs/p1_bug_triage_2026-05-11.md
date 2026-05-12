# P1 Bug Triage — Rohith Batch (2026-05-11)

Source: 25 P1 tickets logged by Rohith on 2026-05-11, spanning TMS web,
Mobile App, and the Zoree AI assistant.

This doc is the engineering response: for every ticket it records the
actual code path the bug lives in (verified against the repo at HEAD on
2026-05-11), a root-cause hypothesis, the implementation plan, an
effort tag, and risk notes.

Conventions:

- **Effort:** S = <½ day, M = ½–2 days, L = sprint-scale (>2 days).
- **Risk:** Low = single-screen / single-service. Med = touches a
  shared service or schema. High = product-scope change or migration.
- **Status:** Open = not started. Fixed = code change landed in this
  pass. Plan = implementation plan recorded here, no code yet.

---

## In-pass fix landed

### P220 — Mobile Orders missing "Planning Failed" status filter — *Fixed*

- **File:** `mobile/src/screens/orders/OrdersScreen.tsx`
- **Change:** Added `'Planning Failed'` to the `ORDER_STATUSES` array
  used by `<StatusFilter>`. The value is the same string already
  written to `orders.status` by `api/services/bulkPlanExecution` and
  surfaced on the web; no other layer changes.
- **Effort:** S — single-token addition.
- **Risk:** Low — adds a filter pill; orders without that status are
  simply absent from the filtered list, no crashes.
- **Verification suggested:** Run a failing bulk plan in dev, confirm
  the order appears under the new pill on mobile.

---

## P200 — Realtime OMS→TMS order status sync (P1, M, Med risk) — *Plan*

### Reproduction

Update an order status to In-Transit / Delivered in OMS → open the
order in TMS web → status stays stale until manual refresh.

### Code paths read

- `api/services/omsSync.js` — handles **TMS→OMS** direction only
  (tender accept, delivered, dock). It emits
  `bus.emit(EVENTS.SHIPMENT_UPDATED, …)`.
- `frontend/src/hooks/useRealtimeOrders.js` — Supabase realtime
  subscription on `public.orders`, debounced (250 ms) refetch.
- `frontend/src/hooks/useRealtimeShipments.js` — same pattern for
  shipments.
- `frontend/src/pages/OrdersPage.jsx` — wires `useRealtimeOrders` at
  line 167.
- `frontend/zoree-oms.html` — has its own `OmsLive` WS client that
  reacts to `SHIPMENT_UPDATED` server-side bus events.

### Root cause hypothesis

The TMS realtime path subscribes to `public.orders` `postgres_changes`,
which fires when **TMS's** `orders` row is updated. OMS-side status
edits live in `public.oms_orders`, not `public.orders`, so the OMS push
into `oms_orders` never trips the TMS subscription. There is no
bidirectional OMS→TMS mirror writer analogous to `omsSync.js`.

### Implementation plan

1. New service: `api/services/tmsSync.js`
   - Functions: `syncInTransitToTms(payload, user)` and
     `syncDeliveredFromOmsToTms(payload, user)`.
   - Inline UPDATE on `orders` + `shipments` (only fields that don't
     regress, per the existing omsSync pattern).
   - Emit `bus.emit(EVENTS.ORDER_UPDATED, …)` (define new event key if
     absent in `eventBus.js`).
2. Hook the OMS status-change writer (search for any handler in
   `zoree-oms.html` / `frontend/services/omsLive/omsWsClient.js` that
   currently writes to `oms_orders.stage`) to also POST
   `/api/tms/pull-status` → calls the new service.
3. Add `ORDER_UPDATED` bridge in `api/server.js` so the WS server
   broadcasts to `useRealtimeOrders` clients.
4. **No schema change required** — the orders.status column already
   supports In-Transit / Delivered.

### Effort / risk

- **Effort:** M (new service, new bus event, server.js bridge, one OMS
  caller).
- **Risk:** Med — cross-app coordination; must NOT regress when OMS is
  not running locally (best-effort try/catch as in omsSync.js).
- **Files to touch:** `api/services/tmsSync.js` (new),
  `api/services/eventBus.js`, `api/server.js`,
  `frontend/zoree-oms.html` (writer hook),
  `api/routes/orders.js` (mount route).

### Per zoree_db_rules.pdf

- No new tables / columns required.
- No migration. (Document this explicitly in the PR description as the
  rules require an 8-item checklist for any DB change — none applies
  here.)

---

## Mobile module parity — P201–P209 (mostly Plan, some quick wins)

### Status of mobile drawer (verified)

`mobile/src/navigation/AppNavigator.tsx` already registers drawer
entries for: Overview, Planning, BulkPlan, MultiStop, **Execution**,
**Finance**, Documents (PlaceholderScreen), Integration
(PlaceholderScreen), Insights, System.

`mobile/src/screens/` has folders for:
`tracking, carriers, dock, fleet, compliance, freight, rates, bids,
documents, messaging, network, alerts, analytics, reports, settings,
admin, items, locations, equipment, customer, driver, orders,
shipments, routes, bulkplan, auth, dashboard`.

So most "missing module" tickets are **wiring/depth** issues, not
absent code.

---

### P201 — Overview / Home / Dashboard sub-modules — *Plan, S*

- **Drawer:** `OverviewTab` is wired in `AppNavigator.tsx`.
- **Stack:** `mobile/src/navigation/tabs/OverviewTabs.tsx` — needs
  inspection to confirm both Home and Dashboard screens are routed.
- **Action:** Read `OverviewTabs.tsx`. If it exposes only one screen,
  add the second; `screens/dashboard/` and `screens/home/` paths
  already exist (verify by `ls`).
- **Effort:** S. **Risk:** Low.

### P202 — Planning sub-modules (Item, Location, Equipment, Shipments, Orders, Route Optimizer, Bulk Plan, Multi-Stop, Planning Params) — *Plan, M*

- **Drawer:** `PlanningTab` + `BulkPlanTab` + `MultiStopTab` already
  registered.
- **Status:** Screens for all nine sub-modules exist
  (`items/, locations/, equipment/, shipments/, orders/, routes/,
  bulkplan/, …`).
- **Likely root cause:** `PlanningTabs.tsx` stack does not list every
  sub-module, or some sub-modules launch from buttons inside other
  screens and the QA expected drawer-level entries.
- **Action:** Read `tabs/PlanningTabs.tsx`. Reconcile against web's
  Planning menu (`frontend/src/components/Layout.jsx` Planning
  section) and add the missing `Stack.Screen` entries.
- **Effort:** M (~9 screens to wire).
- **Risk:** Low if screens are already implemented; Med if any are
  still stubs.

### P203 — Execution module + sub-modules (Live Tracking, Carriers, Carrier Portal, Dock Scheduling, Fleet, Compliance) — *Plan, L*

- **Drawer:** `ExecutionTab` already wired.
- **Status:** Sub-screens exist as folders — but verify they are not
  all `PlaceholderScreen` re-exports.
- **Action:**
  1. Read `tabs/ExecutionTabs.tsx`; reconcile against web Execution
     menu.
  2. For each sub-module, audit:
     - Live Tracking — does it call the same `/api/shipments?live=1`
       endpoint the web uses?
     - Carriers — CRUD on `carriers` table.
     - Carrier Portal — separate tenant-scoped view.
     - Dock Scheduling — `frontend/src/components/dock-scheduling`
       has a non-trivial drag-and-drop UI; mobile won't match feature
       parity in one ticket.
     - Fleet, Compliance — both have folders, likely shallow.
- **Effort:** L — this is the single biggest item in the batch.
  Recommend splitting into 6 separate tickets (one per sub-module).
- **Risk:** High if attempted as one PR.

### P204 — Finance sub-modules (Freight Invoices, Rate Management, Lane Preferences, Carrier Bids, Freight Audit) — *Plan, L*

- **Drawer:** `FinanceTab` wired.
- **Screens:** `freight/, rates/, bids/` exist; **Lane Preferences**
  and **Freight Audit** need verification.
- **Action:** Read `tabs/FinanceTabs.tsx`; verify five sub-modules,
  add missing ones. For Freight Audit (web is data-heavy — see
  `frontend/src/components/freight-audit/`) be cautious about depth.
- **Effort:** L. **Risk:** Med–High. **Split:** 5 sub-tickets.

### P205 — Documents module (Documents & BOL, Customer Portal) — *Plan, M*

- **Drawer:** `DocumentsTab` exists, **but** wired to
  `PlaceholderScreen` (confirmed at
  `AppNavigator.tsx` ~lines 121–125).
- **Action:**
  1. Replace placeholder with a real `DocumentsStack` similar to
     other tabs.
  2. Screens already exist in `screens/documents/` and
     `screens/customer/`.
  3. Reuse `api/routes/messagingHub.js` upload endpoints; mobile
     should NOT introduce its own document-table mutations (CLAUDE
     rules §db — single writer).
- **Effort:** M. **Risk:** Low–Med.

### P206 — Integration / Messaging Hub — *Plan, M*

- **Drawer:** `IntegrationTab` → `PlaceholderScreen`.
- **Screen:** `screens/messaging/` exists.
- **Action:** Same shape as P205 — replace placeholder with the
  existing screen stack; verify the WS client reuses
  `mobile/src/shared/api.js` rather than duplicating the messaging
  client.
- **Effort:** M. **Risk:** Low.

### P207 — Insights sub-modules (Network Modeling, Analytics, Reports, Alerts, DB Explorer) — *Plan, M*

- **Drawer:** `InsightsTab` wired with `InsightsTabs.tsx`.
- **Screens:** `network/, analytics/, reports/, alerts/` exist.
  **DB Explorer** likely absent — verify (it's web-only at
  `frontend/src/pages/DbExplorerPage.jsx`; whether you want it on
  mobile is a product call given the form factor).
- **Action:** Read `InsightsTabs.tsx`, add missing entries. **Decide
  with product** whether DB Explorer should exist on mobile.
- **Effort:** M. **Risk:** Low.

### P208 — System module (User Management, User Roles, Settings) — *Plan, M*

- **Drawer:** `SystemTab` wired with `SystemTabs.tsx`.
- **Screens:** `admin/, settings/` exist (User Management +
  User Roles likely in `admin/`).
- **Action:** Verify `SystemTabs.tsx` lists all three; add if
  missing. Settings already in `screens/settings/`.
- **Effort:** S–M. **Risk:** Low.

### P209 — Active Role switcher (Admin, Planner, Finance, Viewer) — *Plan, S–M*

- **Web equivalent:** `frontend/src/components/RoleSwitcher.jsx` +
  `state/AuthContext` `activeRole`.
- **Mobile:** Drawer footer shows hard-coded `Admin` label
  (`AppNavigator.tsx` `userRole` style). No switcher present.
- **Action:** Add a `<RoleSwitcher>` component in
  `mobile/src/components/admin/` that wraps `useAuth` and emits
  `activeRole`. Render in drawer footer. **Re-use** web
  `rolePermissions` constants from `api/services/rolePermissions.js`
  (already shared between web and api).
- **Effort:** S–M. **Risk:** Low (UI-only on top of an existing
  auth context).

---

## P210 — Duplicate customer in mobile new-order dropdown — *Verify/Plan, S*

### Code path read

`mobile/src/services/optionsService.ts` `customerOptions()` already
dedupes by case-folded + whitespace-collapsed key (QA bug #104 prior
fix). `OrderFormScreen.tsx` line ~185 uses
`customerOptions(data.orders, data.customers)` — the canonical path.

### Hypothesis

Either (a) the QA ticket was logged against a build pre-dating the
#104 fix, (b) duplicates are surfacing through a parallel code path
(e.g., `mobile/src/components/bulkplan/OrderEditModal.tsx` calls the
service — verify it too uses the dedup), or (c) the customer rows in
the OMS master have invisible differentiators the current
`SPACE_LIKE_RE` regex doesn't normalise (zero-width joiners, RTL
marks).

### Plan

1. Verify by repro: log `data.customers.map(c => JSON.stringify(c.name))`
   on the OrderFormScreen mount.
2. If invisible-char duplicates: extend `SPACE_LIKE_RE` to include
   ZWJ (`‍`), LRM (`‎`), RLM (`‏`), and the BOM
   (`﻿`). Add a unit test in
   `mobile/src/services/__tests__/optionsService.test.ts`.
3. If a parallel non-deduped code path is found, route it through
   `customerOptions`.

### Effort / risk

S. Low.

---

## P211 — Origin/Destination location parity mobile vs web — *Verify/Plan, M*

### Code path read

- `mobile/src/services/optionsService.ts` `locationOptions()` —
  QA bug #105 fix already accepts name-only locations.
- `frontend/src/components/LocationSearchDropdown.jsx` — web
  equivalent.

### Hypothesis

Most likely causes, in order:

1. Mobile `DataContext` paginates locations and stops at 500; web
   `LocationSearchDropdown` fetches with a search prefix and returns
   different rows. The "some in web missing in mobile" half of the
   ticket points here.
2. Mobile filters by `active = true` somewhere downstream of
   `locationOptions`, web does not — or vice versa. The "some in
   mobile missing in web" half points here.
3. The two are pulling from different tenants (verify
   `tenant_id` filter in `DbApi.locations` on both sides).

### Plan

1. Diff the API requests both clients make for the location list
   (`/api/locations` query params).
2. Align the page-size / filters.
3. If pagination is the cause, switch the mobile picker to an
   on-demand search (like web) rather than a pre-loaded list.
4. **No schema change.**

### Effort / risk

M. Med (touches `DbApi.locations` shared code, possibly
`api/routes/locations.js` query semantics).

---

## P212 — AI cannot update PO number & dates on an order — *Plan, M*

### Code path read

- `frontend/src/components/ZoreeAI.jsx` (UI shell).
- `frontend/src/services/zoreeAIActionsService.js` (tool registry).

### Hypothesis

The AI tool registry probably exposes `createOrder` and read-only
`getOrder` but no `updateOrder` action, so the model correctly refuses.

### Plan

1. In `zoreeAIActionsService.js` add an `updateOrder` action with
   schema `{ orderId, patch: { poNumber?, readyDate?, dueDate?, … } }`.
2. Route it through the existing `apiOrderToDbPatch` / `orderToDb`
   mappers (per memory: **two mappers have drifted, update both**) so
   the AI write goes through the same audit path as UI writes
   (REQ-02).
3. Add corresponding `tools` entry in
   `frontend/src/services/zoreeAITools.js` (verify file name).
4. Permission gate: only Admin / Planner roles can invoke.

### Effort / risk

M (~3 files, audit pipeline must be hit). Med risk — must NOT bypass
`api/routes/orders.js` validation.

### Per zoree_db_rules.pdf

No schema change. Confirm in PR checklist.

---

## P213 — AI cannot copy a shipment — *Plan, M*

### Hypothesis

Same registry gap as P212 — the AI exposes order copy but not
shipment copy.

### Plan

1. `zoreeAIActionsService.js` — add `copyShipment(shipmentId)`.
2. Implementation calls the existing API path used by the web
   "Duplicate" button on `ShipmentsPage.jsx` (find via
   `git grep duplicateShipment` or similar).
3. If no API exists, the work is L not M — building shipment copy
   from scratch needs careful handling of:
   - shipment_id / SHP-… key minting,
   - linked orders (do we deep-copy orders too? Probably not — only
     the shipment wrapper),
   - audit history.
4. Tool registry entry + role gate as in P212.

### Effort / risk

M (if API exists) → L. Med risk.

---

## P214 — Inconsistent location naming: manual vs AI-created shipments — *Plan, S*

### Hypothesis

When the AI calls `createShipment`, it passes `origin` / `destination`
as warehouse names ("Atlanta XDock"). The manual flow uses
"City, ST ZIP" format because that's what the OrderFormScreen
locationOptions surfaces (per code read above).

### Plan

1. In `zoreeAIActionsService.js`, post-process the AI's chosen
   origin/destination through the same composer used by manual flow
   (`frontend/src/services/locationsService.js` — `locationDisplayValue`
   or similar, verify name).
2. Add a `tests/zoreeAI.location-naming.spec.js` regression test.

### Effort / risk

S. Low risk — pure formatting.

---

## P215 — AI cannot create an invoice from a shipment — *Plan, M*

### Code path read

- `api/services/invoiceFromShipment.js` exists (server-side flow).
- `api/routes/invoices.js` exists.

### Plan

1. Tool registry: add `createInvoiceFromShipment(shipmentId)`.
2. Implementation: POST to `/api/invoices/from-shipment` (verify route
   in `routes/invoices.js`); the service already exists.
3. Add audit-trail check — `invoiceAudit.js` must record the AI as
   the actor.
4. Role gate: Finance + Admin only.

### Effort / risk

M (mostly wiring; backend already does the work). Low risk.

---

## P216 — AI bulk-plan fails on weight limit instead of splitting — *Plan, M*

### Code path read

- `api/services/bulkPlanExecution.js`.
- `frontend/src/components/bulk-plan/` (UI).

### Hypothesis

When five 40k-lb orders are submitted, the API currently builds one
shipment of 200k lbs, which exceeds the equipment cap and rolls back
the whole plan. The web Bulk Plan UI handles this by surfacing a
"split required" warning and letting the user re-group. The AI path
calls the same endpoint but doesn't get the warning back in a form it
can act on.

### Plan

1. Read `bulkPlanExecution.js` and find where the weight check fails
   — confirm it short-circuits the entire batch instead of grouping
   by capacity.
2. Add an `auto_split: true` flag that, when set, splits a group of
   orders that exceed `equipmentLimits.maxWeight` into multiple
   shipments by greedy bin-pack (use existing `equipmentLimits.js`
   service).
3. AI invokes with `auto_split: true`; UI keeps the explicit
   "warn-and-stop" default so the planner stays in control.

### Effort / risk

M. Med risk — touches a critical service. Add unit tests in
`api/__tests__/bulkPlanExecution.weight-split.spec.js`.

### Per zoree_db_rules.pdf

No schema change.

---

## P217 — Dashboard data parity mobile vs web — *Plan, M*

### Hypothesis

Web `DashboardPage.jsx` likely calls a single
`/api/dashboard/summary` endpoint; mobile `screens/dashboard/` likely
derives counts client-side from `data.orders` / `data.shipments`
(which paginate at 500). That's exactly the kind of drift the QA
ticket describes ("Some data is same but overall …").

### Plan

1. Read `frontend/src/pages/DashboardPage.jsx` and
   `mobile/src/screens/dashboard/`.
2. Identify whether web uses a server aggregate endpoint.
3. If yes — point mobile at the same endpoint (`DbApi.dashboardSummary`
   or similar — add if missing).
4. If no — extract a `dashboardAggregateService.js` (shared between
   `frontend/src/services` and `api/services`, used by both web and
   the API).
5. **CLAUDE_RULES note:** the aggregation should live in a service,
   not the page (currently it's likely in the page — break it out).

### Effort / risk

M. Med risk — affects two surface areas; align carefully.

---

## P218 — Mobile Orders page missing action buttons — *Plan, S–M*

### Code path read

`mobile/src/screens/orders/OrdersScreen.tsx` already has quick-nav
buttons for: **Shipments, Bulk Plan, Multi-Stop, Items**. So three of
the four QA-flagged buttons are already there.

**Genuinely missing:**

- **Remove Shipments** — a bulk action that un-links selected orders
  from their planned shipments and returns them to Unplanned. Web
  equivalent: search `OrdersPage.jsx` for "Remove from Shipment".

### Plan

1. Add a `Remove Shipments` action to `<OrderSelectionBar>`
   (`mobile/src/components/orders/OrderSelectionBar.tsx`) — only
   enabled when at least one selected order is Planned/Tendered.
2. Reuse the existing API endpoint (find the web's "Remove from
   Shipment" handler in `OrdersPage.jsx` → trace to
   `api/services/orderMutations.js`).
3. **CLAUDE_RULES:** confirm the call uses the audited mutation
   service (per memory: **`/api/db` writes are audited via
   `genericTableAudit.js`** — verify path).

### Effort / risk

S–M. Low.

---

## P219 — Mobile Orders page: Import / Export / New Order — *Plan, M*

### Status

- **New Order** already exists as the FAB on `OrdersScreen.tsx`.
- **Import Orders** — needs a file-picker + the same parser as the
  web's `OrdersPage.jsx` "Import" flow (separate-columns convention
  per memory: `project_import_format_conventions.md` — separate
  columns for addresses, separate sheet linked by Order Row #).
- **Export Orders** — XLSX export of the current filter.

### Plan

1. Add an overflow menu (kebab) in the header → "Import" / "Export".
2. Import: use `expo-document-picker` → upload to existing
   `/api/orders/bulk-import` endpoint.
3. Export: build XLSX client-side with `react-native-xlsx` (verify
   bundle size) OR call a new `/api/orders/export` endpoint that
   returns a signed URL.

### Effort / risk

M. Med — file pickers on mobile add surface area.

---

## P220 — *Fixed in this pass (see top).*

---

## P221 — Mobile Orders missing filters (Customer, Ship From, Ship To, Ready/Due/Created dates) — *Plan, M*

### Code path read

`OrdersScreen.tsx` currently has SearchBar + StatusFilter only.

### Plan

1. New component: `mobile/src/components/orders/OrderFiltersSheet.tsx`
   — bottom-sheet with Customer (multi-select), Ship From / Ship To
   (single-select from `locationOptions`), three date ranges (Ready,
   Due, Created), and a Reset button.
2. Lift filter state into a `useOrdersFilters` hook (mirrors web's
   filter logic for parity).
3. Hook the filtered set into `filteredOrders` memo. Match the web's
   filter semantics to avoid the P217 dashboard drift problem.

### Effort / risk

M. Low–Med.

---

## P222 — Mobile Order Detail action buttons (Details / Edit / History top; Plan / Edit / Copy bottom) — *Plan, S–M*

### Code path read

`mobile/src/screens/orders/OrderDetailScreen.tsx` is 640 lines —
needs inspection to confirm which buttons already exist.

### Plan (assumes some buttons missing)

1. Header: Details (default tab) / Edit (push OrderFormScreen) /
   History (push a new `OrderHistoryScreen` that reads
   `change_history` filtered by entityType=order, entityId).
2. Footer: Plan (push to BulkPlan with this order pre-selected),
   Edit (same as header), Copy (calls existing copy-order API used
   by web).
3. **History screen is new** — verify `change_history` API endpoint
   exists (per memory: REQ-02 audit pipeline is in place).

### Effort / risk

S–M. Low (no schema, history endpoint already exists).

---

## P223 — Mobile Orders 3-dot per-row menu — *Plan, S*

### Plan

1. In `mobile/src/components/orders/OrderCard.tsx`, add a kebab icon
   that opens an ActionSheet with: Add to Shipment, Cross-Dock Plan,
   View Details, Edit, Duplicate, Cancel Order, Delete.
2. **CLAUDE_RULES:** Delete is dangerous on mobile (no undo). Either
   gate behind a typed-confirmation modal or omit on mobile and keep
   it web-only — recommend the latter.
3. Each action either pushes a screen or calls an existing API; no
   new endpoints.

### Effort / risk

S. Low — but the Delete decision needs product sign-off.

---

## P224 — Mobile Shipments module — *Plan, M*

### Code path read

`mobile/src/screens/shipments/` exists. The QA claim that "Shipments
module is not available" is almost certainly stale or refers to a
specific role / drawer entry missing.

### Plan

1. Confirm `ShipmentsScreen` is reachable from drawer
   (`PlanningTab` → Shipments).
2. If absent in drawer, add. Screen already exists.

### Effort / risk

S–M. Low.

---

## Verification checklist (when each ticket lands)

Per `docs/CLAUDE_RULES.md` and `docs/zoree_db_rules.pdf`, every
ticket's PR must include in its description:

1. Files touched (modular layers respected — no mega-file edits).
2. Whether a service was added or modified (services-first rule).
3. Migration files added (none → state "no schema change").
4. Audit pipeline preserved (REQ-02 — writes go through
   `genericTableAudit.js` for `/api/db` paths, dedicated services for
   orders/shipments).
5. Mobile vs web parity sign-off where applicable.
6. Test additions (unit + at least one Playwright/Detox smoke).
7. Realtime path validated (no missing `bus.emit(SHIPMENT_UPDATED)`
   or `useRealtimeOrders` consumer where needed).
8. Two-mapper note — if touching orders→db, **both** `apiOrderToDbPatch`
   and `orderToDb` must be updated (per repo memory).

---

## Recommended sprint slicing

If allocating across two sprints:

**Sprint 1 — core sync + clean wins (~1 week):**
P200, P210, P211, P214, P217, P218, P220 (done), P223.

**Sprint 2 — mobile module depth + AI (~1 week):**
P201, P202, P205, P206, P208, P209, P212, P215, P219, P221, P222,
P224.

**Sprint 3 — large feature builds (size pending product review):**
P203 (split into 6 sub-tickets), P204 (split into 5 sub-tickets),
P207 (5 sub-modules), P213 (if shipment-copy API doesn't yet exist),
P216 (auto-split bulk-plan).

---

## Open questions for product / @Rohith

- P203/P204: do you want the mobile Execution + Finance modules to
  reach 1:1 parity with web, or a curated subset suited to the form
  factor (e.g. Live Tracking + Freight Invoices on phone, Carrier
  Portal + Dock Scheduling stay desktop)?
- P207 DB Explorer: include on mobile? Recommend skipping.
- P223: include "Delete" in the mobile overflow menu, or web-only?
- P209: do tenant admins also get the Active Role switcher on mobile,
  or only on web?
