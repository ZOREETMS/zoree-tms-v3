# F4 — Master data sync (Fusion → Zoree TMS)

**Direction:** Fusion → TMS (one-way)
**Style:** Hybrid — nightly full sync + intra-day delta via business events
**Owner of OIC integration:** Integration team

---

## OIC integration names

- `ZOREE_FUSION_ITEMS_FULL_v1` (scheduled, nightly)
- `ZOREE_FUSION_ITEMS_DELTA_v1` (event-driven)
- `ZOREE_FUSION_LOCATIONS_FULL_v1`
- `ZOREE_FUSION_LOCATIONS_DELTA_v1`
- `ZOREE_FUSION_CARRIERS_FULL_v1`

## Purpose

Fusion is the master for items, organizations, customers, and carriers. F4 keeps TMS reference tables aligned so:

- F1 line-level item references resolve.
- F2 inventory rows can be joined to a TMS item.
- F3 carrier names round-trip cleanly.
- Planners pick the right origin/dest from up-to-date locations.

## F4a — Items

### Full (nightly)

- Cron: `0 2 * * *` UTC (low-traffic window).
- Source: `itemsV2` REST. OIC pages 500 per call.
- Target: `POST /api/ingest/fusion/items` with `mode: 'full'`. Service treats `mode='full'` as "this batch is authoritative for the listed items; do not delete anything else."

### Delta (event)

- Trigger: `oracle.apps.scm.productHub.itemPublishEvent`.
- Target: same endpoint, `mode: 'delta'`.

### Payload

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",
  "tenant_id":   "{{ via BU_FUSION_TO_TENANT }}",
  "mode":        "delta",                      // or "full"
  "items": [
    {
      "fusion_item_id":         "{{ ItemId }}",
      "fusion_organization_id": "{{ OrganizationId }}",
      "id":                     "{{ ItemNumber }}",
      "description":            "{{ Description }}",
      "uom":                    "{{ via UOM_FUSION_TO_TMS }}",
      "unit_weight":            "{{ UnitWeight (lbs) }}",
      "hazmat":                 "{{ HazardousMaterialFlag }}"
    }
  ]
}
```

## F4b — Locations

### Full (nightly)

- Cron: `15 2 * * *` UTC.
- Source: `inventoryOrganizations` joined to `locations`.
- Target: `POST /api/ingest/fusion/locations`.

### Delta (event)

- Trigger: `oracle.apps.scm.inv.organizationDefinitionEvent` (rare).

### Payload

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",
  "tenant_id":   "{{ via BU_FUSION_TO_TENANT }}",
  "mode":        "full",
  "locations": [
    {
      "fusion_location_id":      "{{ OrganizationId }}",
      "fusion_organization_code":"{{ OrganizationCode }}",
      "id":                      "{{ OrganizationCode }}",
      "name":                    "{{ LocationName }}",
      "city":                    "{{ Address.City }}",
      "state":                   "{{ Address.State }}",
      "zip":                     "{{ Address.PostalCode }}",
      "country":                 "{{ Address.Country }}",
      "type":                    "{{ LocationType }}"
    }
  ]
}
```

## F4c — Carriers

- Cron: `30 2 * * *` UTC.
- Source: Fusion `carriers` (Setup & Maintenance).
- Target: `POST /api/ingest/fusion/carriers`.

```jsonc
{
  "instance_id": "{{ $self.instanceID }}",
  "carriers": [
    {
      "fusion_carrier_id": "{{ CarrierId }}",
      "name":              "{{ CarrierName }}",
      "scac":              "{{ SCAC }}",
      "dot_number":        "{{ DOTNumber }}",
      "active":            "{{ Active }}"
    }
  ]
}
```

> Carriers are global (not tenant-scoped) in TMS today. If/when carriers move to per-tenant, this payload gains `tenant_id` and the unique key on the TMS side becomes `(tenant_id, fusion_carrier_id)`.

## Lookup maintenance side-effect

After every successful master-data run, OIC updates the lookup tables that other flows depend on:

- F4a → refresh `UOM_FUSION_TO_TMS` (additive only).
- F4b → refresh `ORG_FUSION_TO_LOCATION`.
- F4c → refresh `CARRIER_FUSION_TO_TMS`.

Lookup updates are gated by an OIC approval step in production (lookup churn = mapping break risk). Lower environments auto-apply.

## Fault handling

- Full sync: continues on item-level failures; the run summary lists failures and pages on-call only if > 1% of records fail.
- Delta: 3 retries, then fault flow. Item-not-found in Fusion REST (race with delete) → silently dropped.

## Idempotency

- Items: upsert on `(tenant_id, fusion_item_id)`.
- Locations: upsert on `fusion_location_id`.
- Carriers: upsert on `fusion_carrier_id`.

Replays are no-ops if data hasn't changed (history rows include before/after; an upsert with no diff writes no history).

## Tests / acceptance

1. New item published in Fusion → TMS `items` row appears within 1 minute (delta path).
2. Bulk update in Fusion (e.g. 1000 items reweighted) → TMS reflects all 1000 by 03:00 UTC the next day.
3. Item deleted in Fusion → TMS row stays (we do not propagate deletes; soft-deactivation only). Open question — see below.
4. Location code reused for a different physical site → fault, fault flow. We do not silently overwrite a known-good mapping.

## Open questions

- **Deletes**. Should TMS soft-delete items when Fusion soft-deletes them? Today we leave them; planners can manually deactivate.
- **Customers as master data**. Customer master is currently embedded in TMS orders (`orders.customer` is a free-text label). Do we promote it to a master entity sourced from Fusion `parties`? Out of scope for v1; tracked separately.
