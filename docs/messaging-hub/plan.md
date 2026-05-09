# Messaging Hub — End-to-End Plan

**Owner:** TMS Platform
**Status:** Draft (no code yet)
**Date:** 2026-05-08
**Scope:** Capture the full 6-message OMS ↔ TMS ↔ Carrier lifecycle inside the Messaging Hub.

This plan follows `docs/CLAUDE_RULES.md` (modular layers, services-first, file-by-file delivery, no mega-files) and the 8-item DB output checklist from `docs/zoree_db_rules.pdf`. It reuses the existing inbound/outbound ledger pattern established by `integration_event_log` (Fusion/OIC) so we do not introduce a duplicate source of truth.

---

## 1. Lifecycle in scope

The Messaging Hub must persist every hop of this lifecycle, in both directions:

| # | Edge | Direction (relative to TMS) | Source | Target | Lifecycle event |
|---|------|------------------------------|--------|--------|-----------------|
| 1 | OMS → TMS | inbound  | OMS     | TMS     | `order_creation` |
| 2 | TMS → Carrier | outbound | TMS  | CARRIER | `shipment_tender` |
| 3 | Carrier → TMS | inbound  | CARRIER | TMS  | `tender_response` |
| 4 | TMS → OMS | outbound | TMS    | OMS     | `shipment_details` |
| 5 | OMS → TMS | inbound  | OMS    | TMS     | `ship_confirmation` |
| 6 | TMS → OMS | outbound | TMS    | OMS     | `delivered` |

Each row will appear in the Messaging Hub list view with the existing direction chips (📥/📤) and link back to the originating order/shipment.

---

## 2. Existing landscape (do not re-invent)

- **Ledger pattern:** `integration_event_log` (Supabase, `20260502_fusion_integration.sql`) already has `direction`, `status`, `payload jsonb`, `received_at`, `processed_at`, `source`, `object_type`, `external_id`, `internal_id`, `oic_instance_id`, `error`, `tenant_id`. The Messaging Hub will reuse the same shape, not parallel it.
- **Single writer:** `api/services/fusionIngest/eventLog.js` exposes `start / markProcessed / markFailed`. Our hub writer will follow the same idempotent pattern.
- **Frontend UI:** `frontend/src/pages/MessagingHubPage.jsx` plus `components/messaging/{MessageList,JsonViewer,ComposeMessageModal,MessagingStats}.jsx` already render direction, status, type, dest, ref, timestamp. Today the page is fed by `services/messagingService.js` `generateMessages()` (synthetic). The plan replaces that feed with a real API call — UI stays untouched except for prop wiring.
- **Enums:** `frontend/src/types/messaging.js` defines `MESSAGE_TYPES`, `DIRECTIONS`, `STATUSES`, `DESTINATION_SYSTEMS`, `PRIORITIES`. We extend, never rename.
- **REQ-02 audit:** `api/services/changeHistory.js` is the single writer for change history. The hub writer is a sibling service — same shape, different table — so REQ-02 stays untouched.

---

## 3. Architecture (Step 1 of CLAUDE_RULES output workflow)

Layers, top-down:

```
UI (React)
  └─ pages/MessagingHubPage.jsx, components/messaging/*  ← unchanged
Hooks
  └─ hooks/useMessaging.js                                ← swap seed → React Query
Services (frontend)
  └─ services/messagingApi.js                             ← NEW: HTTP client
─── HTTP boundary ───
Routes (api)
  └─ api/routes/messagingHub.js                           ← NEW
Services (api, business logic)
  ├─ api/services/messagingHub/writer.js                  ← NEW (single writer)
  ├─ api/services/messagingHub/reader.js                  ← NEW (queries for UI)
  ├─ api/services/messagingHub/types.js                   ← NEW (enums + guards)
  └─ api/services/messagingHub/correlate.js               ← NEW (order/shipment linkage)
Integration adapters (call the writer at the 6 hops)
  ├─ api/services/omsSync.js                              ← edit (hooks 1, 4, 5, 6)
  ├─ api/services/shipConfirm.js                          ← edit (hook 5)
  ├─ api/services/tendering/*                             ← edit (hooks 2, 3)
  └─ api/services/fusionIngest/*                          ← unchanged
Database
  └─ api/migrations/038_messaging_hub.sql                 ← NEW (canonical for application tables)
```

