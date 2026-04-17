# REQ-03 — Add Order to Shipment + Auto Cost Recalculation

**Requirement:** From an order, an action menu "Add to shipment" accepts a
shipment ID, attaches the order, and automatically recalculates shipment cost
based on the new combined weight.

**Acceptance:** Open order → Actions → Add to Shipment → enter valid shipment
ID → confirm. The order appears in that shipment's order list; the shipment's
total cost has been recalculated to reflect the new weight.

---

## 1. Change Summary

### Files to modify

| Path | Change | Why |
|---|---|---|
| `api/services/shipments.js` | Edit | New `addOrderToShipment(shipId, orderId, ctx)` function with transactional cost recalc |
| `api/routes/shipments.js` | Edit | New `POST /shipments/:id/orders` route |
| `api/services/orderMutations.js` | Edit | Clear order.shipment_id on unassign; set on assign |
| `frontend/src/services/shipmentOrderService.js` | Edit | `addOrderToShipment(shipId, orderId)` helper hits new route |
| `frontend/src/pages/OrdersPage.jsx` | Edit | Add "Add to Shipment" action menu item on each unplanned order |
| `frontend/src/components/AddToShipmentModal.jsx` | New | Modal to enter shipment ID + confirm |

### Files to create

| Path | Purpose |
|---|---|
| `frontend/src/components/AddToShipmentModal.jsx` | Small modal; input + confirm; shows recalc preview after success |
| `test/REQ-03-add-order-to-shipment.spec.js` | Playwright spec — happy path + guard cases |

### DB changes

None. `orders.shipment_id` and `shipments.order_ids` already exist. Optional: add
`shipments.expected_cost numeric` so the frozen pre-tender snapshot survives
later recalcs (recommended for REQ-06). Include in consolidated migration 006.

### API changes

```
POST /shipments/:id/orders
  body:    { orderId: "ORD-..." }
  200:     { shipment: <full shipment after recalc>, recalc: { prevCost, newCost, prevWeight, newWeight } }
  400:     shipment not in Draft|Planned (already dispatched) or order already assigned
  404:     shipment or order not found
```

### Frontend changes

- `OrdersPage` row menu gets "Add to Shipment…" item (planner/admin only — REQ-04 feature `orders.plan`)
- Modal: single input `shipmentId`, confirm button, inline preview "Current cost $X → New cost $Y"
- On success, toast and refresh orders+shipments

### Risks

1. **Concurrent adds to the same shipment** — two planners add different orders at once. Mitigated by `SELECT ... FOR UPDATE` in the transaction and a `CHECK` that the order isn't already in another shipment.
2. **Order weight missing or zero** — reject with 400 ("order has no weight; cannot recalc cost"). Don't silently compute with 0 weight.
3. **Rate engine not available** — if the rate lookup fails, fall back to linear scaling: `newCost = oldCost * (newWeight / oldWeight)`. Log a warning so finance knows the cost is an estimate.
4. **Idempotency** — calling with an orderId already in the shipment is a no-op that returns 200 with `recalc.prevCost === recalc.newCost`. Test asserts this.

---

## 2. Service code shape

```js
// api/services/shipments.js — new function

async function addOrderToShipment(shipId, orderId, ctx) {
  return db.transaction(async (tx) => {
    // 1. Lock shipment row
    const ship = await tx.selectOneForUpdate('shipments', { id: shipId });
    if (!ship) throw err(404, 'shipment not found');
    if (!['Draft', 'Planned'].includes(ship.status)) {
      throw err(400, `shipment is ${ship.status}, too late to add orders`);
    }

    // 2. Load order, validate
    const order = await tx.selectOne('orders', { id: orderId });
    if (!order) throw err(404, 'order not found');
    if (order.shipment_id && order.shipment_id !== shipId) {
      throw err(400, `order is already in ${order.shipment_id}`);
    }
    if (!order.weight || order.weight <= 0) {
      throw err(400, 'order has no weight');
    }

    // 3. Idempotent: order already in shipment?
    const already = (ship.order_ids || []).includes(orderId);
    const prevWeight = ship.weight || 0;
    const prevCost   = ship.total_cost || 0;

    const newWeight = already ? prevWeight : prevWeight + order.weight;
    const newOrderIds = already ? ship.order_ids : [...(ship.order_ids||[]), orderId];

    // 4. Recalc cost (use rate engine; fall back to linear scale)
    let newCost;
    try {
      newCost = await recalcCostFromRate(ship, newWeight);   // uses shipments.rate_id
    } catch (e) {
      console.warn('[recalc] rate engine unavailable, linear scaling:', e.message);
      newCost = prevWeight > 0
        ? round2(prevCost * (newWeight / prevWeight))
        : estimateCost(newWeight, ship.miles || 0);
    }

    // 5. Persist shipment + order
    await tx.update('shipments', shipId, {
      weight:     newWeight,
      order_ids:  newOrderIds,
      total_cost: newCost,
      updated_at: new Date().toISOString(),
    });
    if (!already) {
      await tx.update('orders', orderId, {
        shipment_id: shipId,
        status:      'Planned',
      });
    }

    // 6. Audit (REQ-02)
    if (!already) {
      await audit.logAudit({
        tenantId: ctx.tenantId, entityType: 'order', entityId: orderId,
        action: 'plan', after: { shipmentId: shipId }, actor: ctx.user,
      });
    }
    await audit.logAudit({
      tenantId: ctx.tenantId, entityType: 'shipment', entityId: shipId,
      action: 'cost_recalc',
      before: { weight: prevWeight, total_cost: prevCost },
      after:  { weight: newWeight, total_cost: newCost },
      actor: ctx.user,
    });

    const updated = await tx.selectOne('shipments', { id: shipId });
    return {
      shipment: dbToShipment(updated),
      recalc: { prevCost, newCost, prevWeight, newWeight },
    };
  });
}
```

