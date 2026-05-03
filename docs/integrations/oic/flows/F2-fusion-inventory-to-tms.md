# F2 — Fusion Inventory → Zoree TMS

**Direction:** Fusion → TMS
**Style:** Event-driven for transactions; scheduled batch for on-hand snapshots
**Owner of OIC integration:** Integration team

---

## OIC integration names

- `ZOREE_FUSION_INV_TXN_TO_TMS_v1` (event-driven, transactions)
- `ZOREE_FUSION_INV_ONHAND_TO_TMS_v1` (scheduled, snapshot)

## Purpose

Give TMS planners visibility into Fusion inventory, so they can:

- Confirm stock is on-hand at the origin warehouse before tendering.
- Reconcile post-shipment (inventory issued at ship-confirm matches the TMS shipment).
- Pick the right origin org when the order's source-from is ambiguous.

## F2a — Material transactions

### Trigger

Fusion business event `oracle.apps.scm.inv.materialTransactionEvent`. Fires for every `Issue`, `Receipt`, `Transfer`, and `Cycle Count`.

### Source

- Adapter: Oracle ERP Cloud Adapter, business event subscription.
- Optional REST fallback: `materialTransactions?q=TransactionDate>=:watermark`.

### Target

`POST /api/ingest/fusion/inventory/transactions`

### Payload (OIC → TMS)

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",
  "tenant_id":   "{{ via BU_FUSION_TO_TENANT }}",
  "transactions": [
    {
      "fusion_transaction_id":  "{{ TransactionId }}",
      "transaction_type":       "{{ TransactionTypeName }}",
      "occurred_at":            "{{ TransactionDate }}",
      "location_id":            "{{ via ORG_FUSION_TO_LOCATION }}",
      "subinventory":           "{{ SubinventoryCode }}",
      "fusion_item_id":         "{{ InventoryItemId }}",
      "qty":                    "{{ TransactionQuantity (UoM-normalized) }}",
      "uom":                    "{{ via UOM_FUSION_TO_TMS }}",
      "source_document_ref":    "{{ SourceDocumentNumber }}"
    }
  ]
}
```

### Response

```json
{ "ok": true, "accepted": 1, "logged": ["fus-txn-9981"], "skipped": [] }
```

## F2b — On-hand snapshot

### Trigger

Scheduled OIC integration, every 15 min. Reads from BICC extract (`OnhandQuantitiesExtract`) — uses BICC because per-org snapshots can be 100k+ rows and REST list throughput is slow.

### Source

- Adapter: BICC (or REST `onhandQuantities` for small orgs).
- Watermark: `LastChangeDate` per `OrganizationId`.

### Target

`POST /api/ingest/fusion/inventory/on-hand`

### Payload

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",
  "tenant_id":   "{{ via BU_FUSION_TO_TENANT }}",
  "as_of":       "{{ run start time, ISO }}",
  "rows": [
    {
      "location_id":   "{{ via ORG_FUSION_TO_LOCATION }}",
      "fusion_item_id":"{{ InventoryItemId }}",
      "qty":           "{{ OnhandQuantity }}",
      "uom":           "{{ via UOM_FUSION_TO_TMS }}"
    }
  ]
}
```

Snapshots are **not** appended row-by-row — TMS replaces the on-hand row for each `(location_id, fusion_item_id)` pair within the run window. This avoids unbounded growth.

## Mappings & lookups

See `../03-field-mappings.md` F2 section.

## Fault handling

Same policy as F1. One additional rule for F2b:

- If any single batch in a snapshot run errors after 3 retries, OIC **does not** abort the rest of the run. The bad batch is faulted, the rest of the run continues. The snapshot is eventually consistent — partial is OK.

## Idempotency

- Transactions: `fusion_transaction_id` UNIQUE on the audit ledger.
- On-hand: replace-on-write per `(location, item)`. The `as_of` field documents the snapshot time so a stale snapshot can be detected (but never used to reject — the latest write always wins).

## Volume considerations

- Transaction event volume: 10s of thousands per day at scale. The TMS endpoint accepts up to **500 transactions per call** to amortize HTTP cost; OIC batches via "for each" with `batchSize: 500`.
- On-hand snapshot: a full org dump is ~100k rows; OIC pages BICC at 5k rows per chunk and posts ~20 calls per run.

## Tests / acceptance

1. Inv issue against an SO in Fusion → TMS receives a transaction with `transaction_type=Issue`, qty matching the issue, within 60s.
2. Two snapshots for same `(loc, item)` ten min apart → only the latest qty visible to TMS reads.
3. OIC outage 30 min → next snapshot run picks up everything between watermark and now.
4. Fusion item not yet in TMS `items` → transaction still accepted with a warning, item gets backfilled by F4 within an hour.

## Open questions

- Subinventory granularity — does Zoree want stock per subinv or rolled to org? (Default in this design: per subinv, rolled in views.)
- Lot/serial — out of scope for v1.