UI never calls Supabase directly. Adapters never write the ledger directly — they go through `messagingHub/writer.js`.

---

## 4. File list (Step 2 of CLAUDE_RULES output workflow)

Files to be created, in delivery order. **Each will be its own commit / file-by-file generation pass.**

### Database
1. `api/migrations/038_messaging_hub.sql` — new table `message_log` + lookup tables + indexes. (`api/migrations/` is the canonical home for application-table migrations; `supabase/migrations/` is reserved for auth/RLS/multi-tenant plumbing.)

### Backend services (services-first per CLAUDE_RULES §4)
2. `api/services/messagingHub/types.js` — `MESSAGE_TYPE`, `SYSTEM_PARTY`, `DIRECTION`, `STATUS` enums + validators.
3. `api/services/messagingHub/writer.js` — `recordInbound`, `recordOutbound`, `markDelivered`, `markFailed`, `incrementAttempt`. Single writer; mirrors `fusionIngest/eventLog.js`. Each call accepts an optional caller-supplied transaction handle so the ledger insert and the business-logic commit happen atomically (per `zoree_db_rules.pdf` §Data Integrity 3); when none is supplied, the writer opens its own short transaction.
4. `api/services/messagingHub/correlate.js` — resolves `order_id` / `shipment_id` from incoming payloads.
5. `api/services/messagingHub/reader.js` — `listMessages({filters, page})`, `getMessage(id)`, `computeKpis()`, `replay(id)`. Read-side queries only.

### Backend routes
6. `api/routes/messagingHub.js` — `GET /api/messaging-hub/messages`, `GET /api/messaging-hub/messages/:id`, `GET /api/messaging-hub/kpis`, `POST /api/messaging-hub/messages/:id/retry`, `POST /api/messaging-hub/compose`. Thin layer; no business logic per CLAUDE_RULES §10.

### Adapter edits (existing files, minimal diffs)
7. `api/services/omsSync.js` — call `recordInbound` for hooks 1 + 5; call `recordOutbound` for hooks 4 + 6.
8. `api/services/shipConfirm.js` — call `recordInbound` (SHIP_CONFIRMATION).
9. `api/services/tendering/tenderOut.js` — call `recordOutbound` (SHIPMENT_TENDER).
10. `api/services/tendering/tenderIn.js` — call `recordInbound` (TENDER_RESPONSE).

(If `tendering/*` does not yet exist as a module, this plan implicitly creates the boundary — the writer call goes wherever tender-out/tender-in is invoked today.)

### Frontend
11. `frontend/src/services/messagingApi.js` — fetch/React-Query wrapper for the 5 routes.
12. `frontend/src/types/messaging.js` — **edit** to add `ORDER_CREATION`, `SHIP_CONFIRMATION`, and `SYSTEM_PARTY` (`OMS | TMS | CARRIER`). Existing values stay — forward-only.
13. `frontend/src/hooks/useMessaging.js` — **edit** to consume `messagingApi` instead of `generateMessages()`. Keep filter/select/retry contract identical so `MessagingHubPage.jsx` does not change.
14. `frontend/src/services/messagingService.js` — **edit** to remove `generateMessages` (move to `__seed__` for storybook/tests) and keep `filterMessages`, `computeMessagingKpis`, `getTypeLabel`, `getStatusColor`, `buildComposePayload`.

No mega-files: every new file stays under ~250 lines per CLAUDE_RULES §1.

---

## 5. Database design — 8-item output (per `zoree_db_rules.pdf`)

### 5.1 Schema changes

New table `message_log` (one row per hop, mirrors `integration_event_log` shape):

