# AI agents — Quote, Carrier Sourcing, Track & Trace, Freight Audit, POD

Five back-office agents built on one shared runner. **Agents only propose.** Every action waits in the Agent Console (`/agents`) until a person approves it. On approval it executes through the same single-writer service the UI uses, so REQ-02 change_history, patch guards and status gates apply unchanged.

## Structure

```
api/
  migrations/050_agent_framework.sql      agent_runs + agent_actions
  routes/agents.js                        /api/agents/*  (thin)
  services/
    rating/tlQuoteService.js              TL pricing (shared priceTlRate with /api/bulk-plan/rate)
    mail/smtpTransport.js                 SMTP transport (shared with tender email)
    agents/
      index.js                            registers the 5 agents
      agentCatalog.js                     agents, action types, role-matrix table per action
      agentPolicies.js                    confirm | auto | forbidden per action (env override)
      agentRunner.js                      run → propose → approve/reject → execute
      agentRunStore.js                    only reader/writer of agent_runs / agent_actions
      llm/claudeTool.js                   schema-only Claude call (server key)
      outbound/outboundMessage.js         Messaging Hub record + optional SMTP send
      quote/            index · rfqExtractor (Claude) · quotePricing (pure)
      carrierSourcing/  index · carrierScoring (pure)
      trackTrace/       index · carrierReplyClassifier (Claude) · etaRisk (pure)
      freightAudit/     index · auditRules (pure)
      pod/              index · podExtractor (Claude vision) · podMatching (pure)
  scripts/agentDemoSeed.js                demo loads/invoices (ids contain DEMO; --reset removes)
frontend/src/
  pages/AgentConsolePage.jsx
  components/agents/  AgentTabs · AgentRunForm · RunCard · ActionCard · forms/* · findings/*
  hooks/useAgents.js  (React Query)       services/agentsService.js       constants/agentDemo.js
  public/demo/pod-sample.png              (regenerate: scripts/demo/make_pod_image.py)
```

## What each agent does

| Agent | Input | Uses | Proposes → executes via |
|---|---|---|---|
| Quote | RFQ email (Claude reads it) or one lane | `tlQuoteService` (rates via `rateMatcher`, EIA FSC schedule, zip_geo miles), margin rule | `SEND_QUOTE` → customer email |
| Carrier Sourcing | shipment id, or scan Planned loads with no carrier | carriers (mode, weight, on-time, claims), contract price on the lane, lane history | `SEND_LOAD_OFFER` → Messaging Hub `TENDER_OFFER`; `ASSIGN_CARRIER` → `shipmentMutations.changeShipmentCarrier` |
| Track & Trace | scan moving loads, or a carrier reply (Claude reads it) | pickup/delivery dates, last update age | `SEND_CHECK_CALL` → Messaging Hub `EVENT_NOTIFICATION`; `APPLY_SHIPMENT_EVENT` → `shipmentEvents.applyShipmentEvent`; `NOTIFY_CUSTOMER` → email |
| Freight Audit | invoice id, or scan Rejected / On Hold | cost lines vs rated shipment, EIA bracket, duplicate check, delivery status | `DISPUTE_INVOICE` → `invoiceAudit.manualDecide('Disputed')` + dispute email; `APPROVE_INVOICE` → `manualDecide('Approved')` |
| Document / POD | photo, PDF or text (Claude vision) | match on shipment id / BOL / PRO; piece count | `MARK_DELIVERED` → `applyShipmentEvent('Delivered')` + POD document; `CREATE_INVOICE` → `invoiceFromShipment`; `FLAG_OSD` → timeline note |

Freight audit and carrier sourcing are deterministic rules (no LLM), so the numbers are reproducible. Claude is used only where the input is unstructured: RFQ emails, carrier replies and delivery paperwork. It gets a schema-only tool and no TMS tools.

## Configuration (api/.env)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Needed for Quote (email), Track & Trace (reply) and POD |
| `AGENT_MODEL` | `claude-sonnet-5-5` | Model for agent reads |
| `AGENT_EMAIL_SEND` | `false` | `true` = approved messages are emailed over SMTP. Off = recorded only (demo-safe; carrier addresses are sample data) |
| `AGENT_POLICY_<ACTION>` | `confirm` | e.g. `AGENT_POLICY_SEND_CHECK_CALL=auto` to let check calls go without approval |
| `AGENT_QUOTE_MARGIN_PCT` / `AGENT_QUOTE_MIN_MARGIN_USD` / `AGENT_QUOTE_VALID_DAYS` | 15 / 150 / 7 | Quote margin rule |
| `AGENT_TRACE_LOOKBACK_DAYS` | 14 | Track & Trace ignores loads whose key date is older |

## Guarantees

- **Idempotent:** `(tenant_id, idempotency_key)` is unique, so re-running an agent never re-proposes or double-executes the same action.
- **Atomic claim:** approval moves `proposed → executing` in one conditional update, so two people clicking at once can't both execute.
- **Approver is the actor:** history rows carry the approving user, and timeline notes are prefixed `[Zoree AI · <agent>]`.
- **Role matrix:** approving needs Edit on the table the action changes (orders / shipments / invoices).

## Not yet

- LTL quoting through CzarLite: the Quote agent prices TL contract lanes today.
- Inbound automation: the agents run from the console. The email-intake poller and a schedule can trigger them later (the `trigger` column already allows `email` / `schedule`).
- Voice check calls: see Phase 1b in `agentic-architecture-plan.md`.
