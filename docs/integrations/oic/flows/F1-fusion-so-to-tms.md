# F1 — Fusion Sales Order / Shipment Request → Zoree TMS

**Direction:** Fusion → TMS
**Style:** Event-driven (primary) + scheduled delta sweep (recovery)
**Owner of OIC integration:** Integration team
**Owner of TMS endpoint:** Zoree TMS API team

---

## OIC integration name

`ZOREE_FUSION_SO_TO_TMS_v1`

## Purpose

The instant Fusion OM books a sales order (or DOO emits a shipment request), the order — header + lines — appears in Zoree TMS as an `Unplanned` order with `sync_source = 'fusion'`. No manual rekey. No batch lag.

## Trigger

**Primary (event):** Subscription to Fusion ERP business events:

- `oracle.apps.scm.dso.processShipmentRequestEvent` (DOO Shipment Request) — fires when DOO routes a line for shipping.
- `oracle.apps.scm.oom.salesOrder.update` (SO header updated) — captures status changes after initial creation.

**Secondary (scheduled delta):** A second integration runs every 30 minutes:

```
ZOREE_FUSION_SO_DELTA_SWEEP_v1
  GET salesOrdersForOrderHub
       ?q=LastUpdateDate >= :watermark
       &orderBy=LastUpdateDate
       &limit=200
  for each order: invoke same TMS endpoint (idempotent)
  update integration_watermark.cursor_value = max(LastUpdateDate)
```

The sweep is the safety net for missed events. It is idempotent because the TMS endpoint dedupes on `fusion_so_header_id`.

## Source connection (OIC adapter)

- **Adapter:** Oracle ERP Cloud Adapter (Fusion).
- **Connection:** `CONN_FUSION_PROD` (or `_DEV`/`_TEST` per env). OAuth 2.0 client-creds, scoped to `ERP Integration Specialist`.
- **Operations:** `Receive ERP business event` (event subscription) + `Query` (`salesOrdersForOrderHub`).

## Target connection

- **Adapter:** REST.
- **Connection:** `CONN_ZOREE_TMS_PROD`. Base URL `https://tms.zoree.com`. Security: API Key Authentication (header `X-API-Key`, secret pulled from OIC vault key `ZOREE_TMS_INGEST_KEY`).
- **Resource:** `/api/ingest/fusion/shipment-requests` (POST).

## Request payload (OIC → TMS)

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",        // OIC instance — TMS dedupe key
  "tenant_id":   "{{ tenant via BU_FUSION_TO_TENANT }}",
  "fusion_so_header_id":         "{{ Header.HeaderId }}",
  "fusion_shipment_request_id":  "{{ Header.ShipmentRequestId }}",  // null for SO-only
  "fusion_business_unit_id":     "{{ Header.BusinessUnitId }}",
  "header": {
    "id":                "{{ Header.SourceTransactionNumber }}",
    "customer":          "{{ Header.SoldToPartyName }}",
    "ship_to_name":      "{{ Header.ShipToPartyName }}",
    "ship_to_address":   "{{ concatenated address }}",
    "dest":              "{{ City + ', ' + State + ' ' + PostalCode }}",
    "dest_zip":          "{{ Header.ShipToAddress.PostalCode }}",
    "origin":            "{{ via ORG_FUSION_TO_LOCATION }}",
    "ship_from_name":    "{{ Header.ShipFromOrganizationCode }}",
    "po_number":         "{{ Header.PurchaseOrder }}",
    "ready":             "{{ Header.RequestedShipDate }}",
    "due":               "{{ Header.RequestedDeliveryDate }}",
    "preferred_carrier": "{{ via CARRIER_FUSION_TO_TMS }}",
    "service_level":     "{{ Header.ServiceLevelCode }}",
    "incoterms":         "{{ via INCOTERM_FUSION_TO_TMS }}",
    "hazmat":            "{{ Header.HazardousFlag }}",
    "status":            "{{ via STATUS_FUSION_TO_TMS }}"
  },
  "lines": [
    {
      "line_num":     "{{ Lines[i].LineNumber }}",
      "item_id":      "{{ Lines[i].ItemNumber }}",
      "description":  "{{ Lines[i].Description }}",
      "qty_ordered":  "{{ Lines[i].Quantity }}",
      "unit_weight":  "{{ Lines[i].UnitWeight (UoM-normalized) }}",
      "unit_value":   "{{ Lines[i].UnitPrice }}"
    }
  ]
}
```

## Response (TMS → OIC)

`202 Accepted` body:

```json
{
  "ok": true,
  "accepted": 1,
  "ids": ["FUS-1027382"],
  "syncedAt": "2026-05-02T15:23:11.000Z",
  "skipped": []
}
```

`400` for validation, `401` for bad key, `5xx` for transient (OIC retries 5xx only).

## Mappings & lookups

See `../03-field-mappings.md` (F1 section) for the full field-by-field mapping. Lookups required:

- `BU_FUSION_TO_TENANT`
- `ORG_FUSION_TO_LOCATION`
- `CARRIER_FUSION_TO_TMS`
- `UOM_FUSION_TO_TMS`
- `INCOTERM_FUSION_TO_TMS`
- `STATUS_FUSION_TO_TMS`

## Fault handling

| Failure | OIC behavior |
|---|---|
| TMS 400 (validation) | Move to `ZOREE_FAULT_FLOW`. Email `tms-ops@zoree.com`. Do not retry. |
| TMS 401/403 | Move to fault flow. Page on-call (auth issue → secret rotation needed). |
| TMS 408/429 | Retry: 3 attempts, exponential 5s/30s/2m. |
| TMS 5xx / timeout | Retry: 3 attempts, exponential. After 3rd, move to fault flow + emit OIC error notification. |
| Lookup miss (e.g. BU not in `BU_FUSION_TO_TENANT`) | OIC throws `LookupNotFound`, fault flow, do not retry — config issue. |

The fault flow writes the original Fusion payload + error context into the **TMS** `integration_event_log` via the replay endpoint, so a planner can replay from the TMS admin UI without involving OIC.

## Idempotency

- TMS service upserts on `fusion_so_header_id`. Re-delivery → no second row, no second history entry.
- OIC `instance_id` is logged in `integration_event_log.oic_instance_id` (UNIQUE), so even if Fusion fires the event twice with two different instance_ids, the **header** is upserted once.

## Tracking variables (OIC)

- `fusion_header_id` ← `Header.HeaderId`
- `tms_order_id`    ← response `ids[0]`
- `tenant_id`       ← resolved tenant

These show up in the OIC monitoring dashboard so support can grep instances by Fusion id without scrolling.

## Tests / acceptance criteria

1. New SO booked in Fusion test → TMS Orders page shows the order within 30 seconds, with `sync_source = 'fusion'` badge.
2. SO updated in Fusion (e.g. requested ship date moves) → TMS row updates, History tab shows a `via: 'fusion-oic'` audit entry with before/after.
3. Fusion event fired twice with same `HeaderId` → only one TMS row; second call returns 202 with `skipped[0].reason = 'already_synced'`.
4. Lookup miss → OIC fault flow triggers; nothing lands in TMS; ops sees the fault email.
5. Outage replay: stop TMS → fire 10 SOs in Fusion → start TMS → run delta sweep → all 10 land.

## Open questions

- Does Fusion always emit the `processShipmentRequestEvent` for back-to-back orders or only the final one? (Confirm with Fusion admin.)
- Should partially-cancelled SOs propagate to TMS as a `Cancelled` order or a line-level partial update? (Today: header status only.)
