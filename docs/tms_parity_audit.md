# Zoree TMS — Web vs Mobile Parity & Sync Audit

*Prepared 2026-05-09 · Scope: Orders, Shipments, Bulk Import, OMS Sync*

---

## Executive Summary

**Mobile is roughly two-thirds the surface area of web.** Of the 36 web routes, mobile implements ~30 screens covering most planning and execution flows. The largest functional gaps are bulk CSV/Excel import of orders, the order-level change-history (audit) tab, the OMS and Middleware admin portals, and several admin/RBAC surfaces (User Management, Roles, DB Explorer).

**Sync is healthier than parity.** Mobile and web both write through the same Express API (no direct Supabase writes from mobile), share JWT auth, and subscribe to the same realtime channels (orders + shipments). The change-audit pipeline (REQ-02) fires correctly for mobile order and shipment mutations because they hit the dedicated `/api/orders/:id` and `/api/shipments/:id` endpoints. The audit gap that does exist is on the generic `/api/db/:table` writers used for rates, locations, equipment, drivers, vehicles — that path only special-cases shipments, so non-shipment generic writes from mobile bypass change history. Web has the same gap by design, so it is a shared issue rather than a mobile regression.

**Two real drift risks deserve attention.** First, the OMS HTML apps (`zoree-oms.html`, `zoree-middleware.html`) write to Supabase directly with the anon key and broadcast through the Express WebSocket channel; web reacts to those broadcasts but mobile only catches order/shipment table changes via Supabase realtime, so OMS-driven dock or middleware-config changes are invisible on mobile until a manual refresh. Second, mobile has no offline queue or local persistence beyond `AsyncStorage` for the JWT and API base URL — every screen is an online-first fetch, so a flaky connection silently degrades to stale reads with no user-visible indicator.

**Recommendation:** treat this as audit-only output. Before any code is written, validate the priority of the four highlighted gaps with the product owner, then sequence the implementation file-by-file per `CLAUDE_RULES.md` (services-first, no mega-files). Detailed per-feature evidence and recommended next steps are in the sections below.

---

## Architecture Recap

Both apps target the same Express API and the same Supabase project. The audit pipeline (REQ-02) is centralised in `api/services/changeHistory.js` and is invoked from the dedicated entity routes — mobile inherits this for free as long as it hits those routes (and not the generic `/api/db/:table` fallback).

| Layer        | Web (`frontend/`)                                                                                       | Mobile (`mobile/`)                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Stack        | React 19 + Vite 7 + React Router 7                                                                      | React Native 0.81 + Expo 54, React Navigation 7                                                                     |
| State / Data | TanStack React Query + custom hooks; Supabase JS for realtime only                                      | AuthContext + DataContext; Supabase JS for realtime only; AsyncStorage for token + base URL                         |
| Write path   | Express API (`lib/api.js`) for all TMS writes; OMS/MW HTML apps write Supabase directly with anon key   | Express API only (`shared/api.js` + `lib/api.ts`). No direct Supabase writes — `supabaseClient.ts` is read-only     |
| Realtime     | Supabase `postgres_changes` on `orders` + `shipments` (`useRealtimeOrders.js`, `useRealtimeShipments.js`); WebSocket fallback to polling | Supabase `postgres_changes` on `orders` + `shipments` via `useRealtimeData.ts` (250ms debounce, AppState-aware reconnect) |
| Auth         | JWT in localStorage, `/auth/me` + refresh, `RoleGuard` on routes                                        | JWT in AsyncStorage, same `/auth/me` + refresh flow, role-aware UI                                                  |
| Offline      | N/A (online-only browser app)                                                                           | None. AsyncStorage for token/URL only; no SQLite, WatermelonDB, or write queue                                      |

---

## Feature Parity Matrix

Status legend: **Present** (full parity), **Partial** (subset of web functionality), **Missing** (no mobile equivalent). Notes cite the file or QA bug ID where one applies.

### Orders

