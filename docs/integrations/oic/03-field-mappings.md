# Fusion ↔ TMS Field Mappings

Field-level reference for every Fusion ↔ TMS mapping done inside OIC. Used when building the OIC integration mappings and when reviewing whether a Fusion field has a TMS home.

For each flow we document:

1. **Direction** — Fusion → TMS or TMS → Fusion.
2. **Source object** — the Fusion REST resource or business event payload.
3. **Target object** — the TMS endpoint body.
4. **Mapping table** — source path → target path → notes.
5. **Lookups** — OIC lookup tables required by the mapping.

OIC lookup tables are defined once and shared across flows. They live under the OIC integration project's "Lookups" folder and are versioned.

---

## Shared lookups

| Lookup | Key (Fusion) | Value (TMS) | Used in |
|---|---|---|---|
| `BU_FUSION_TO_TENANT` | `BusinessUnitId` | `tenant_id` | F1, F2, F4 |
| `ORG_FUSION_TO_LOCATION` | `OrganizationCode` | `locations.id` | F1, F2 |
| `CARRIER_FUSION_TO_TMS` | `CarrierName` | `carriers.id` | F1, F3 |
| `UOM_FUSION_TO_TMS` | `UOMCode` | TMS unit (`pounds`, `each`, `inches`) | F1, F2 |
| `STATUS_FUSION_TO_TMS` | Fusion status | TMS status | F1, F3 |
| `STATUS_TMS_TO_FUSION` | TMS status | Fusion status | F3 |
| `INCOTERM_FUSION_TO_TMS` | `Incoterm` | TMS `incoterms` value | F1 |

---

## F1 — Fusion Sales Order / Shipment Request → TMS

**Source** — Fusion ERP REST or business event:

- SO header: `salesOrdersForOrderHub` resource, `Header` payload.
- Shipment request (DOO): `shipmentRequest` event, `Lines[]` for what to ship.

**Target** — `POST /api/ingest/fusion/shipment-requests`

> Implementation note: the same TMS service handles both SO-driven and shipment-request-driven flows. OIC sends `payloadType` so the service knows whether to expect `lines[]` from the SO header or pre-filtered `lines[]` from a shipment request.

| Fusion path | TMS path | Notes |
|---|---|---|
| `Header.HeaderId` | `fusion_so_header_id` | Idempotency key on the TMS side. |
| `Header.ShipmentRequestId` (or event payload) | `fusion_shipment_request_id` | Present only when the source is a Shipment Request, not a vanilla SO. |
| `Header.BusinessUnitId` | `fusion_business_unit_id`, then resolved → `tenant_id` via `BU_FUSION_TO_TENANT` | OIC fails the message if no mapping exists (no default). |
| `Header.SourceTransactionNumber` | `id` (or `po_number` if `id` is auto-assigned) | TMS `id` accepts the Fusion SO number directly (verified pattern: `orderIngest` already accepts `o.id`). |
| `Header.PurchaseOrder` | `po_number` | |
| `Header.RequestedShipDate` | `ready` | ISO date string. |
| `Header.RequestedDeliveryDate` | `due` | ISO date string. |
| `Header.SoldToPartyName` | `customer` | |
| `Header.ShipToPartyName` | `ship_to_name` | |
| `Header.ShipToAddress.AddressLine1..N` | `ship_to_address` | OIC concatenates lines + city/state/postal into TMS-canonical "STREET, CITY, ST ZIP". |
| `Header.ShipToAddress.City` | (used to build) `dest` | TMS `dest` = `"CITY, ST ZIP"` per `orderIngest` convention. |
| `Header.ShipToAddress.State` | (used to build) `dest` | |
| `Header.ShipToAddress.PostalCode` | `dest_zip` | |
| `Header.ShipFromOrganizationCode` | `origin` (resolved via `ORG_FUSION_TO_LOCATION`), `ship_from_name` | The TMS `origin` is a city/state/zip string; OIC expands `M1` → "Dallas, TX 75201" via the lookup. |
| `Header.PreferredCarrierName` | `preferred_carrier` (via `CARRIER_FUSION_TO_TMS`) | If unmapped, drop silently — TMS treats null preferred carrier as "any". |
| `Header.ServiceLevelCode` | `service_level` | |
| `Header.FreightTermsCode` | `incoterms` (via `INCOTERM_FUSION_TO_TMS`) | |
| `Header.HazardousFlag` | `hazmat` | Bool. |
| sum(`Lines[].Weight`) | `weight` | Always recomputed at TMS from `lines[].total_weight`; OIC sends as a sanity check. UoM normalized via `UOM_FUSION_TO_TMS`. |
| sum(`Lines[].Quantity`) | `pieces` | Same — recomputed at TMS. |
| `Lines[].LineNumber` | `lines[].line_num` | |
| `Lines[].InventoryItemId` (resolved via `items.fusion_item_id`) | `lines[].item_id` | If item not in TMS yet, the F4 master sync will catch up; service will accept the line with a warning. |
| `Lines[].Description` | `lines[].description` | |
| `Lines[].Quantity` | `lines[].qty_ordered` | |
| `Lines[].UnitWeight` | `lines[].unit_weight` | UoM-normalized to pounds. |
| `Lines[].UnitPrice` | `lines[].unit_value` | |
| (constant) `'fusion'` | `sync_source` | Set by service, not OIC. |
| (now) | `auto_synced_at` | Set by service. |

