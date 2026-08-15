# Zoree TMS — Agentic Architecture Plan

Status: PROPOSED (2026-07-29)
Scope: voice agents for ZoreeAI + four autonomous back-office agents (tendering, exceptions/tracking, invoice audit, order intake). Plan only — implementation in follow-up sprints.

---

## 1. Current state (baseline)

One agentic flow exists today: **ZoreeAI**, the web copilot.

- `frontend/src/services/zoreeAIService.js` — calls Anthropic directly from the browser (`claude-sonnet-4-6`, dangerous-direct-browser-access).
- `frontend/src/services/zoreeAIContext.js` — hand-built system prompt from a live data snapshot + action registry.
- `frontend/src/services/zoreeAIActionsService.js` — ~20 executable actions; 4 gated behind confirmation (`DESTRUCTIVE_CHAT_ACTIONS`).
- `frontend/src/components/ZoreeAI.jsx` — agent loop (parse ```action``` blocks → execute → feed result back).
- Voice today: browser Web Speech API only (`useSpeechRecognition.js` / `useSpeechSynthesis.js`) — no cloud voice, no barge-in, poor quality on mobile browsers.

Known problems the plan must fix before adding agents:

1. **Leaked API key** — `VITE_ANTHROPIC_API_KEY` is inlined into the client bundle; anyone loading the app gets the key.
2. **Auth bypass** — AI mutations go frontend → Supabase directly, skipping Express-layer authorization and some audit paths.
3. **No agent audit trail** — REQ-02 `change_history` records the *what*, but not *which agent, which run, which prompt* caused a change.
4. **Under-inclusive confirmation set** — `TENDER_ACCEPT` and `CREATE_INVOICE_FROM_SHIPMENT` auto-execute despite financial weight.

Existing infrastructure the agents will reuse (no new frameworks needed):

| Piece | File | Role for agents |
|---|---|---|
| Queue worker pattern | `api/services/mwQueueWorker.js` + `mwQueueHandlers/` | Template for background agent runners (setInterval → runOnce → handler registry) |
| Event bus | `api/services/eventBus.js` (`EVENTS.ORDER_*`, `SHIPMENT_*`) | Trigger source for reactive agents; SSE/WS bridge already broadcasts to web + mobile |
| Tendering services | `api/services/tendering/tenderOut.js`, `tenderIn.js` | Tool layer for the Tendering Agent |
| Rate matching | `api/services/rateMatcher.js`, `laneQuoteCache.js`, `fscSchedule.js` | Carrier selection inputs |
| Deterministic invoice audit | `api/services/invoiceAudit.js` (REQ-06, single writer of `invoices`) | The Invoice Agent wraps this — never replaces it |
| Order ingest | `api/services/orderIngest.js`, `bulkPlanExecution.js` | Tool layer for the Intake/Planning Agent |
| Audit pipeline | `changeHistory.js`, `genericTableAudit.js` (REQ-02) | Every agent write flows through these |
| Guards | `orderPatchGuards.js` | Enforced on agent writes too (e.g. dates frozen after tender-accept) |

---

## 2. Target architecture

```
                        ┌─────────────────────────────────────────────┐
                        │                Express API                  │
 Web ZoreeAI ──────────▶│  /api/ai/chat      AI Gateway (proxy)       │
 Mobile ZoreeAI ───────▶│  /api/ai/voice     Voice session broker     │
 Voice (phone) ────────▶│  /api/ai/telephony ElevenLabs webhooks      │
                        │                                             │
                        │  agentRunner.js    shared agent loop        │
                        │  agentTools/       server-side tool registry│
                        │  agentPolicies.js  autonomy + spend caps    │
                        ├─────────────────────────────────────────────┤
   eventBus events ────▶│  Agents (queue-worker pattern):             │
   agent_queue rows ───▶│   tenderingAgent · exceptionAgent           │
   schedules ──────────▶│   invoiceAgent   · intakeAgent              │
                        ├─────────────────────────────────────────────┤
                        │  changeHistory / genericTableAudit (REQ-02) │
                        │  agent_runs / agent_actions (new, REQ-02.5) │
                        └─────────────────────────────────────────────┘
                                          │
                                       Supabase
```

Design rules (per `docs/CLAUDE_RULES.md`): services-first, modular layers, no mega-files. Each agent is a thin orchestrator over existing services — **agents never write to the DB directly**; they call the same single-writer services the UI and routes use, so REQ-02 auditing and patch guards apply automatically.

---

## 3. Phase 0 — Foundation (prerequisite, ~1 sprint)

**P0.1 AI Gateway.** New `api/routes/ai.js` + `api/services/aiGateway.js`. Express proxies Anthropic calls; `ANTHROPIC_API_KEY` becomes a server-only env var. Frontend `zoreeAIService.js` switches its base URL to `/api/ai/chat`. Delete `VITE_ANTHROPIC_API_KEY` and rotate the leaked key immediately (it is already public to anyone who loaded the app).

