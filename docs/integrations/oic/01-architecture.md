# Oracle Fusion ↔ Zoree TMS Integration via Oracle Integration Cloud (OIC)

**Status:** Design — 2026-05-02
**Owner:** Sridhar
**Scope:** Bidirectional integration between Oracle Fusion (Order Management + Inventory) and Zoree TMS v3, brokered by Oracle Integration Cloud.

---

## 1. Goals

1. **Sales Orders / Shipment Requests** booked in Fusion OM appear automatically as orders + shipment candidates in Zoree TMS — no manual entry, no batch lag.
2. **Inventory on-hand and material transactions** are visible to TMS so planners can validate stock availability and reconcile post-shipment.
3. **Shipment status, tracking, weights, charges, and PoD** generated in TMS flow back to Fusion OM/Inv to close the order/shipment lifecycle.
4. **Master data** (items, organizations/subinventories, customers, carriers) stays in lock-step Fusion → TMS, with Fusion as the system of record.
5. Every cross-system write is auditable end-to-end (Fusion `BusinessEventId` ↔ OIC `instance_id` ↔ TMS `change_history` row).

## 2. Non-goals

- Replacing Fusion as the source of truth for items, customers, locations, or financial data.
- Replacing Zoree TMS as the source of truth for transportation execution (rates, planning, tendering, telematics).
- Replacing the existing OMS↔TMS middleware (`frontend/zoree-middleware.html`, `api/services/mwQueueHandlers/*`) — that pipeline continues to serve the Zoree-OMS app. The Fusion integration is **additive**, not a rewrite.

## 3. Topology

```
┌─────────────────────┐        OIC (Gen 3)            ┌─────────────────────┐
│  Oracle Fusion      │   ┌────────────────────┐      │  Zoree TMS v3       │
│  - OM (DOO)         │──▶│  Inbound flows     │─────▶│  Express API        │
│  - Inventory        │   │  F1, F2, F4        │      │  /api/ingest/...    │
│  - ERP Events       │   ├────────────────────┤      │                     │
│                     │◀──│  Outbound flow F3  │◀─────│  fusionPublisher    │
└─────────────────────┘   └────────────────────┘      │  (eventBus listener)│
        ▲                          │                  └─────────┬───────────┘
        │  REST / Adapter          │  REST                      │
        │  (OAuth 2 client-creds)  │  (mTLS or X-API-Key)       │
        └──────────────────────────┴────────────────────────────┘
                                                                │
                                                                ▼
                                                        Supabase Postgres
                                                        + change_history
                                                        + SSE → React UI
```

- **Direction-of-flow naming**: Inbound = Fusion → TMS. Outbound = TMS → Fusion.
- **OIC** is the only system that talks to Fusion (Adapter) and to TMS (REST). Neither side knows about the other directly. This keeps secrets in OIC's vault and lets us swap either endpoint independently.

## 4. Integration style — event-driven with batched recovery

| Flow | Trigger | Why |
|---|---|---|
| F1 — Fusion SO/Shipment Request → TMS | Fusion business event subscription (`oracle.apps.scm.dso.processShipmentRequestEvent`, `oracle.apps.scm.oom.salesOrder.update`) | Near real-time; planner sees the order as soon as OM books it. |
| F2 — Fusion Inventory → TMS | (a) Material-transaction business event for transactions; (b) scheduled BICC / REST extract every 15 min for on-hand snapshot | Transactions are event-y, on-hand is a derived snapshot — different cadences. |
| F3 — TMS shipment status → Fusion | TMS in-process `eventBus` (`SHIPMENT_UPDATED`) + `fusionPublisher` HTTP push to OIC inbound REST | Already wired in shipConfirm/shipmentEvents. Reuse, don't reinvent. |
| F4 — Master data sync (items, locations, carriers) | Scheduled OIC integration (nightly + on-demand) + business events for incremental | Master data churn is low; full nightly + delta events is the standard pattern. |

**Recovery / reconciliation:** Every event flow has a sibling **scheduled "delta sweep"** that runs every 30 minutes, queries Fusion for records changed since the last successful sweep watermark, and re-pushes any that didn't make it through the event path. This guards against missed events and OIC outages without forcing the planner to chase tickets.

## 5. Why these endpoints (not "just call Fusion REST directly")

