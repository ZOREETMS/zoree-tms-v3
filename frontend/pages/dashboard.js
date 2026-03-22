// ═══════════════════════════════════════════════════════════════════
// Dashboard Page — renders KPIs and recent activity
// ═══════════════════════════════════════════════════════════════════

function renderDashboard() {
  const el = document.getElementById('dash-content');
  if (!el) return;

  // Update date
  const dateEl = document.getElementById('dash-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  const inTransit  = _shipments.filter(s => s.status === 'In Transit').length;
  const planned    = _shipments.filter(s => s.status === 'Planned').length;
  const unplanned  = _orders.filter(o => o.status === 'Unplanned').length;
  const delivered  = _shipments.filter(s => s.status === 'Delivered').length;
  const totalSpend = _shipments.reduce((s, sh) => s + (sh.cost || 0), 0);
  const otd        = _shipments.length
    ? Math.round((_shipments.filter(s => s.status === 'Delivered').length / _shipments.length) * 100)
    : 0;

  el.innerHTML = `
    <!-- KPI Row -->
    <div class="kpi-row">
      <div class="stat-card">
        <div class="stat-label">Active Shipments</div>
        <div class="stat-val">${inTransit + planned}</div>
        <div class="stat-sub">${inTransit} in transit · ${planned} planned</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">On-Time Delivery</div>
        <div class="stat-val" style="color:var(--green)">${otd}%</div>
        <div class="stat-sub">${delivered} delivered</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Freight Spend (MTD)</div>
        <div class="stat-val">$${(totalSpend/1000).toFixed(0)}K</div>
        <div class="stat-sub">Total cost across all shipments</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Unplanned Orders</div>
        <div class="stat-val" style="color:${unplanned > 0 ? 'var(--amber)' : 'var(--green)'}">${unplanned}</div>
        <div class="stat-sub">${unplanned > 0 ? 'Awaiting consolidation' : 'All orders planned'}</div>
      </div>
    </div>

    <!-- Status Breakdown -->
    <div class="section-title">Shipment Status</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
      ${[
        ['In Transit', inTransit, 'var(--accent)'],
        ['Planned',    planned,   'var(--teal)'],
        ['Delivered',  delivered, 'var(--green)'],
        ['Exceptions', _shipments.filter(s => s.status === 'Exception').length, 'var(--red)'],
      ].map(([label, count, color]) => `
        <div class="card" style="padding:16px;text-align:center;cursor:pointer" onclick="navigate('shipments')">
          <div style="font-family:var(--font-display);font-size:28px;font-weight:700;color:${color}">${count}</div>
          <div style="font-size:11px;color:var(--text3);text-transform:uppercase;letter-spacing:.7px;margin-top:4px">${label}</div>
        </div>
      `).join('')}
    </div>

    <!-- Recent Shipments -->
    <div class="section-title">Recent Shipments</div>
    <div class="card" style="overflow:hidden;margin-bottom:24px">
      <table>
        <thead><tr>
          <th>Shipment</th><th>Carrier</th><th>Origin → Dest</th><th>Status</th><th>Cost</th>
        </tr></thead>
        <tbody>
          ${_shipments.slice(0, 6).map(s => `
            <tr style="cursor:pointer" onclick="navigate('shipments')">
              <td class="mono" style="color:var(--accent);font-size:12px">${s.id}</td>
              <td style="font-weight:500">${s.carrier || '—'}</td>
              <td style="font-size:12px;color:var(--text2)">${s.origin || '—'} → ${s.destination || '—'}</td>
              <td>${statusBadge(s.status)}</td>
              <td class="mono" style="font-size:12px">$${(s.cost || 0).toLocaleString()}</td>
            </tr>
          `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:24px">No shipments yet</td></tr>'}
        </tbody>
      </table>
    </div>

    <!-- Unplanned Orders -->
    ${unplanned > 0 ? `
      <div class="section-title">Unplanned Orders</div>
      <div class="card" style="overflow:hidden">
        <table>
          <thead><tr><th>Order</th><th>Customer</th><th>Lane</th><th>Weight</th><th>Due</th></tr></thead>
          <tbody>
            ${_orders.filter(o => o.status === 'Unplanned').slice(0, 5).map(o => `
              <tr style="cursor:pointer" onclick="navigate('orders')">
                <td class="mono" style="color:var(--accent);font-size:12px">${o.id}</td>
                <td>${o.customer}</td>
                <td style="font-size:12px;color:var(--text2)">${o.origin} → ${o.destination}</td>
                <td class="mono">${(o.weight || 0).toLocaleString()} lbs</td>
                <td style="font-size:12px;color:${o.dueDate ? 'var(--text2)' : 'var(--text3)'}">${o.dueDate || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;
}

function statusBadge(status) {
  const map = {
    'Unplanned':  'badge-amber',
    'Planned':    'badge-teal',
    'In Transit': 'badge-blue',
    'Delivered':  'badge-green',
    'Tendered':   'badge-purple',
    'Exception':  'badge-red',
    'Cancelled':  'badge-red',
  };
  return `<span class="badge ${map[status] || 'badge-blue'}">${status}</span>`;
}