| Feature                              | Web                            | Mobile                              | Status      | Notes                                                                                  |
| ------------------------------------ | ------------------------------ | ----------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| Order list / search / filter         | OrdersPage                     | OrdersScreen                        | **Present** | Selection mode + bulk actions on both.                                                 |
| Order create form                    | OrdersPage modal               | OrderFormScreen                     | **Present** | Both POST `/api/orders` → `orderMutations.js` → audit fires.                           |
| Order edit / patch                   | OrderDetailModal               | OrderDetailScreen + OrderForm       | **Present** | PATCH `/api/orders/:id`; audited via `history.recordFieldDiffs` (server.js:1682).      |
| Order delete                         | OrdersPage row action          | OrderDetailScreen (QA #121)         | **Present** | DELETE `/api/orders/:id` with cascade + audit (server.js:1797).                        |
| Order History tab (audit trail)      | OrderDetailModal History tab   | —                                   | **Missing** | OrdersApi has no `history()` on mobile; backend endpoint exists. See Risk #1.          |
| Bulk CSV / Excel import              | OrdersPage → orderImportService.js | —                              | **Missing** | Largest functional gap. No CSV picker, no XLSX parser, no `/bulk-plan/import` call.    |
| Order line items (CRUD)              | OrderDetailModal Lines tab     | OrderFormScreen + LineItemsEditor   | **Present** | Both POST `/api/orders/:id/lines`.                                                     |
| Order → Shipment chain view          | OrderDetailModal               | OrderDetailScreen                   | **Present** | Both surface linked shipment IDs.                                                      |
| Status cascade (order ↔ shipment)    | Server-side                    | Server-side                         | **Present** | `orderMutations.syncLinkedShipmentForOrderStatus` runs regardless of caller.           |

### Shipments & Tracking

| Feature                          | Web                                       | Mobile                                                       | Status      | Notes                                                                                                  |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| Shipment list                    | ShipmentsPage                             | ShipmentsScreen                                              | **Present** | Status filter parity.                                                                                  |
| Shipment detail                  | ShipmentDetailModal                       | ShipmentDetailScreen                                         | **Present** | Both load from `GET /api/shipments/:id`.                                                               |
| Shipment create / edit form      | ShipmentsPage / NewShipmentModal          | NewShipmentModal (read-mostly detail)                        | **Partial** | Mobile has create modal but no full edit form for non-status fields. Status updates via `/:id/status`. |
| Shipment status update           | ShipmentDetailModal                       | ShipmentDetailScreen                                         | **Present** | PATCH `/api/shipments/:id/status` (validated server-side, QA #63).                                     |
| Shipment History / Timeline      | Timeline tab                              | `shipmentDetailService.shapeShipmentHistoryRows`             | **Present** | `ShipmentsApi.history()` consumed; mirrors web shape (QA #168).                                        |
| Tender flow (carrier)            | tenderService.js + ShipmentDetailModal    | TenderRespondModal                                           | **Partial** | Mobile has respond UI; sendEmail/draft tender wizard not on mobile.                                    |
| Live tracking map                | LiveTrackingPage (Leaflet)                | LiveTrackingScreen                                           | **Present** | Both surface position log; verify map provider parity (Leaflet vs RN map lib).                        |
| BOL / POD generation             | DocumentsPage + documentService.js        | DocumentService + DocumentViewerModal                        | **Partial** | Mobile generates and views; web has full template editor + html2pdf export.                           |
| Carrier portal (external)        | CarrierPortalPage                         | CarrierPortalScreen                                          | **Partial** | Mobile carrier-portal flows are limited to invite/respond; web hosts full portal.                      |

### Bulk Import & Planning

| Feature                                      | Web                              | Mobile                                              | Status      | Notes                                                                                                |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| CSV / Excel order import                     | orderImportService.js + XLSX     | —                                                   | **Missing** | Mobile has no file picker / no header normalisation.                                                 |
| Bulk plan (multi-order consolidation)        | BulkPlanPage                     | BulkPlanScreen + Results                            | **Present** | Mobile parity is good; both call `BulkPlanApi.plan`.                                                 |
| Bulk plan failure cards / edit-in-place      | BulkPlanPage                     | PlanResultCard, FailedOrderCard, OrderEditModal     | **Present** | Mobile mirrors web's recovery flow.                                                                  |
| Multi-stop route builder                     | MultiStopRoutesPage              | MultiStopRoutesScreen                               | **Partial** | Template build + execute exist; route history/detail view absent on mobile.                         |
| Rate card bulk upload                        | rateUploadService.js             | —                                                   | **Missing** | Single-row rate edits exist on mobile (EditRateScreen); bulk upload not ported.                      |
| Order Row # → child entity sheet linking     | Import format conventions        | —                                                   | **Missing** | Web import expects separate sheets keyed by Order Row #. No mobile equivalent.                       |

### OMS Sync & Middleware

| Feature                                                                                  | Web                                            | Mobile                       | Status      | Notes                                                                                                              |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| OMS app (Sales Orders, Inventory)                                                        | zoree-oms.html (anon-key direct)               | —                            | **Missing** | Standalone HTML app. No mobile equivalent — likely intentional (separate persona).                                |
| Middleware admin portal                                                                  | zoree-middleware.html                          | —                            | **Missing** | Mappings, event log, transfer log, connections — admin-only on web.                                                |
| OMS → TMS push of orders                                                                 | omsSync/pushOrderService.js + Express          | Receives via realtime        | **Present** | Server-side. Mobile sees new orders via Supabase realtime.                                                         |
| OMS customer dropdown parity                                                             | DbApi.customers() (oms_customers active)       | DbApi.customers() (DataContext.tsx) | **Present** | Mobile mirrors QA #113 fix.                                                                                        |
| OMS WebSocket events (`tender_accepted`, `shipment_status_updated`, `shipment_delivered`) | omsLive/omsWsClient.js                         | —                            | **Missing** | Mobile does not subscribe to the Express WebSocket; only to Supabase orders/shipments realtime. See Risk #2.       |
| Middleware queue status                                                                  | useMwQueueStatus + mwQueueService              | —                            | **Missing** | Operator-facing; reasonable to defer.                                                                              |
| Messaging hub (event inspector / test send)                                              | MessagingHubPage                               | Placeholder (IntegrationTab) | **Missing** | Drawer slot reserved; not implemented.                                                                             |

### Other Domains

| Feature                              | Web                                | Mobile                                                       | Status      | Notes                                                                |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------- |
| Carriers master                      | CarriersPage                       | CarriersScreen + CarrierDetail                               | **Present** |                                                                      |
| Rate management (single)             | RateManagementPage                 | RateManagementScreen + EditRateScreen                        | **Present** | Mobile maps full rate model (LTL/TL, lane, equipment).               |
| Lane preferences                     | LanePreferencesPage                | LanePreferencesScreen (placeholder)                          | **Missing** | Mobile screen is a stub.                                             |
| Carrier bids / RFQ                   | CarrierBidsPage                    | CarrierBidsScreen                                            | **Partial** | Mobile shows bids list; RFQ creation surface is web-only.            |
| Freight invoices + audit             | FreightInvoicesPage, FreightAuditPage | FreightInvoicesScreen, FreightAuditScreen                 | **Present** | PDF export parity unverified — likely web-only.                      |
| Documents management                 | DocumentsPage                      | DocumentsTab placeholder                                     | **Missing** | Drawer slot reserved on mobile; no list/upload UI yet.               |
| Customer portal                      | CustomerPortalPage                 | InviteCustomerModal                                          | **Partial** | Mobile invites; full visibility console is web.                      |
| Analytics / dashboards               | AnalyticsPage, DashboardPage       | AnalyticsScreen, DashboardScreen                             | **Present** | Charts simplified on mobile; verify metric set parity.               |
| Reports (6 templates)                | ReportsPage                        | ReportsScreen                                                | **Partial** | Mobile builder exists; confirm all 6 templates wired.                |
| Alerts / notifications               | AlertsPage                         | AlertsScreen                                                 | **Present** | No push notifications to device; in-app only.                        |
| Compliance (HOS, hazmat, certs)      | CompliancePage                     | ComplianceScreen                                             | **Partial** | Read-only on mobile; create/edit cert flow is web-only.              |
| Dock scheduling                      | DockSchedulingPage                 | DockSchedulingScreen                                         | **Present** | Both wire round-robin assignment server-side.                        |
| Fleet management                     | FleetManagementPage                | FleetManagementScreen + DriverFormModal + VehicleFormModal   | **Present** |                                                                      |
| Equipment master                     | EquipmentMasterPage                | EquipmentMasterScreen + EquipmentFormModal                   | **Present** |                                                                      |
| Item master                          | ItemMasterPage (placeholder)       | ItemMaster + ItemForm                                        | **Present** | Mobile is more complete here than web.                               |
| Location master                      | LocationMasterPage (placeholder)   | LocationMaster + LocationForm                                | **Present** | Mobile is more complete here than web.                               |
| Planning parameters                  | PlanningParametersPage             | PlanningParametersScreen                                     | **Present** |                                                                      |
| Network modeling                     | NetworkModelingPage (placeholder)  | NetworkModelingScreen (placeholder)                          | **Present** | Both stubs — parity by absence.                                      |
| Route optimizer                      | RouteOptimizerPage (placeholder)   | —                                                            | **Partial** | Web stub exists; mobile has no equivalent screen.                    |
| DB Explorer (admin SQL)              | DbExplorerPage                     | DbExplorerScreen (placeholder)                               | **Missing** | Mobile screen is a stub; admin tool, low priority.                   |
| User management (RBAC)               | UserManagementPage                 | —                                                            | **Missing** | Admin tool; reasonable to defer.                                     |
| Roles & permissions editor           | UserRolesPage                      | —                                                            | **Missing** | Admin tool; reasonable to defer.                                     |
| Settings                             | SettingsPage                       | SettingsScreen                                               | **Partial** | Mobile uses Settings only for API base URL override.                 |
| Login / auth                         | LoginPage                          | Login flow (RootNavigator)                                   | **Present** |                                                                      |
| AI assistant (zoreeAI)               | zoreeAIService.js                  | —                                                            | **Missing** | Web-only.                                                            |

---

## Data Sync Analysis

### 1. Shared backend (write path)

Mobile and web share the same Express API base URL and JWT auth (`frontend/src/lib/api.js`, `mobile/src/lib/api.ts` → `mobile/src/shared/api.js`). Mobile has zero direct Supabase writes — `supabaseClient.ts:15` explicitly states the client is read-only and is used only for `postgres_changes` subscriptions. Every mobile mutation routes through Express, which means RBAC (`rolePermissions.canWriteTable`), tenant scoping, and rate-cache invalidation behave identically to web.

### 2. Realtime subscriptions

Web and mobile subscribe to the same set: `orders` and `shipments` tables via Supabase `postgres_changes` (`frontend/src/hooks/useRealtimeOrders.js`, `useRealtimeShipments.js`; `mobile/src/state/useRealtimeData.ts`). Both debounce at 250 ms. Mobile additionally listens to AppState to refresh on resume. No coverage drift on these two tables.

### 3. Change-audit (REQ-02) compliance from mobile

Verified by reading `server.js`. The dedicated entity routes call the audit pipeline:

- `PATCH /api/orders/:id` (server.js:1586) → `history.recordFieldDiffs` at line 1682 and `history.recordChange` at 1691, 1700.
- `POST /api/orders` (server.js:1719) → `history.recordChange` at 1761.
- `DELETE /api/orders/:id` (server.js:1774) → `history.recordChange` at 1797 (cascade-aware).
- `PATCH /api/db/shipments/:id` (generic route) special-cases shipments at server.js:1280 and calls `shipService.recordRawPatchAudit` — so even legacy `DbApi.upsert('shipments', …)` calls from mobile produce audit rows (QA #168 fix in `mobile/src/services/shipmentService.ts:136`).

**The gap:** the generic `/api/db/:table` POST/PATCH (server.js:1191/1236) only fires audit for shipments. Mobile writes to `rates`, `locations`, `equipment`, `drivers`, `vehicles`, `dock_appointments`, and `documents` through `DbApi.upsert`, which means those tables are never appended to `change_history`. This is identical to web behaviour, so it is a shared design issue, not a mobile regression — but it is worth flagging because the rule docs imply blanket audit coverage.

### 4. Audit visibility on mobile

`ShipmentsApi.history(id)` exists (`mobile/src/shared/api.js:377`) and is consumed by `services/shipmentDetailService.ts:221` to render the timeline. **There is no equivalent `OrdersApi.history` method, and `OrderDetailScreen.tsx` has no History tab.** The backend endpoint `/api/orders/:id/history` is live and used by the web (`frontend/src/services/historyService.js:165`), so this is purely a mobile UI gap, not a data gap.

### 5. OMS / Middleware sync awareness

The two HTML apps (`zoree-oms.html`, `zoree-middleware.html`) bypass Express entirely and write Supabase directly using the anon key. The `anon_all USING(true) WITH CHECK(true)` RLS policies on `orders`, `shipments`, `mw_*`, `oms_*` are load-bearing for these apps. Web reacts to OMS state changes via `omsLive/omsWsClient.js` — a WebSocket subscriber on the Express bridge. Mobile does not connect to that WebSocket; it only listens to Supabase `postgres_changes` on `orders` + `shipments`. So:

- If OMS pushes a new order or a shipment status change, both web and mobile see it (orders/shipments tables broadcast through Supabase realtime).
- If OMS or middleware pushes a dock-config, `mw_*` mapping, or transfer-log event, web sees it via the WebSocket bridge; mobile is blind until the user pulls to refresh and triggers a full DataContext re-fetch.

### 6. Auth / session

Compatible. Both stores hold token + refresh_token (localStorage on web, AsyncStorage on mobile), both 401 → `POST /auth/refresh` → retry, both call `/auth/me` at boot. Role switching uses the same `/auth/role` endpoint. Tokens issued on one client work on the other.

---

## Identified Risks & Gaps

### Risk #1 — No order-history visibility on mobile

**Severity: medium.** Web users can open any order and see field-level changes attributed to a user, bucketed by (action, user, second). Mobile users cannot. This breaks the compliance promise of REQ-02 if mobile is the primary audit-review surface for any role. Server-side data exists; this is a missing UI surface (`OrdersApi.history` method + `OrderDetailScreen` History tab + a copy of `shapeOrderHistoryRows` in services).

### Risk #2 — Mobile is blind to OMS / Middleware state changes

**Severity: medium.** Web's `omsWsClient.js` subscribes to Express WebSocket events (`tender_accepted`, `shipment_status_updated`, `shipment_delivered`, dock-config changes). Mobile does not. For the order/shipment subset this is masked by Supabase realtime on those tables, but anything OMS-or-middleware-driven that does not write to the orders/shipments tables (e.g. middleware queue state, dock-config edits, `mw_*` mappings) is invisible until a manual refresh.

### Risk #3 — No bulk import on mobile

**Severity: high if any user persona depends on it; low if mobile is execution-only.** Web's OrdersPage import flow uses `orderImportService.js` (header alias matching, CSV/Excel, server-side validation via `POST /bulk-plan/import`) and a documented Order Row # convention for child entities. Replicating this on mobile is non-trivial: file picker (`expo-document-picker`), XLSX/CSV parser, header alias map, and a dedicated review/error screen. Realistically a multi-day mobile feature.

### Risk #4 — Generic `/api/db` writes skip audit for non-shipment tables

**Severity: low (shared with web), but worth fixing.** Mobile rate/location/equipment/driver/vehicle/dock writes via `DbApi.upsert` do not produce `change_history` rows. If audit is required for these entities by policy, the fix belongs in `api/services/changeHistoryGenericPatch.js` (or extending the shipment special-case) — not in mobile. Mobile already routes through Express, so fixing the server fixes both clients.

### Risk #5 — No offline queue or local persistence on mobile

**Severity: medium for field/driver users.** Mobile is online-first. A flaky connection silently shows stale cached data with no offline indicator and no write queue. If any user persona is in low-coverage areas (driver pickups, dock floors), this is a usability + data-integrity problem. Solving it is a structural change (SQLite or WatermelonDB + retry queue + conflict policy).

### Risk #6 — Tender wizard, document editor, RFQ creation are web-only

**Severity: low (manager-persona features).** These are reasonable to defer if mobile is execution-focused, but they should be on the roadmap with explicit deferral rather than implicit absence.

---

## Recommended Next Steps

If you decide to act on this audit, the following sequence keeps mobile/web aligned without conflicting with `CLAUDE_RULES.md` (services-first, modular, file-by-file).

### Phase 1 — Close the audit-trail UI gap (small)

- Add `OrdersApi.history(id, limit)` in `mobile/src/shared/api.js` next to the existing `ShipmentsApi.history`.
- Add `services/orderDetailHistoryService.ts` (mirrors `shipmentDetailService.shapeShipmentHistoryRows`). One file, pure mapper.
- Add a History tab section to `OrderDetailScreen.tsx` that calls the service. Reuses existing TimelineList component.
- Acceptance: an order edited on web shows the correct change list on mobile within one refresh.

### Phase 2 — Subscribe mobile to Express WebSocket (medium)

- Port `frontend/src/lib/wsClient.js` to mobile (`mobile/src/lib/wsClient.ts`) — keep it framework-free.
- Add a `useExpressEvents` hook that DataContext consumes; on `tender_accepted` / `shipment_status_updated` / `dock_config_changed` events, refresh the relevant slice.
- Acceptance: an OMS-driven dock change shows up on mobile without pull-to-refresh.

### Phase 3 — Bulk order import (large; only if user persona needs it)

- Decide whether mobile bulk import is in scope. If yes: `expo-document-picker` + a vetted XLSX parser, then port `orderImportService.js` header-alias map verbatim.
- Reuse the existing `POST /bulk-plan/import` endpoint — no API work needed.
- Mirror web's review/errors screen as a dedicated mobile screen. Don't try to retrofit OrdersScreen.

### Phase 4 — Server-side: extend audit to generic table writes

- Add a `recordRawPatchAudit` equivalent for `rates`, `locations`, `equipment`, `drivers`, `vehicles` in `api/services/changeHistory.js`. Wire it into the generic `/api/db/:table` POST/PATCH/DELETE handlers.
- Both clients benefit immediately. No mobile work needed.

### Phase 5 — Offline-first mobile (structural; defer until validated)

- Only pursue if a confirmed user persona operates in low-coverage areas.
- Pick a single source of truth: SQLite + a write queue, with last-writer-wins conflict policy and a visible offline banner.
- This is not a sprint — it is an architecture pass and should be planned with the product owner.

---

## Appendix

### Methodology

Three parallel exploration passes: (1) full inventory of `frontend/` routes, pages, services, and hooks; (2) full inventory of `mobile/` screens, components, services, and navigators; (3) targeted sync analysis tracing API base URLs, realtime subscriptions, and audit-pipeline coverage. Every load-bearing claim was spot-checked by reading source: `server.js` audit hooks (lines 1191, 1236, 1280, 1586, 1682, 1719, 1761, 1797), `api/services/orderMutations.js`, `mobile/src/shared/api.js` OrdersApi/ShipmentsApi/DbApi blocks, `mobile/src/lib/supabaseClient.ts` read-only declaration, and a grep for direct Supabase mutation calls in `mobile/src` (zero matches outside the `laneUtils.Array.from` helper).

### Caveats

- Memory used as orientation (`project_zoree_tms.md`, `feedback_engineering_rules.md`, `project_orders_mappers.md`) was 14–19 days old; specific code claims in this report are sourced from current files, not memory.
- Coverage for screens marked **Partial** was inferred from file presence + agent summary; deeper feature-level checks (e.g. specific report templates, chart sets, filter widgets) were not exhaustively walked.
- Worktrees under `.claude/worktrees/` were excluded from inventory — those are scratch copies.
- This is an audit, not an implementation plan. Effort estimates in the recommendations are rough sequencing hints, not resourced commitments.

### Files that informed this report

- `frontend/src/App.jsx`, `frontend/src/lib/api.js`, `frontend/src/services/historyService.js`, `frontend/src/hooks/useRealtimeOrders.js`, `useRealtimeShipments.js`
- `mobile/src/App.tsx`, `mobile/src/lib/api.ts`, `mobile/src/lib/supabaseClient.ts`, `mobile/src/shared/api.js`, `mobile/src/state/DataContext.tsx`, `useRealtimeData.ts`, `AuthContext.tsx`
- `mobile/src/services/ordersService.ts`, `shipmentService.ts`, `shipmentDetailService.ts`, `rateService.ts`, `routeService.ts`
- `api/server.js` (lines 1177–1310 generic `/db/:table`; 1586–1845 `/orders` endpoints), `api/services/orderMutations.js`, `api/services/changeHistory.js`