**P0.2 Route AI mutations through the API.** `zoreeAIActionsService.js` currently calls frontend services → Supabase. Repoint each action at the corresponding Express endpoint (`/api/orders`, `/api/shipments`, `/api/tendering`, `/api/invoices`) so role permissions (`rolePermissions.js`) and audit apply. Note: per the frontend CORS rule, no `credentials:"include"` — keep the existing token-header auth.

**P0.3 Agent audit tables.** New migration (next number in `supabase/migrations/`, per `docs/zoree_db_rules.pdf` checklist):

- `agent_runs` — id, agent_name, trigger (event/schedule/user/voice), status, started_at, finished_at, model, token_usage, summary.
- `agent_actions` — id, run_id FK, action_type, entity_type, entity_id, payload jsonb, outcome, requires_confirmation bool, confirmed_by/at.
- `change_history.changed_by` convention: `agent:<name>#<run_id>` so REQ-02 rows link back to runs.

**P0.4 Autonomy policy.** `api/services/agentPolicies.js` — one table-driven policy replacing the frontend `DESTRUCTIVE_CHAT_ACTIONS` set. Three tiers per action: `auto`, `confirm`, `forbidden`. Move `TENDER_ACCEPT` and `CREATE_INVOICE_FROM_SHIPMENT` to `confirm`. Same policy is enforced server-side for chat, voice, and background agents (background agents route `confirm`-tier actions to a human task queue instead of executing).

**P0.5 Shared agent runner.** `api/services/agentRunner.js` — the loop ZoreeAI.jsx implements client-side, moved server-side: build context → call model via gateway → parse tool calls → check policy → execute via service layer → append result → repeat (bounded iterations, per-run token budget). Use the Messages API tool-use blocks instead of parsing ```action``` fences. `agentTools/` holds one module per domain (orders, shipments, tendering, rates, invoices) exporting JSON-schema tool defs + executors that wrap existing services.

Exit criteria: no Anthropic key in any client bundle; every AI mutation appears in `change_history` with an `agent:` actor; web ZoreeAI behavior unchanged from the user's perspective.

---

## 4. Phase 1 — Voice agents for ZoreeAI (~1–2 sprints)

Two distinct products; build in this order.

### 1a. In-app voice copilot (web + mobile)

Replace Web Speech API with a realtime pipeline so ZoreeAI is usable hands-free in warehouses/cabs.

- **Recommended: ElevenLabs Agents Platform.** Managed WebRTC/WebSocket voice loop (STT + turn-taking + barge-in + TTS). Configure it with a **custom LLM endpoint pointed at our AI Gateway** (`/api/ai/voice-llm`) so the brain stays our Claude + tool registry — ElevenLabs handles only the audio loop. Tool calls surface as webhooks to `/api/ai/telephony/tools`, which dispatch through `agentRunner` under the same policy tiers. `confirm`-tier actions are read back verbally ("I'm about to tender shipment S-1042 to Werner for $1,840 — say confirm").
- **Alternative (no new vendor):** server pipeline `/api/ai/voice` — browser streams mic audio over the existing WS server, API does STT (Deepgram or Whisper) → agentRunner → TTS. More control, significantly more work (VAD, interruption, latency tuning). Choose only if vendor lock-in is a blocker.
- Mobile: the same ElevenLabs session runs in React Native — this becomes the first ZoreeAI surface on mobile, partially closing the `tms_parity_audit.md` gap without porting the chat UI first.
- Frontend deliverables: `useVoiceAgent` hook + a mic state in `ZoreeAI.jsx`; keep `useSpeechSynthesis` as a zero-dependency fallback.

### 1b. Outbound telephony agent (carrier check calls)

The tendering and exception agents (Phase 2) get a **phone tool**: an ElevenLabs outbound-calling agent (Twilio number) that can

- call a carrier that hasn't responded to a tender within SLA ("do you accept load O-2231, pickup Thursday?") and record accept/decline → `tendering/tenderIn.js`;
- make check calls on in-transit shipments with stale tracking and log the answer as a shipment event → `shipmentEvents.js`.

Every call gets an `agent_runs` row + transcript stored in `agent_actions.payload`. Calls never auto-accept on the carrier's behalf beyond what the tender policy allows; ambiguous answers create a human task.

---

## 5. Phase 2 — Autonomous back-office agents (~2–3 sprints, one agent per slice)

All four follow the same shape: a queue worker (clone of the `mwQueueWorker.js` pattern) that wakes on eventBus events, schedule ticks, or `agent_queue` rows; runs `agentRunner` with a narrow tool set; writes only through existing services.

### 2a. Tendering / carrier-selection agent — `api/services/agents/tenderingAgent.js`

