# Rules audit — changes from 2026-10-11 to 2026-10-25

Checked against `docs/CLAUDE_RULES.md` and `docs/zoree_db_rules.pdf`.
Backup of every file touched by this audit: `_backup_audit_2026-10-25/`.

## In scope (modified in the last two weeks)

| Change | Verdict | Fix |
|---|---|---|
| `api/services/shipmentEvents.js` — withdraw-tender order sync (Oct 17) | Compliant (service layer, tested) | — |
| Migration `049_email_order_intake.sql` | Compliant — 8-item checklist present, CHECK-controlled statuses, audit fields, JSONB justified | — |
| `api/services/orderCreate.js` | Compliant — single writer, REQ-02 history, rollback on line failure | — |
| `api/server.js` — `fetchAllRows` paged reader inline (§1, §6) | Violation: data-access helper in the route mega-file | Moved to `api/services/db/pagedRead.js`; server.js keeps a 3-line wrapper |
| `api/server.js` — JWT verification cache inline (§1, §6) | Violation | Moved to `api/middleware/authUserCache.js` (`createAuthUserCache`) |
| `api/routes/emailIntake.js` — `/paste` parses sender + builds the email in the route (§6, >10 lines) | Violation | Route is now one line → `intakeService.processPastedEmail`; parsing in `parseSender` |
| `api/services/emailIntake/intakeService.js` — mapping + DB + orchestration in one 400-line module (§1) | Violation | Split into `draftMapper.js` (pure), `intakeRepository.js` (DB), `intakeService.js` (orchestration); exports kept stable |
| `frontend/src/pages/EmailOrdersPage.jsx` — server state with useState/useEffect polling (§3) | Violation | `hooks/useEmailIntake.js` (React Query, 30s refetch); `ago()` → `utils/formatters.formatAgo` |
| `components/email-orders/IntakeCard.jsx` — builds the created-orders summary inline | Minor | `emailIntakeService.summarizeCreatedOrders` |
| `frontend/src/pages/OrdersPage.jsx` — ~130 lines of Unassign / Unplan-All orchestration + confirm copy inline (§1, §6) | Violation | `hooks/useBulkUnplan.js` (service orchestration stays in `bulkUnplanService`) |
| `OrdersPage` + `BulkPlanPage` — duplicated planning-progress state (§2) | Violation (duplication) | `hooks/usePlanProgress.js` shared by both |
| `OrdersPage` — inline elapsed formatter + timer badge markup | Minor | `utils/formatters.formatElapsed`, `components/orders/PlanTimerBadge.jsx` |
| `frontend/src/lib/api.js` — `fetchPaged`, `EmailIntakeApi` | Compliant (data layer) | — |
| `App.jsx`, `Layout.jsx`, `roleMatrix.js` — Email Orders route/nav | Compliant (RoleGuard + matrix entry) | — |

## Verification
- API tests: 328/328 pass (323 before + 5 new in `__tests__/auditRefactor.test.js`).
- Frontend `vite build`: green.
- API boot smoke test: `/health` 200, `/api/email-intake/status` 401 without token (auth gate intact).

## Outside the window — flagged, not changed
- `OrdersPage.jsx` (~100 KB) and `api/server.js` (~220 KB) are pre-existing mega-files; they need a planned decomposition, not a drive-by.
- `/jev-inbox`, `/jev-carrier`, `/jev-bulk-plan` routes (Oct 2) are not wrapped in `RoleGuard` like every other route.
- ZoreeAI still calls Anthropic from the browser (`VITE_ANTHROPIC_API_KEY`) — Phase 0.1 of `docs/agentic-architecture-plan.md`.