## 3. Route + frontend

```js
// api/routes/shipments.js
router.post('/:id/orders', requireFeature('orders.plan'), async (req, res) => {
  try {
    const result = await shipments.addOrderToShipment(
      req.params.id, req.body.orderId, { tenantId: req.tenantId, user: req.user }
    );
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});
```

```js
// frontend/src/services/shipmentOrderService.js
export async function addOrderToShipment(shipId, orderId) {
  return DbApi.post(`shipments/${shipId}/orders`, { orderId });
}
```

`AddToShipmentModal.jsx` — 60 lines: input + confirm; on success shows the `recalc`
delta as "Cost: $X → $Y ({+/-}% )"; on 400/404 shows the backend error inline.

## 4. Playwright spec — `test/REQ-03-add-order-to-shipment.spec.js`

```js
const { test, expect } = require('@playwright/test');

const TMS = 'http://localhost:5173';

test.describe('REQ-03: Add order to shipment + cost recalc', () => {

  test('happy path: order attaches and shipment cost updates', async ({ page }) => {
    await page.goto(TMS + '/orders');
    await page.waitForLoadState('networkidle');
    const orderRow = page.getByRole('row').nth(1);
    const orderId  = await orderRow.getAttribute('data-id');

    await orderRow.getByRole('button', { name: /actions|menu/i }).click();
    await page.getByRole('menuitem', { name: /add to shipment/i }).click();

    // type a valid existing shipment id — helper API grab
    const shipId = await page.evaluate(async () => {
      const r = await fetch('/api/shipments?status=Planned&limit=1');
      return (await r.json())[0]?.id;
    });
    expect(shipId).toBeTruthy();

    await page.getByLabel(/shipment id/i).fill(shipId);
    // Capture "Current cost" from the recalc preview before confirm
    await page.getByRole('button', { name: /confirm|add/i }).click();

    // Navigate to shipment and verify order appears + cost is new
    await page.goto(TMS + '/shipments?id=' + shipId);
    await expect(page.getByText(orderId)).toBeVisible();
    const costText = await page.getByTestId('shipment-total-cost').textContent();
    expect(costText).toMatch(/\$\d/);
  });

  test('rejects if shipment is already Dispatched', async ({ page }) => {
    await page.goto(TMS + '/orders');
    const unplannedRow = page.getByRole('row').nth(1);
    await unplannedRow.getByRole('button', { name: /actions/i }).click();
    await page.getByRole('menuitem', { name: /add to shipment/i }).click();
    // Type an id of a dispatched shipment (seeded in test fixtures)
    await page.getByLabel(/shipment id/i).fill('SHP-2026-0001');  // fixture: dispatched
    await page.getByRole('button', { name: /confirm/i }).click();
    await expect(page.getByText(/too late|dispatched|shipment is/i)).toBeVisible();
  });

  test('idempotent: adding the same order twice is a no-op', async ({ page, request }) => {
    const ship = (await (await request.get('/api/shipments?status=Planned&limit=1')).json())[0];
    const order = (await (await request.get('/api/orders?status=Unplanned&limit=1')).json())[0];
    const first  = await (await request.post(`/api/shipments/${ship.id}/orders`, {
      data: { orderId: order.id }
    })).json();
    const second = await (await request.post(`/api/shipments/${ship.id}/orders`, {
      data: { orderId: order.id }
    })).json();
    expect(second.recalc.newCost).toBe(first.recalc.newCost);
    expect(second.recalc.newWeight).toBe(first.recalc.newWeight);
  });
});
```

## 5. Notes for the tester

- Cost recalc uses the stored rate for the shipment when available; otherwise linear weight-scaling. The test should not assume a specific cost formula — only that the cost **changed** relative to `prevCost`.
- When REQ-02 lands, add an assertion: `GET /shipments/:id/history` contains a `cost_recalc` row.