| Column | Type | Notes |
|--------|------|-------|
| `id` | BIGSERIAL PK | |
| `message_type` | TEXT NOT NULL | FK → `message_type_lookup.code` |
| `direction` | TEXT NOT NULL | CHECK IN ('inbound','outbound') |
| `source_system` | TEXT NOT NULL | FK → `system_party_lookup.code` |
| `target_system` | TEXT NOT NULL | FK → `system_party_lookup.code` |
| `correlation_id` | TEXT | OMS/Carrier-supplied tracking key |
| `order_id` | BIGINT | FK → `orders.id` (nullable, soft) |
| `shipment_id` | BIGINT | FK → `shipments.id` (nullable, soft) |
| `external_ref` | TEXT | OMS order #, carrier load #, etc. |
| `status` | TEXT NOT NULL DEFAULT 'received' | FK → `message_status_lookup.code` |
| `attempt_count` | INT NOT NULL DEFAULT 0 | |
| `last_error` | TEXT | |
| `payload` | JSONB NOT NULL | raw body |
| `headers` | JSONB | transport headers (auth-stripped) |
| `actor` | TEXT | user/service id that emitted |
| `tenant_id` | TEXT NOT NULL | multi-tenant isolation |
| `received_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `processed_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | audit field per `zoree_db_rules.pdf` §Schema Design 5 |
| `updated_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | audit field |

Lookup tables (per `zoree_db_rules.pdf` §Data Integrity 4 — controlled values):
- `message_type_lookup (code TEXT PK, label TEXT, edge TEXT)` — seeded with the 6 lifecycle codes plus existing `MESSAGE_TYPES` from `frontend/src/types/messaging.js`.
- `system_party_lookup (code TEXT PK, label TEXT)` — seeded `OMS, TMS, CARRIER`.
- `message_status_lookup (code TEXT PK, label TEXT, terminal BOOLEAN)` — seeded `pending, sent, delivered, acknowledged, received, failed, replayed`.

### 5.2 Migration files

Single forward-only migration: `api/migrations/038_messaging_hub.sql` (next sequential after `037_seed_equipment_types.sql`). Uses `CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING` for seeds. No `DROP`. Follows `zoree_db_rules.pdf` §Migration 1, 4.

### 5.3 Backfill / data migration

- **None required** for hooks going forward.
- `integration_event_log` rows stay where they are — they describe the Fusion edge, which is *not* one of the 6 hops in scope. We do **not** copy or duplicate; the Hub UI will UNION the two tables in `reader.js` (single source of truth per ledger, joined at read-time).

### 5.4 Index changes

On `message_log`:
- `UNIQUE (source_system, correlation_id) WHERE correlation_id IS NOT NULL` — idempotency guard.
- `idx_ml_status_received (status, received_at DESC)` — ops query "failed in last 24h".
- `idx_ml_order (order_id) WHERE order_id IS NOT NULL` — order timeline view.
- `idx_ml_shipment (shipment_id) WHERE shipment_id IS NOT NULL` — shipment timeline view.
- `idx_ml_type_dir (message_type, direction, received_at DESC)` — Hub list filters.

No speculative indexes (per `zoree_db_rules.pdf` §Performance 2).

### 5.5 Constraint changes

- `CHECK (direction IN ('inbound','outbound'))`
- `CHECK (attempt_count >= 0)`
- FKs to lookup tables (RESTRICT on delete).
- Soft FKs to `orders`/`shipments` are nullable + indexed; **no `ON DELETE CASCADE`** — keep the audit row even if the order is purged.

### 5.6 Rollback considerations

Forward-only per rules. Rollback = stop writing (feature flag `MESSAGING_HUB_PERSIST=false`) + leave table in place. Table is additive; nothing else depends on its existence at write time.

### 5.7 Affected APIs / services / UI

- **APIs (new):** 5 routes under `/api/messaging-hub/*` (see §4 file 6).
- **Services (edited):** `omsSync.js`, `shipConfirm.js`, `tendering/tenderOut.js`, `tendering/tenderIn.js` — each gains exactly one writer call at the existing emit/receive boundary. No business-logic changes.
- **UI (edited):** `useMessaging.js`, `messagingService.js`, `types/messaging.js`. Component files (`MessageList`, `JsonViewer`, `ComposeMessageModal`, `MessagingStats`) unchanged — they already render the props the new feed will produce.
- **Mobile:** `mobile/src/screens/messaging/MessagingScreen.tsx` — needs the same `messagingApi` swap as web, but kept out of v1 to limit scope.

### 5.8 Risks and assumptions

- **R1 — duplicate ledger drift:** if anyone writes to `message_log` outside `messagingHub/writer.js`, we lose the single-writer guarantee. Mitigation: code review + grep guard in CI for direct `INSERT INTO message_log`.
- **R2 — payload PII:** raw OMS/carrier payloads may contain customer addresses. Mitigation: `headers` and `payload` are stripped of auth tokens in the writer; tenant_id is required.
- **R3 — correlation gaps:** carrier may respond to a tender we never recorded outbound (e.g., manually emailed). Mitigation: `correlate.js` falls back to soft-link by `external_ref` and flags `status='received'` with `order_id IS NULL` for human triage.
- **R4 — volume:** 6 hops × N orders/day. Sized like `integration_event_log` — JSONB payload + targeted indexes; no perf concern at TMS scale today.
- **A1:** the existing `integration_event_log` will remain Fusion-only. We do not generalize it because that would require renaming `oic_instance_id` and `source` semantics — violates `zoree_db_rules.pdf` §Migration 2 (no rename without safe transition).
- **A2:** lookup tables are preferred over Postgres ENUM for forward-compatibility (adding a new code = `INSERT`, not `ALTER TYPE`).

---

## 6. Integration map for the 6 hops (Step 4 of CLAUDE_RULES output workflow)

For each hop: where the writer is called, what gets persisted, what the UI shows.

| # | Hop | Writer call | Source file | Persisted fields |
|---|-----|-------------|-------------|------------------|
| 1 | OMS → TMS `order_creation` | `recordInbound({type:'ORDER_CREATION', src:'OMS', tgt:'TMS', payload, headers, correlation_id})` | `omsSync.js` (existing inbound endpoint) | order_id resolved by `correlate.js` |
| 2 | TMS → Carrier `shipment_tender` | `recordOutbound({type:'SHIPMENT_TENDER', src:'TMS', tgt:'CARRIER', payload, shipment_id})` | `tendering/tenderOut.js` | status='sent' on success, 'failed' on error |
| 3 | Carrier → TMS `tender_response` | `recordInbound({type:'TENDER_RESPONSE', src:'CARRIER', tgt:'TMS', payload, correlation_id})` | `tendering/tenderIn.js` | linked to outbound tender via `correlation_id` |
| 4 | TMS → OMS `shipment_details` | `recordOutbound({type:'SHIPMENT_UPDATE', src:'TMS', tgt:'OMS', payload, shipment_id})` | `omsSync.js` | emitted after tender accepted |
| 5 | OMS → TMS `ship_confirmation` | `recordInbound({type:'SHIP_CONFIRMATION', src:'OMS', tgt:'TMS', payload, order_id})` | `shipConfirm.js` | status='received' → 'processed' after `shipConfirm` finishes |
| 6 | TMS → OMS `delivered` | `recordOutbound({type:'SHIPMENT_STATUS', src:'TMS', tgt:'OMS', payload:{status:'delivered'}, shipment_id})` | `omsSync.js` | terminal — `status='delivered'` |

The writer is invoked **after** the existing business logic succeeds (or in the `catch` for failed outbound). Adding the writer never changes the business-logic outcome — it only records.

---

## 7. Rollout order

1. **Migration + lookup seed** (file 1). Deploy. No code references it yet — safe.
2. **Backend services + routes** (files 2–6). Deploy behind `MESSAGING_HUB_PERSIST=false`. Routes return empty.
3. **Adapter edits** (files 7–10). One PR per adapter, file-by-file per CLAUDE_RULES §7. Still flagged off.
4. **Flip flag on in staging.** Verify all 6 hops produce a row each.
5. **Frontend swap** (files 11–14). Page now reads from real data; falls back to seed if API empty (transition window only).
6. **Production flip.** Remove fallback. Decommission `generateMessages` from production bundle.

Each step is independently revertible.

---

## 8. Out of scope for v1

- Mobile screen wiring (`MessagingScreen.tsx`) — tracked as follow-up.
- Replay UI for failed messages — backend `replay(id)` exists, but the button stays disabled until v2.
- Generalizing `integration_event_log` — see assumption A1.
- Any change to `apiOrderToDbPatch` / `orderToDb` mappers (memory: they have already drifted; this plan adds zero new mapper paths).

---

## 9. Review hooks (CLAUDE_RULES §11)

After file-by-file generation, run:
1. "Review this code against architecture rules" against each new file.
2. Grep for direct `message_log` writes outside `messagingHub/writer.js`.
3. Confirm `frontend/src/types/messaging.js` did not lose any existing enum value (forward-only).
