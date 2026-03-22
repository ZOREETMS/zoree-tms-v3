// ═══════════════════════════════════════════════════════════════════
// Orders Page — list, search, create, update via API
// ═══════════════════════════════════════════════════════════════════

function renderOrders() {
  const el = document.getElementById('orders-content');
  if (!el) return;

  const q = (document.getElementById('ord-search')?.value || '').toLowerCase();
  const filtered = _orders.filter(o =>
    !q ||
    o.id.toLowerCase().includes(q) ||
    (o.customer || '').toLowerCase().includes(q) ||
    (o.origin || '').toLowerCase().includes(q) ||
    (o.destination || '').toLowerCase().includes(q)
  );

  // Group unplanned by lane
  const unplanned = filtered.filter(o => o.status === 'Unplanned');
  const laneMap   = {};
  unplanned.forEach(o => {
    const key = `${o.origin}||${o.destination}`;
    if (!laneMap[key]) laneMap[key] = { origin: o.origin, destination: o.destination, orders: [], totalWeight: 0 };
    laneMap[key].orders.push(o);
    laneMap[key].totalWeight += (o.weight || 0);
  });
  const laneGroups = Object.values(laneMap);

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Order ID</th><th>Customer</th><th>Origin</th><th>Destination</th>
        <th>Weight</th><th>Pieces</th><th>Commodity</th>
        <th>Ready</th><th>Due</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${laneGroups.map(lane => `
          <!-- Lane group header -->
          <tr style="background:var(--bg3)">
            <td colspan="11" style="padding:8px 14px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:11px;font-weight:600;color:var(--text2)">
                  📍 ${lane.origin} → ${lane.destination}
                </span>
                <span style="font-size:10px;color:var(--text3)">${lane.orders.length} order${lane.orders.length > 1 ? 's' : ''} · ${lane.totalWeight.toLocaleString()} lbs</span>
                <span class="badge ${lane.totalWeight >= 35000 ? 'badge-green' : 'badge-amber'}" style="font-size:9px">
                  ${lane.totalWeight >= 35000 ? 'Full TL' : lane.totalWeight >= 10000 ? 'Partial TL' : 'LTL'}
                </span>
                ${lane.orders.length > 1 ? `
                  <button class="btn btn-sm" style="background:var(--accent);color:#fff;margin-left:auto"
                    onclick="consolidateLane('${lane.origin}', '${lane.destination}')">
                    ⚡ Plan Group
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
          ${lane.orders.map(o => orderRow(o)).join('')}
        `).join('')}

        <!-- Non-unplanned orders -->
        ${filtered.filter(o => o.status !== 'Unplanned').map(o => orderRow(o)).join('')}

        ${!filtered.length ? `
          <tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">
            No orders found
          </td></tr>
        ` : ''}
      </tbody>
    </table>
  `;
}

function orderRow(o) {
  return `
    <tr>
      <td class="mono" style="color:var(--accent);font-size:12px">${o.id}</td>
      <td style="font-weight:500">${o.customer || '—'}</td>
      <td style="font-size:12px;color:var(--text2)">${o.origin || '—'}</td>
      <td style="font-size:12px;color:var(--text2)">${o.destination || '—'}</td>
      <td class="mono">${(o.weight || 0).toLocaleString()} lbs</td>
      <td class="mono">${o.pieces || '—'}</td>
      <td style="font-size:12px;color:var(--text3)">${o.commodity || '—'}</td>
      <td style="font-size:12px">${o.readyDate || '—'}</td>
      <td style="font-size:12px">${o.dueDate || '—'}</td>
      <td>${statusBadge(o.status)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-sm btn-secondary" onclick="editOrder('${o.id}')">✏️</button>
          <button class="btn btn-sm btn-danger"    onclick="deleteOrder('${o.id}')">🗑</button>
        </div>
      </td>
    </tr>
  `;
}

async function deleteOrder(id) {
  if (!confirm(`Delete order ${id}?`)) return;
  try {
    await OrdersAPI.delete(id);
    _orders = _orders.filter(o => o.id !== id);
    renderOrders();
    toast(`Order ${id} deleted`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function consolidateLane(origin, destination) {
  const laneOrders = _orders.filter(o =>
    o.status === 'Unplanned' && o.origin === origin && o.destination === destination
  );
  if (!laneOrders.length) return;

  try {
    // Create shipment via API
    const totalWeight = laneOrders.reduce((s, o) => s + (o.weight || 0), 0);
    const totalPieces = laneOrders.reduce((s, o) => s + (o.pieces || 0), 0);
    const shipment    = await ShipmentsAPI.create({
      origin, destination,
      weight:             totalWeight,
      pieces:             totalPieces,
      status:             'Planned',
      consolidatedOrders: laneOrders.map(o => o.id),
    });

    // Update each order status
    await Promise.all(laneOrders.map(o =>
      OrdersAPI.update(o.id, { status: 'Consolidated', shipmentId: shipment.id })
    ));

    await refreshAll();
    toast(`${laneOrders.length} orders consolidated → ${shipment.id}`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openNewOrder() {
  // In full implementation: open a modal form
  // For now, show a simple prompt-based flow
  toast('Order creation modal — connect to your existing OMS flow', 'info');
}

function editOrder(id) {
  toast(`Edit order ${id} — modal coming soon`, 'info');
}
