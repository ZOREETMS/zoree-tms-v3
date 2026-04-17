# REQ-03 Change Summary — Manually add order to shipment + auto cost recalc

Date: 2026-04-16
Author: Claude (AI-assisted)
Cycles: 1 (all tests green on first browser run)

## Requirement

From `C:\Zoree\Requirements\requirements.xlsx`, row 3:

> User can manually add an order to shipment and when order is added, shipment cost has to be automatically recalculated depending on new weight. From order, there should be a menu to add to a shipment and you can enter the shipment id and confirm. That will add order to shipment id.

Expected: **shipment will have added order and shipment cost recalculated.**

## Architecture

A single dedicated endpoint owns the full add-to-shipment transaction so we can reason about atomicity and audit. The frontend only reaches it through a new modal on the Orders page — no direct DB writes.

```
Orders page → [📦 Add to Ship] button on an Unplanned row
       ↓
AddToShipmentModal
       ↓  POST /api/shipments/:id/add-order { orderId }
api/server.js  ──  calls shipmentMutations.addOrderToShipment(...)
       ↓
shipmentMutations.js (new)
       ├─ Fetch + validate shipment (404 / 409 gates on Delivered, Cancelled)
       ├─ Fetch + validate order (409 on already-assigned, wrong status)
       ├─ Recalculate weight, pieces, total_cost (proportional to weight)
       ├─ dbUpdate('shipments', ...) then dbUpdate('orders', ...)
       │     (roll shipment back if the order update fails)
       ├─ REQ-02: recordChange 'plan' on order + recordFieldDiffs on shipment
       └─ REQ-01: bus.emit(ORDER_UPDATED) for the open TMS tabs
```

### Cost recalculation strategy

Proportional to weight, with a defensive fallback for the zero-weight edge case:

```
if oldWeight > 0:
    scale   = newWeight / oldWeight
    newCost = round(oldCost × scale, 2)
else:
    # Cannot derive a $/lb rate from zero. Keep cost as-is.
    scale   = 1
    newCost = oldCost                 # plus recalc.note flag
```

`fuel_surcharge` and `accessorials` scale the same way when they're present and non-null. The preview card in the modal mirrors this logic so the user sees exactly what the server will do.

Why proportional: works for LTL (cost is weight-driven) and leaves TL cost roughly sensible when a full-truck shipment's weight swings modestly. If a future requirement needs rate-based recalc (e.g. look up `rate_per_mile` × `miles` + `FSC(weight)` from the `rates` table), the `recalcCost` helper is the single place to extend.

## Files changed

### New files

| Path | Purpose |
|---|---|
| `api/services/shipmentMutations.js` | Business logic for `addOrderToShipment` + `recalcCost`. Only writer of this path. All history hooks wrapped in best-effort try/catch so an audit failure never fails the primary write. |
| `frontend/src/components/orders/AddToShipmentModal.jsx` | Single-purpose modal: shipment-id input with datalist autocomplete, live preview card (weight, pieces, cost with strikethrough old→new), zero-weight warning, async submit + error surfacing. |
| `docs/REQ-03-change-summary.md` | This file. |

### Modified files

| Path | Change |
|---|---|
| `api/server.js` | Imports `shipmentMutations`. New route `POST /api/shipments/:id/add-order` with `{ orderId }` body. Emits `EVENTS.ORDER_UPDATED` on success. |
| `frontend/src/lib/api.js` | `ShipmentsApi.addOrder(shipmentId, orderId)` wrapper. |
| `frontend/src/services/shipmentOrderService.js` | Exports `addOrderToShipment(orderId, shipmentId)` that calls the new API wrapper. |
| `frontend/src/pages/OrdersPage.jsx` | Imports modal + service. Adds `addToShipOrder` state, `handleAddToShipment` handler, new `📦 Add to Ship` button in the action column for Unplanned/Planning-Failed rows, and a conditional modal render at the bottom. |