- **OIC handles auth refresh, retries, mapping, and audit.** Building all of that in `api/services/` would reinvent the integration platform we already pay for.
- **OIC isolates Fusion's payload churn.** When Oracle revs the SO REST shape between Fusion releases, the TMS contract stays stable — only the OIC mapping changes.
- **OIC's connection vault holds Fusion creds.** TMS never sees Fusion's OAuth client secret.
- **OIC error hospital + monitoring** is the integration ops surface. We don't want another "queue I have to babysit" inside TMS.

## 6. Authentication

| Hop | Mechanism | Notes |
|---|---|---|
| OIC → Fusion (Adapter) | OAuth 2.0 client credentials, scoped to ERP Integration role | Stored in OIC connection. |
| Fusion → OIC (event delivery) | OIC inbound URL is registered as the Fusion ERP CSF event subscription target with OAuth | Configured once per environment in Fusion's `Manage Integrations` task. |
| OIC → TMS | `X-API-Key` header (Bearer also supported) — same pattern `api/routes/ingest.js` already uses | Key stored in OIC connection; rotated via env var `INGEST_API_KEY`. |
| TMS → OIC | OAuth 2.0 client-credentials issued by OIC; `fusionPublisher` caches token, refreshes on 401 | Client ID/secret in TMS env (`OIC_CLIENT_ID`, `OIC_CLIENT_SECRET`, `OIC_TOKEN_URL`). |

**Secret hygiene:** No Fusion or OIC secrets land in TMS source — everything flows through env vars + a runtime config service. Rotate keys quarterly; re-issue on personnel change.

## 7. Idempotency & duplicate handling

- **TMS ingest endpoints are idempotent on the natural key.** F1 keys on `fusion_so_header_id` (or `fusion_shipment_request_id`); F2 transactions on `fusion_transaction_id`; F4 items on `fusion_item_id`. Re-delivering the same payload produces no second row and no spurious history entry.
- **OIC instance_id** is recorded in the TMS `integration_event_log` table for each call. If OIC retries an instance, TMS short-circuits when it sees the same `instance_id`.
- **Watermark cursor** for delta sweeps is stored in `integration_watermark` (one row per source/object), so a re-sweep is safe.

## 8. Error handling & retries

| Layer | Behavior |
|---|---|
| OIC inbound (Fusion → OIC) | OIC retries the source-side event up to 3× per Oracle defaults. Failed messages land in the OIC error hospital; on-call gets a Slack alert via the OIC notification flow. |
| OIC → TMS | OIC retry policy: 3 attempts, exponential backoff (5s, 30s, 2min). 4xx (except 408/429) is treated as poison and routed to a fault flow that writes to `integration_event_log` with `status='failed_4xx'`. 5xx and timeouts are retried then DLQ'd. |
| TMS → OIC (`fusionPublisher`) | In-process queue with bounded concurrency, exponential backoff (1s → 5min cap), max 8 retries. Persistent failures emit a `fusion.publish.failed` log line + are written to `integration_event_log` for replay via admin endpoint. |
| TMS service-level failures (validation, DB) | Service throws with `err.status` (400/404/422/500). Route layer converts to JSON. OIC sees the status and routes accordingly. **History writes never block the main update** (existing pattern from `shipConfirm.js`). |

Replay is always a `POST /api/integration/fusion/replay` away — the route reads from `integration_event_log` and re-fires the original payload through the same service entry point. This is how we avoid building a UI for ops every time something gets stuck.

## 9. Observability

- **TMS side**: every ingest writes a row to `integration_event_log` (one per OIC `instance_id`) with `source`, `object_type`, `external_id`, `status`, `error`, `received_at`, `processed_at`. The existing `change_history` rows continue to be written by `shipConfirm` / `orderIngest` so the History tab in the UI explains *what* changed and *why* (`metadata.via = 'fusion-oic'`).
- **OIC side**: built-in monitoring dashboard + tracking variables `fusion_id`, `tms_id`, `instance_id`. Each integration emits an audit log entry on success and a notification email on terminal failure.
- **Cross-system trace**: a single failure ticket can be answered with three lookups — Fusion `BusinessEventId` → OIC instance → TMS `integration_event_log.id`. We do not introduce a new correlation header; we reuse OIC's `instance_id`.

## 10. Security model

- All OIC ↔ TMS traffic over HTTPS (TLS 1.2+).
- TMS ingest endpoints are gated by `requireIngestKey` middleware (already exists in `api/routes/ingest.js`). The Fusion endpoints reuse the same middleware — different endpoints, same key class — and accept either `X-API-Key` or `Authorization: Bearer`.
- IP allowlist on the API gateway: only OIC's documented egress range can hit `/api/ingest/fusion/*`.
- TMS multi-tenancy: every Fusion payload must carry `tenant_id` (mapped from Fusion `BusinessUnitId` via OIC lookup). Service rejects payloads without a resolved `tenant_id`.

