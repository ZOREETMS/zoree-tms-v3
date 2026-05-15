# QA Fix Plan — Items #313–#339

Drafted 2026-05-15. Covers 27 QA items reported by Rohith. Sequenced into four phases; Phase 1 first per request.

Each phase is one logical commit (per engineering rule on file-by-file delivery), but Phase 4 is split per-module since each module rewrite is independently shippable.

## Phase 1 — Mobile role visibility (#331–#338)

**Root cause (verified):** `mobile/src/navigation/drawerNavConfig.ts` puts `Settings` inside the `System` group alongside `User Management` and `User Roles`. The drawer filter (`drawerNavFilter.ts`) drops groups whose `children` array is empty after per-item `canSeeNav` filtering. But `Settings` is in `COMMON` in `mobile/src/config/roleMatrix.ts`, so every role keeps it — the System group is therefore never empty, and its header stays visible for planner/finance/viewer.

Web has the same structural setup but extra hides `Settings` via a DB-driven `role_feature_permissions` matrix (`useFeatureAccessMap()` + `matrixHides(featureKey)` in `frontend/src/components/Layout.jsx:85–93`). Mobile does not call that matrix in the drawer filter.

**Fix (single file pair, plus role matrix expansion):**

1. `mobile/src/navigation/drawerNavConfig.ts`
   - Add optional `restrictedToRoles?: CanonicalRole[]` field to `DrawerNavGroup`.
   - Mark the `system` group `restrictedToRoles: ['admin']`.
   - Keep `Settings` where it is — admins still see it in the System group; non-admins reach Settings via the existing user/account chip in the header (already a registered screen per comment at line 167–173).

2. `mobile/src/navigation/drawerNavFilter.ts`
   - After per-child filtering, drop any group whose `restrictedToRoles` is set and does not include the canonical active role.
   - Reuse `canonicalRole(role)` import from `config/roleMatrix`.

3. `mobile/src/config/roleMatrix.ts`
   - Rewrite `ROLE_NAV.viewer` to "everything minus SYSTEM":
     `[...COMMON, ...PLANNING, ...EXECUTION, ...FINANCE, ...DOCS, ...INTEGRATION, ...INSIGHTS]`.
   - This addresses #333 (Planning visible), #334 (Execution), #335 (Finance), #336 (Integration), #337 (Insights including Network Modeling + DB Explorer). Group-level gate from step 2 covers #338 (no System for viewer).
   - `planner` and `finance` already correctly exclude SYSTEM children — the group-level gate from step 2 finishes #331 and #332.

4. Optional but cheap: update the existing role-matrix test if there is one (`mobile/src/config/__tests__/roleMatrix.test.ts` if it exists) with the new viewer surface.

**Settings reachability for non-admins:** verify the account-chip → Settings path actually works on the mobile drawer header before shipping. If it doesn't, fall back to adding a top-level `Account` group with just `Settings` (single-child group, no restriction).

**Verification checklist:**
- Log in as admin → System group with all three children visible.
- Switch to planner → System group hidden; Settings still reachable from header.
- Switch to finance → System hidden; finance modules visible; Settings reachable from header.
- Switch to viewer → System hidden; Planning/Execution/Finance/Integration/Insights all visible; Settings reachable from header.
- Snapshot drawer per role if there is a snapshot test.

**Risk:** Low. Three small surgical edits, no schema, no API, no business logic.

---

## Phase 2 — TMS web bugs (#313, #314, #339)

### #313 Planning Parameters ordering
- `frontend/src/services/planningParametersService.js:4–6` — `DbApi.planningParameters()` has no ORDER BY.
- `frontend/src/components/db-explorer/TableSidebar.jsx:16` — generic `SELECT * FROM planning_parameters LIMIT 50` with no ORDER BY.
- Find what column the Planning Parameters module visually orders by (likely `id` ASC since it has no explicit sort and the DB returns insertion order). Verify by reading the rendered table on the page and the DB primary key.
- **Fix:** add `ORDER BY id ASC` (or the verified key) to both queries so module + DB Explorer agree. Per DB rules: no schema change needed; this is a query change.