No migrations needed. The feature only writes to existing columns (`orders.shipment_id`, `orders.status`, `shipments.weight`, `shipments.pieces`, `shipments.total_cost`, `shipments.order_ids`, optionally `shipments.fuel_surcharge`, `shipments.accessorials`) and to the REQ-02 `change_history` table.

## DB change summary (zoree_db_rules 8-point)

1. **Schema changes:** None.
2. **Migration file path:** N/A — no DDL.
3. **Backfill needs:** None.
4. **Index changes:** None.
5. **Constraint changes:** None.
6. **Rollback SQL:** N/A (no schema change). Operational rollback of an add: set `orders.shipment_id=null`, `orders.status='Unplanned'`, remove id from `shipments.order_ids`, re-subtract weight/pieces/total_cost. The existing Unplan action already does this (and now also writes the inverse audit rows via REQ-02).
7. **Affected APIs/UI:** One new POST endpoint, one new frontend service function, one new modal, one new action button. No other endpoints touched.
8. **Risks & assumptions:** Single add is not transactional across two rows — if the order update fails after the shipment update, we roll the shipment back with a compensating `dbUpdate`. If the rollback itself fails (rare: network blip between the two calls), the shipment could end up pre-advanced. Mitigation noted inline. Assumes `orders.shipment_id` is a nullable free-form text (matches today's schema). Assumes `shipments.order_ids` is a JSONB or `text[]`; Supabase REST handles both transparently.

## Results (from this run)

- **Order chosen:** `ORD-843218` — Unplanned, 60 lb, 30 pcs.
- **Shipment chosen:** `SHP-2026-7377` — Planned, AVERITT EXPRESS, LTL, 91 lb, 12 pcs, $188.00.
- **Preview rendered:** weight 91→151, pieces 12→42, total_cost $188.00→$311.96.
- **After submit:** shipment weight=151, pieces=42, total_cost=311.96, order_ids=['ORD-2026-427236','ORD-843218']; order status='Planned', shipment_id='SHP-2026-7377'.
- **History rows written:** 1 `plan` on order (addedVia=manual-add-to-shipment, carrier=AVERITT EXPRESS) + 4 `edit` on shipment (weight, pieces, total_cost, order_ids), all by `admin@zoree.io`, metadata.scale=1.6593406593.

See `test/results/test-run-REQ3-2026-04-16-1531.xlsx` for the full 7-row test matrix.

## How to verify locally

1. API + frontend running (`npm run dev`).
2. Open `/orders`, find any Unplanned order, click `📦 Add to Ship`.
3. Enter any valid shipment id. The preview card should render the new weight / pieces / cost.
4. Click `Add to Shipment →`.
5. Toast shows old-cost → new-cost. The order row flips to Planned with the target shipment id. Open the shipment (e.g. via ShipmentsPage) and confirm the order appears in its order list and the totals reflect the recalc.
6. Open the order's History tab — you'll see the `plan` entry with metadata `addedVia=manual-add-to-shipment`. Open the shipment's history via `GET /api/shipments/:id/history` to see the 4 `edit` rows.

## Open follow-ups

- **Rate-based recalc alternative.** If stakeholders want cost to follow the rate table instead of a flat proportional scale (e.g. `rate_per_mile × miles + FSC(weight)`), extend `recalcCost` to look up `shipments.rate_id` and fetch from `rates`, falling back to proportional when rate isn't on file. Single-function change, no other touch points.
- **Bulk add.** Current endpoint accepts one order at a time. A `{ orderIds: [...] }` variant would be a natural REQ-05 companion — the service signature is ready for that by accepting an array and summing before recalculating.
- **Shipments page.** The Add-to-Ship action is only on the Orders page today. If the UX wants to drive this from the shipment side too (pick a shipment → add multiple orders), we can reuse the same endpoint with a picker modal on `ShipmentsPage`.