**Lookups required:** `BU_FUSION_TO_TENANT`, `ORG_FUSION_TO_LOCATION`, `CARRIER_FUSION_TO_TMS`, `UOM_FUSION_TO_TMS`, `INCOTERM_FUSION_TO_TMS`.

**Status mapping (F1 inbound):** Fusion `OrderStatus` → TMS `status`:

| Fusion | TMS |
|---|---|
| `Entered` / `Submitted` | `Unplanned` |
| `Awaiting Shipping` / `Pick Released` | `Unplanned` |
| `Shipped` | `Shipped` |
| `Closed` | `Delivered` |
| `Canceled` | `Cancelled` |

The "Awaiting Shipping → Unplanned" choice is intentional: TMS planners take it from there. We do not infer "Planned" until TMS itself has a shipment.

---

## F2 — Fusion Inventory → TMS

**Source** — Fusion Inventory:

- Material transactions: `materialTransactions` REST or `oracle.apps.scm.inv.materialTransactionEvent`.
- On-hand snapshot: `onhandQuantities` REST (BICC extract for higher volumes).

**Target** —
- `POST /api/ingest/fusion/inventory/transactions`
- `POST /api/ingest/fusion/inventory/on-hand`

### F2a — Transactions

| Fusion path | TMS path | Notes |
|---|---|---|
| `TransactionId` | `fusion_transaction_id` | Idempotency key. |
| `OrganizationCode` | `location_id` (via `ORG_FUSION_TO_LOCATION`) | |
| `SubinventoryCode` | `subinventory` | |
| `InventoryItemId` | `item_id` (via `items.fusion_item_id`) | |
| `TransactionTypeName` | `transaction_type` | Free text; TMS treats as enum-ish: `Issue`, `Receipt`, `Transfer`, `Cycle Count`. |
| `TransactionDate` | `occurred_at` | UTC. |
| `TransactionQuantity` | `qty` | UoM normalized via `UOM_FUSION_TO_TMS`. |
| `SourceDocumentNumber` | `source_document_ref` | E.g. SO number or PO number. |

> No new TMS table — these rows land in a future `inventory_transactions` table; for the current delivery they are written to `integration_event_log` only and replayed once the table exists. This keeps the migration footprint minimal.

### F2b — On-hand

| Fusion path | TMS path | Notes |
|---|---|---|
| `OrganizationCode` | `location_id` | |
| `InventoryItemId` | `item_id` | |
| `OnhandQuantity` | `qty` | UoM normalized. |
| `AsOfDate` | `as_of` | |

Same note — written to `integration_event_log` until the dedicated `inventory_on_hand` table is provisioned.

---

## F3 — TMS Shipment Status → Fusion OM/Inv

**Source** — TMS in-process events:

- `SHIPMENT_UPDATED` (via `eventBus.js`).
- `ORDER_UPDATED` (when delivery rolls up).
- Future: `SHIPMENT_INVOICED` for freight charges.

**Target** — OIC inbound REST (TMS does not call Fusion directly). OIC then calls Fusion `salesOrdersForOrderHub`, `shipmentLines`, `shipmentEvents`.

### F3a — Status update