### #314 OMS Sales Orders copy — lane items not consistently copied
- `frontend/src/services/ordersService.js:281–314` — `copyOrder()` and `copyOrderLines()` duplicate `order_lines` only.
- Recon flagged that "lane items" likely refers to lane consolidation groupings (`groupByLane()` at `orders.js:98–115`), which are computed, not stored — but the bug says lane items are *sometimes* missed, which points to a row-level field on `order_lines` that isn't being copied.
- **Next step before fixing:** open the `order_lines` table schema (`api/services/orderLines.js` + DB migrations) and diff against what `copyOrderLines()` actually copies. The two-mapper drift (`apiOrderToDbPatch` vs `orderToDb`) per project memory means a lane-related column may exist in one but not the other.
- **Fix:** extend `copyOrderLines()` to include all `order_lines` columns (or call `orderToDb` with the source row instead of cherry-picking fields). Add a unit test covering the lane-id columns.

### #339 Excel import — line item data not mapped
- `frontend/src/services/orderImportService.js:145–192` — `parseOrderFile()` reads the "Line Items" sheet and maps headers (`orderRow`, `lineNum`, `itemId`, `description`, `qtyOrdered`, `unitWeight`, `totalWeight`).
- `api/services/orderLines.js` — `buildLines()` is the backend consumer; the bulk-plan import orchestrator may not call it.
- **Next step before fixing:** trace the POST body shape from `orderImportService.js` to `POST /api/bulk-plan/import` and verify the server attaches line items per parsed order. Check `bulkPlanImport.bugfix.test.js:31` for the expected shape.
- **Fix:** wire `buildLines()` into the bulk-plan import orchestrator, keyed off `orderRow`. Surface the error currently shown so we know the failure mode. Add a focused test that imports a 1-order + 2-line-item fixture.

**Risk:** Medium. #314 and #339 touch the orders write path which is audited per REQ-02 — must verify the audit pipeline still records the change correctly (per project memory on `genericTableAudit`).

---

## Phase 3 — Mobile quick UI fixes

Cluster of small mobile UI gaps that don't require module rewrites.

| Bug | File | Change |
|-----|------|--------|
| #316 | `mobile/src/screens/items/ItemMasterScreen.tsx` | Wire Export to existing `csvExport` shared primitive (per memory) instead of share intent. |
| #317 | `mobile/src/screens/items/ItemMasterScreen.tsx:59` | Replace "Filter by Class" button row with dropdown. |
| #318 | `mobile/src/screens/items/ItemMasterScreen.tsx:46–51` | Add "Product Catalog" label; place `MasterTabSwitch` (Table/Card) next to items data. |
| #320 (export) | `mobile/src/screens/shipments/ShipmentsScreen.tsx:33–40` | Wire Export to `csvExport`. |
| #320 (toggle) | `mobile/src/screens/shipments/ShipmentsScreen.tsx` | Add List/Map toggle. |
| #320 (filters) | `mobile/src/screens/shipments/ShipmentsScreen.tsx` | Replace status pills with search + dropdown filters. |
| #323 (export) | `mobile/src/screens/compliance/ComplianceScreen.tsx` | Wire Export to `csvExport`. |
| #326 (filter) | `mobile/src/screens/freight/FreightAuditScreen.tsx` | Replace All/Matched/Discrepancy buttons with dropdown. |
| #326 (message) | `mobile/src/screens/freight/FreightAuditScreen.tsx` | Show success/error toast after Auto Audit click. |
| #329 (export) | `mobile/src/screens/analytics/AnalyticsScreen.tsx:48–64` | Extend Export to include "Cost per Shipment" and "Claims" columns. |

**Risk:** Low–medium. Each change is local to one screen file. Shared primitives (`csvExport`, `MasterTabSwitch`, `DateRangeChips`) per project memory.

---

## Phase 4 — Mobile module parity rewrites

Larger per-module rewrites. Each is a separate commit so a regression in one doesn't block the others.

### #315 Mobile Home / Overview
- `mobile/src/screens/home/HomeScreen.tsx:85–100` — add `InsightsCard`, `ActivityCard`, "+ Create Shipment" button. Match `frontend/src/pages/HomePage.jsx`.

