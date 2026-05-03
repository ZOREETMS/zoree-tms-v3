# Fusion ↔ Zoree TMS via OIC — index

This folder is the design and implementation reference for connecting Oracle Fusion (OM + Inventory) to Zoree TMS through Oracle Integration Cloud.

## Reading order

1. **`01-architecture.md`** — what we're building and why; topology, auth, retries, observability.
2. **`02-data-model-changes.md`** — the 8-item DB checklist (per `docs/zoree_db_rules.pdf`) and DDL summary.
3. **`03-field-mappings.md`** — Fusion ↔ TMS field mappings, lookups, status maps.
4. **`flows/F1-fusion-so-to-tms.md`** … **`flows/F4-master-data-sync.md`** — per-flow OIC integration specs.
5. **`samples/*.json`** — sample request/response payloads for every endpoint and event.

## Code delivered with this design

```
api/
  routes/
    fusionIngest.js                          ← /api/ingest/fusion/* HTTP entry
  services/
    fusionIngest/
      index.js                               ← barrel
      eventLog.js                            ← integration_event_log helper
      orders.js                              ← F1
      inventory.js                           ← F2
      masterData.js                          ← F4
    fusionPublisher/
      index.js                               ← F3 (subscribes to eventBus, posts to OIC)
      transformer.js                         ← outbound payload shaping
      retryQueue.js                          ← in-process backoff queue
supabase/
  migrations/
    20260502_fusion_integration.sql          ← columns + 2 new tables
docs/
  integrations/oic/
    01-architecture.md
    02-data-model-changes.md
    03-field-mappings.md
    flows/F1...F4.md
    samples/*.json
    README.md                                ← this file
```

## Wiring into `api/server.js`

Add **two** small lines next to the existing `ingestRouter` registration. Both are additive — no existing line changes:

```js
// near the top, with the other route imports:
const fusionIngestRouter = require('./routes/fusionIngest');   // NEW
const fusionPublisher    = require('./services/fusionPublisher'); // NEW

// where ingestRouter is currently mounted (look for `app.use('/api/ingest', ingestRouter);`):
app.use('/api/ingest/fusion', fusionIngestRouter);             // NEW

// near where mwQueueWorker is started (look for `mwQueueWorker.start(...)`):
fusionPublisher.start();                                       // NEW
```

That's it. The publisher is gated on `OIC_PUBLISH_ENABLED=true`, so it is a no-op until env is set.

## Required env vars

```
INGEST_API_KEY=<shared key OIC includes as X-API-Key>
OIC_PUBLISH_ENABLED=false                  # flip to true after F3 sign-off
OIC_BASE_URL=https://oic.zoree.com
OIC_TOKEN_URL=https://oic.zoree.com/oauth2/v1/token
OIC_CLIENT_ID=<from OIC>
OIC_CLIENT_SECRET=<from OIC>
OIC_PUBLISH_CONCURRENCY=4                  # optional, default 4
OIC_PUBLISH_MAX_RETRIES=8                  # optional, default 8
OIC_PUBLISH_INVOICES_ENABLED=false         # F3c gate (future)
```

## Test plan (before flipping prod)

- Migration runs cleanly on a staging Supabase.
- `node --check` passes on every new `.js` file (the verification step ran clean).
- Curl smoke test against each ingest endpoint with the F1/F2/F4 sample payloads (set `INGEST_API_KEY=test`, point at local API):

```bash
curl -X POST http://localhost:3001/api/ingest/fusion/shipment-requests \
  -H 'X-API-Key: test' \
  -H 'Content-Type: application/json' \
  -d @docs/integrations/oic/samples/F1-tms-ingest-fusion-orders.json
```

- Re-fire the same payload — second response should show `isUpdate: true` (or skip if `oic_instance_id` matches an already-processed row in `integration_event_log`).
- For F3, set `OIC_PUBLISH_ENABLED=true` and a mock OIC URL; trigger a ship-confirm in TMS and confirm the publisher fires (look for the queue's debug log line on terminal failure path).

## Non-negotiables baked in (per CLAUDE_RULES)

- Routes are thin; logic lives in `api/services/fusionIngest/*` and `api/services/fusionPublisher/*`.
- No new logic in `api/server.js` beyond the two wiring lines above.
- DB changes are versioned (single forward-only migration with rollback in a comment).
- `changeHistory.recordChange` is the single audit writer for any order/shipment mutation. No service in this delivery writes to `change_history` directly.
- `eventBus` is the single in-process broadcast surface. The publisher subscribes; existing writers (`shipConfirm`, `shipmentEvents`, `orderMutations`) need no changes.