## 11. Data model impact (TMS)

This is the high-level summary. The full DDL + 8-item DB checklist is in `02-data-model-changes.md`.

- **`orders`**: add `fusion_so_header_id`, `fusion_shipment_request_id`, `fusion_business_unit_id`. (Reuses `sync_source` — value `'fusion'` is added to the controlled list.)
- **`shipments`**: add `fusion_shipment_id` (Fusion side shipment, once it exists).
- **`items`**, **`locations`**, **`carriers`**: add `fusion_*_id` external-key columns + nightly upsert.
- New table **`integration_event_log`**: ledger for every OIC ↔ TMS message (idempotency + replay).
- New table **`integration_watermark`**: one row per (source, object_type) for delta sweep cursors.

All changes ship as a single forward-only migration with a documented rollback (drop columns + drop tables — no destructive backfill).

## 12. Component map

| Concern | New / extended | File |
|---|---|---|
| HTTP entry | new | `api/routes/fusionIngest.js` |
| Validate + map + upsert (orders) | new | `api/services/fusionIngest/orders.js` |
| Validate + map + upsert (inventory) | new | `api/services/fusionIngest/inventory.js` |
| Validate + map + upsert (items/locations/carriers) | new | `api/services/fusionIngest/masterData.js` |
| Outbound publisher (TMS → OIC) | new | `api/services/fusionPublisher/index.js` |
| Outbound payload transformer | new | `api/services/fusionPublisher/transformer.js` |
| Outbound retry queue | new | `api/services/fusionPublisher/retryQueue.js` |
| Audit + history writes | reused | `api/services/changeHistory.js` |
| Event bus | reused | `api/services/eventBus.js` (subscribed by publisher) |
| DB schema | new migration | `supabase/migrations/20260502_fusion_integration.sql` |

The publisher subscribes to the **existing** `SHIPMENT_UPDATED` and `ORDER_UPDATED` events on the in-process bus, so flows that already emit those (`shipConfirm`, `shipmentEvents`, `orderMutations`) need **no** changes to support F3.

## 13. Rollout phases

1. **Phase 0 — Schema + scaffolding** *(this delivery)*. Migration + service modules + routes. Off in production until env keys are set.
2. **Phase 1 — F4 master data (read-only)**. Lowest risk; one-way, low frequency. Validates auth + OIC connectivity in lower envs.
3. **Phase 2 — F1 sales orders / shipment requests**. Run shadow for 1 week (TMS receives but planners ignore the rows in a separate `sync_source='fusion'` swimlane) before cutover.
4. **Phase 3 — F2 inventory**. Read-only into a new `inventory_snapshots` view first; planning logic only consumes it after a sign-off.
5. **Phase 4 — F3 outbound status**. The riskiest because it writes back to Fusion. Gate behind `OIC_PUBLISH_ENABLED=false` until OIC + Fusion sign off. Start with shipment-status only; weights/charges follow.

## 14. Risks & open questions

- **Fusion event coverage**: not every Fusion object emits a business event natively. Inventory on-hand specifically may need BICC + scheduled extract rather than events. Confirm with the Fusion admin before locking F2.
- **UoM normalization**: TMS weight is in `pounds` (verified in `orders.weight`). Fusion may send kilograms. OIC lookup `UOM_FUSION_TO_TMS` must convert before TMS sees the payload.
- **Carrier identity**: Fusion has `Carrier` master data; TMS has `carriers` table. Mapping is N-to-1 (Fusion may have regional carriers we collapse). Need a `CARRIER_FUSION_TO_TMS` lookup with a default-to-"Unassigned" fallback so a missing mapping never blocks ingest.
- **Multi-org / multi-BU tenancy**: TMS multi-tenancy isn't fully wired in every code path. Confirm `tenant_id` resolution before turning on F1 in prod.
- **F3 back-write semantics**: does Fusion accept a partial shipment update (just status/PoD) or does it require the full shipment object? Need an OIC dry run on a Fusion test instance before locking the F3 mapping.

These are tracked as open issues in the per-flow specs.

---

**See also**

- `02-data-model-changes.md` — DDL + 8-item DB checklist + rollback
- `03-field-mappings.md` — field-level Fusion ↔ TMS mappings
- `flows/F1-fusion-so-to-tms.md` … `flows/F4-master-data-sync.md` — per-flow OIC specs
- `samples/*.json` — sample request/response payloads for every endpoint