| TMS path | OIC body / Fusion path | Notes |
|---|---|---|
| `id` (shipment id) | `tms_shipment_id` | |
| linked `orders[].fusion_so_header_id` | `headers[].HeaderId` | OIC fans this out per linked SO. |
| `status` | `Status` (via `STATUS_TMS_TO_FUSION`) | TMS `In Transit` → Fusion `Shipped` (header), `Delivered` → Fusion `Closed`. |
| `pickup_date` | `ActualShipDate` | Only included on transition into "In Transit". |
| `delivery_date` | `ActualDeliveryDate` | Only included on transition into "Delivered". |
| `carrier` | `CarrierName` (via reverse `CARRIER_FUSION_TO_TMS`) | |
| `bol_number` | `WaybillNumber` | |
| `pro_number` | `ProBillNumber` | |
| `seal_number` | `SealNumber` | |
| `weight` (actual) | `ActualWeight` | If different from order weight, this is the "scale weight" override. |

### F3b — Proof of delivery

When TMS marks `Delivered` with PoD attached:

| TMS path | Fusion path | Notes |
|---|---|---|
| `delivery_date` | `ActualDeliveryDate` | |
| `pod_received_by` | `ReceivedByName` | |
| `pod_signature_url` | (attachment ref) | Sent as a base64 attachment in the Fusion REST call; OIC fetches the signature image from TMS and embeds it. |
| `note` | `DeliveryNotes` | |

### F3c — Freight charges (future, gated)

Sent to Fusion `freightInvoices` once TMS has an approved invoice via REQ-08:

| TMS path | Fusion path | Notes |
|---|---|---|
| `invoice_amount` | `Amount` | |
| `currency` | `CurrencyCode` | |
| `freight_charge_lines[].account` | `DistributionAccount` | |

> F3c is **gated** behind `OIC_PUBLISH_INVOICES_ENABLED=false` until finance confirms the GL account mapping.

---

## F4 — Master Data Sync (Fusion → TMS)

**Cadence:** Nightly full + intra-day delta via business events.

### F4a — Items

**Source:** Fusion `itemsV2` REST. Event: `oracle.apps.scm.productHub.itemPublishEvent`.

**Target:** `POST /api/ingest/fusion/items`

| Fusion path | TMS path |
|---|---|
| `ItemId` | `fusion_item_id` |
| `OrganizationId` | `fusion_organization_id` |
| `ItemNumber` | `id` (or `sku`) |
| `Description` | `description` |
| `PrimaryUOMCode` | `uom` (via `UOM_FUSION_TO_TMS`) |
| `UnitWeight` | `unit_weight` |
| `UnitWeightUOMCode` | (used to normalize `unit_weight`) |
| `HazardousMaterialFlag` | `hazmat` |

### F4b — Locations

**Source:** Fusion `inventoryOrganizations` + `locations`.

**Target:** `POST /api/ingest/fusion/locations`

| Fusion path | TMS path |
|---|---|
| `OrganizationId` | `fusion_location_id` |
| `OrganizationCode` | `fusion_organization_code`, also TMS `id` if no override |
| `LocationName` | `name` |
| `Address.City` | `city` |
| `Address.State` | `state` |
| `Address.PostalCode` | `zip` |
| `Address.Country` | `country` |
| `LocationType` | `type` (`warehouse` / `customer` / `supplier`) |

### F4c — Carriers

**Source:** Fusion `carriers` (Setup & Maintenance → Manage Carriers).

**Target:** `POST /api/ingest/fusion/carriers`

| Fusion path | TMS path |
|---|---|
| `CarrierId` | `fusion_carrier_id` |
| `CarrierName` | `name` |
| `SCAC` | `scac` |
| `DOTNumber` | `dot_number` |
| `Active` | `active` |

---

## Validation rules (TMS service layer)

The TMS service rejects any payload that fails these rules — no silent truncation:

- F1: missing `Header.HeaderId`, missing resolvable `tenant_id`, weight ≤ 0 → 400.
- F2: missing `TransactionId` or unresolvable `OrganizationCode` → 400.
- F3: empty `tms_shipment_id` → 400. Status not in TMS canonical set → 400.
- F4: missing `fusion_item_id` (items), `fusion_location_id` (locations), `fusion_carrier_id` (carriers) → 400.

All 400s are surfaced to OIC; OIC routes them to the fault flow (see `01-architecture.md` §8). They do **not** retry.
