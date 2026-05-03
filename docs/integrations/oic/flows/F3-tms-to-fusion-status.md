# F3 — Zoree TMS → Fusion OM/Inv (status, tracking, PoD, charges)

**Direction:** TMS → Fusion
**Style:** Event-driven (TMS in-process bus → HTTP → OIC → Fusion)
**Owner of OIC integration:** Integration team
**Owner of TMS publisher:** Zoree TMS API team

---

## OIC integration names

- `ZOREE_TMS_SHIPMENT_STATUS_TO_FUSION_v1`
- `ZOREE_TMS_POD_TO_FUSION_v1`
- `ZOREE_TMS_FREIGHT_INVOICE_TO_FUSION_v1` *(gated, future)*

## Purpose

Close the loop. Fusion needs to know:

- When the shipment **picks up** (status `In Transit`, ActualShipDate).
- When it **delivers** (status `Closed`/`Delivered`, ActualDeliveryDate, PoD attachments).
- Tracking/identification fields (BOL, PRO, Seal, Carrier).
- Eventually, freight charges for AP/GL.

Without F3, Fusion's SO never closes automatically — finance has to chase TMS for status manually.

## Trigger

TMS publisher (`api/services/fusionPublisher`) subscribes to the in-process `eventBus`:

- `EVENTS.SHIPMENT_UPDATED` — fired by `shipConfirm`, `shipmentEvents`, and any future shipment writer.
- `EVENTS.ORDER_UPDATED` — fired when an order's status changes through a shipment transition.

The publisher debounces per `shipmentId` (50 ms window) so a shipment with 8 linked orders generates **one** Fusion call, not nine.

The publisher's per-instance HTTP client posts to OIC's inbound REST endpoint:

```
POST  https://oic.zoree.com/ic/api/integration/v1/flows/rest/ZOREE_TMS_SHIPMENT_STATUS/1.0/events
Authorization: Bearer <oauth-token>
Content-Type: application/json
```

OIC unpacks, mutates via `STATUS_TMS_TO_FUSION`, and calls Fusion `salesOrdersForOrderHub` and/or `shipmentLines`.

## Payload (TMS → OIC)

```json
{
  "event_type": "shipment.status",
  "tms_shipment_id": "SHP-19384",
  "fusion_business_unit_id": "300000001234567",
  "occurred_at": "2026-05-02T15:23:11.000Z",
  "shipment": {
    "status": "In Transit",
    "carrier": "ACME-EXP",
    "bol_number": "BOL-77231",
    "pro_number": "PRO-44091",
    "seal_number": "SEAL-002",
    "pickup_date": "2026-05-02",
    "delivery_date": null,
    "weight": 18420,
    "weight_uom": "pounds"
  },
  "linked_orders": [
    {
      "tms_order_id": "FUS-1027382",
      "fusion_so_header_id": "300000005711928",
      "fusion_shipment_request_id": null,
      "status": "Shipped"
    }
  ]
}
```

## OIC mapping → Fusion

OIC iterates `linked_orders[]` and calls Fusion for each:

```
PATCH  fscmRestApi/resources/11.13.18.05/salesOrdersForOrderHub/{HeaderId}
       Body: { "Status": "{{ via STATUS_TMS_TO_FUSION }}",
               "ShippedDate": "{{ shipment.pickup_date }}" }
```

For PoD events:

```
POST   fscmRestApi/resources/11.13.18.05/shipmentLines/{ShipmentLineId}/child/attachments
       Body: { "FileName": "POD.pdf", "Content": "<base64>" }
```

## Auth

- TMS → OIC: OAuth 2.0 client credentials. Token cached in `fusionPublisher`, refreshed on 401. Env: `OIC_CLIENT_ID`, `OIC_CLIENT_SECRET`, `OIC_TOKEN_URL`, `OIC_BASE_URL`.
- OIC → Fusion: OIC connection's stored creds. TMS never holds Fusion creds.

## Fault handling

| Layer | Behavior |
|---|---|
| TMS publisher → OIC | Retry 8× with exponential backoff (1s → 5min cap), bounded by `OIC_PUBLISH_MAX_RETRIES` env. Persistent failures are written to `integration_event_log` with `direction='outbound'` and `status='failed_5xx'`. Replay via `POST /api/integration/fusion/replay`. |
| OIC → Fusion | OIC's standard retry, then fault flow. |
| Fusion 4xx | OIC fault flow. TMS notified via callback to `/api/integration/fusion/callback` so the planner sees a flag in the History tab. |

## Idempotency

The OIC integration looks up Fusion's current SO `Status` before patching. If the target status equals the current status, the call is a no-op (no Fusion update, no extra audit trail). This protects us from publishing storms — e.g. a planner re-clicks Delivered.

## Order of operations

The publisher includes `event_seq` (monotonic counter from `integration_event_log.id`) in the payload. OIC compares to the last applied seq for the shipment; out-of-order events are dropped, not applied. This guards against the rare race where a delayed `In Transit` event arrives after a `Delivered` event.

## Gated paths

- `event_type=shipment.invoiced` is dropped at OIC unless `OIC_PUBLISH_INVOICES_ENABLED=true`. Until finance signs off on the GL account map, we do not write financial data into Fusion.

## Tests / acceptance

1. Ship-confirm in TMS → Fusion SO `Status` flips to `Shipped`, `ShippedDate` set, within 60s.
2. PoD in TMS → Fusion SO `Status` flips to `Closed`, attachment uploaded.
3. Re-fire same status (planner re-clicks Delivered) → Fusion sees no extra change; TMS publisher's retry counter does not increment.
4. OIC down for 5 min → events queue in publisher → flush on reconnect; Fusion eventually consistent.
5. Out-of-order delivery: `In Transit` arrives *after* `Delivered` (e.g. a delayed event) → OIC drops `In Transit`; Fusion stays `Closed`.

## Open questions

- Does Fusion accept partial PATCH on `salesOrdersForOrderHub`, or only the full header? (Test on dev instance — affects the OIC mapping.)
- For multi-line orders that ship in two TMS shipments, do we update the SO header status only when **all** lines have shipped, or eagerly per shipment? (Default: per shipment-request line, not header.)