- Trigger: `ORDER_CREATED`/order planned events + a schedule tick for tender SLA timeouts.
- Loop: fetch plannable orders → `rateMatcher.js` + `laneQuoteCache.js` + `fscSchedule.js` for candidates → LLM ranks with reasons (cost, transit, carrier performance, equipment via `equipmentLimits.js`) → `tenderOut.js` to tender (policy tier: `confirm` initially, `auto` per-lane once trusted) → on decline/timeout, re-tender to next candidate; escalate after N attempts; optionally place a 1b phone call.
- Hard rule: never touch `ready_date`/`due_date` — those are user intent and frozen after tender-accept (see `orderPatchGuards.js`).
- Caveat: the tender-accept cascade (`propagateTenderAcceptance`) currently lives **frontend-side** (`frontend/src/services/tenderAcceptanceNotifier.js`); server-side `tendering/tenderIn.js` only exposes `recordTenderResponse`. A background agent can't call frontend code, so Phase 0.2 must also move the accept cascade into `tenderIn.js` (single server-side implementation — this also fixes the known drift between the two mobile propagation paths).

### 2b. Exception & tracking agent — `agents/exceptionAgent.js`

- Trigger: `SHIPMENT_UPDATED` events + schedule tick scanning for stale in-transit shipments, missed pickups, POD overdue.
- Loop: classify anomaly → auto-actions: `FLAG_EXCEPTION`, `ADD_SHIPMENT_EVENT`, status corrections, notify via `messagingHub/` writer → `confirm`-tier: re-plan or carrier change proposals surfaced as tasks.
- Feeds web/mobile live via the existing SSE/WS bridge — no new realtime channel needed.

### 2c. Invoice-audit agent — `agents/invoiceAgent.js`

- The deterministic REQ-06 tolerance check in `invoiceAudit.js` stays authoritative for approve-within-tolerance. The agent handles what REQ-06 rejects or can't decide: read `invoiceCostLines.js` breakdown → explain the variance in plain language (wrong FSC bracket? duplicate accessorial? re-rated lane?) → recommend approve/dispute with evidence → `confirm` tier for any status change beyond REQ-06's own decision; `CREATE_INVOICE_FROM_SHIPMENT` for delivered-but-uninvoiced shipments also `confirm`.
- Output: a queue of annotated invoice decisions, not silent writes.

### 2d. Order-intake / planning agent — `agents/intakeAgent.js`

- Trigger: inbound email/CSV/spreadsheet drops (extend `orderIngest.js` beyond OMS JSON) + `ORDER_CREATED` for auto-planning.
- Loop: LLM extracts structured orders from messy input → validate via `serviceLevelVocab.js` + import-format conventions (separate address columns, child-entity sheets linked by Order Row #) → create via order services (both mapper paths — `apiOrderToDbPatch` and `orderToDb` — must stay in sync) → plan via `bulkPlanExecution.js`, implementing **P216 auto-split on equipment weight limits** (`equipmentLimits.js`) as part of this agent.
- Policy: order creation from a trusted source `auto`; planning/tendering handoff follows 2a's tiers.

---

## 6. Cross-cutting guardrails

- **Human-in-the-loop queue:** `confirm`-tier actions from background agents land in an "Agent Approvals" inbox (web first, mobile later) instead of executing; approving executes via the same service call, recording `confirmed_by`.
- **Budgets:** per-agent daily token + action caps in `agentPolicies.js`; breach pauses the agent and alerts via messagingHub.
- **Kill switch:** `agents.enabled` flag per agent (env or tenant setting) — workers check it every tick.
- **Idempotency:** every agent action carries `run_id`; executors reject duplicate (run_id, action, entity) tuples so retried ticks can't double-tender or double-invoice.
- **DB changes:** all new tables via versioned migrations following the 8-item checklist in `docs/zoree_db_rules.pdf`; no ad-hoc schema.
- **Testing:** each agent ships with a dry-run mode (plans actions, writes `agent_actions` with outcome='dry_run', executes nothing) — dry-run in production for ≥1 week before enabling `auto` tiers.

---

## 7. Sequencing & estimates

| Phase | Deliverable | Est. |
|---|---|---|
| 0 | AI gateway, key rotation, API-routed mutations, audit tables, policy, agentRunner | 1 sprint |
| 1a | In-app voice copilot (web, then mobile) | 1 sprint |
| 1b | Outbound telephony agent (tool for Phase 2) | 0.5 sprint |
| 2a | Tendering agent (dry-run → confirm → auto per lane) | 1 sprint |
| 2b | Exception & tracking agent | 0.5–1 sprint |
| 2c | Invoice-audit agent | 0.5 sprint |
| 2d | Intake/planning agent incl. P216 auto-split | 1 sprint |

Phase 0 is non-negotiable first — it also fixes the two live security issues. 1a and 2a can proceed in parallel after it. Ordering within Phase 2 can follow business pain; 2a is listed first because tendering has the clearest ROI and its phone tool (1b) doubles for 2b.

## 8. Open decisions

1. ElevenLabs Agents vs. self-built voice pipeline (recommendation: ElevenLabs, custom-LLM mode).
2. Model tiering — Sonnet for copilot/voice, Haiku for high-volume classification (exception triage, invoice explanation) to control cost.
3. Whether Agent Approvals inbox is a new page or folds into the existing exceptions/tasks UI.
4. Tenant scoping — per-tenant agent enablement and policies (`tenants.js`) from day one, or single-tenant first.