### #319 Packaging Units
- `mobile/src/screens/items/ItemMasterScreen.tsx:34–35` (Packaging Units sub-tab) — render `PackagingStatsGrid` (Total Pkg Types, Cartons, Pallets), add packaging units list, convert filter to dropdown. Mirror `frontend/src/pages/ItemMasterPage.jsx:126–134`.

### #321 Carriers detail columns
- `mobile/src/screens/carriers/CarriersScreen.tsx:1–80` — extend columns to include scac, mode, email, phone, contact. Mirror `frontend/src/pages/CarriersPage.jsx:28`.

### #322 Fleet Management
- `mobile/src/screens/fleet/FleetScreen.tsx:60–68` — add title/description header, `Assign Driver` + `Add Vehicle` buttons, row actions Edit/Assign/Track, dashboard cards. Mirror `frontend/src/pages/FleetManagementPage.jsx:17–35`.

### #323 Compliance
- `mobile/src/screens/compliance/ComplianceScreen.tsx:26–66` — add `CarrierCertsCard`, hazmat/weight/HOS section headers, title/description. Mirror `frontend/src/pages/CompliancePage.jsx`.

### #324 Lane Preferences
- `mobile/src/screens/lanes/LanePreferencesScreen.tsx:57–65` — fix Add button to actually call create endpoint; add Edit/Disable/Delete row actions.

### #325 Carrier Bid Management
- `mobile/src/screens/bids/CarrierBidsScreen.tsx:28–56` — wire Create RFQ button to the existing API; add dashboard stats (Open/Awarded/Closed).

### #326 Return Auto Audit dashboard
- `mobile/src/screens/freight/FreightAuditScreen.tsx` — show Pending Review section (in addition to filter + message fixes from Phase 3).

### #327 Documents & BOL
- `mobile/src/screens/documents/DocumentsScreen.tsx:34–80` — title/description header, dashboard sections, dropdown type filter, row actions limited to View/Send only.

### #328 Network Modeling
- `mobile/src/screens/network/NetworkModelingScreen.tsx:31–46` — add Save Scenario + Run Analysis buttons, finish WhatIfBuilder, wire scenario persistence (likely an existing endpoint already used by web). Mirror `frontend/src/pages/NetworkModelingPage.jsx`.

### #329 Analytics & Reports dashboard
- `mobile/src/screens/analytics/AnalyticsScreen.tsx` — fix Cost per Shipment value, add Claims column to Carrier Scorecard. (Export fix in Phase 3.)

### #330 User Management order
- `mobile/src/screens/admin/UserManagementScreen.tsx:79–100` — sort users to match web's order; add sort indicator if web has one.

**Risk:** Medium. Each module touches its own file plus possibly one or two shared components. No schema/migration changes anticipated; any new server endpoint needed is already used by web (mobile is calling the same API).

---

## Phase ordering and shipping cadence

1. **Phase 1** (role visibility) — single commit, ~30 min, immediately verifiable. Ship first.
2. **Phase 2** (TMS web 3 bugs) — single commit per bug because they're unrelated. ~1–2 h total. Ship after Phase 1 verified.
3. **Phase 3** (mobile quick wins) — single commit per file; can batch ones touching the same screen. ~2 h total.
4. **Phase 4** (mobile rewrites) — one commit per module; ship them as a series.

## Verification

- For mobile changes, run any existing Jest tests in `mobile/`. Add focused unit tests for the role filter change (Phase 1) and the order copy/import changes (Phase 2).
- Do not run a real DB migration as part of these fixes (none required per the plan).
- After each phase, ask the user to re-verify the corresponding QA items rather than self-marking them done.

## Open questions before starting Phase 2

- For #313: what column does the Planning Parameters module actually order by visually? I will read the rendered page to find out before fixing.
- For #314: which `order_lines` columns are getting dropped on copy? I'll diff the schema vs the copy logic before fixing.
- For #339: is the import currently throwing a specific error message, or silently dropping line items? The bug says "error is shown" — I want the actual error text to find the failure point fast.

I'll resolve these as I get to Phase 2 — they don't block Phase 1.
