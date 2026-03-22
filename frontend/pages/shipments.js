// ═══════════════════════════════════════════════════════════════════
// Shipments Page
// ═══════════════════════════════════════════════════════════════════

function renderShipments() {
  const el = document.getElementById('shipments-content');
  if (!el) return;

  const q = (document.getElementById('shp-search')?.value || '').toLowerCase();
  const filtered = _shipments.filter(s =>
    !q ||
    s.id.toLowerCase().includes(q) ||
    (s.carrier || '').toLowerCase().includes(q) ||
    (s.origin || '').toLowerCase().includes(q) ||
    (s.destination || '').toLowerCase().includes(q)
  );

  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Shipment ID</th><th>Carrier</th><th>Mode</th>
        <th>Origin → Destination</th><th>Weight</th>
        <th>Pickup</th><th>Delivery</th>
        <th>Cost</th><th>Status</th><th>Actions</th>
      </tr></thead>
      <tbody>
        ${filtered.map(s => `
          <tr>
            <td class="mono" style="color:var(--accent);font-size:12px">${s.id}</td>
            <td style="font-weight:500">${s.carrier || '—'}</td>
            <td><span class="badge badge-blue">${s.mode || 'TL'}</span></td>
            <td style="font-size:12px;color:var(--text2)">${s.origin || '—'} → ${s.destination || '—'}</td>
            <td class="mono">${(s.weight || 0).toLocaleString()} lbs</td>
            <td style="font-size:12px">${s.pickupDate || '—'}</td>
            <td style="font-size:12px">${s.deliveryDate || '—'}</td>
            <td class="mono" style="font-weight:600">$${(s.cost || 0).toLocaleString()}</td>
            <td>${statusBadge(s.status)}</td>
            <td>
              <div style="display:flex;gap:4px">
                ${s.status === 'Planned' ? `
                  <button class="btn btn-sm" style="background:var(--teal-dim);color:var(--teal);border:1px solid rgba(15,118,110,.2)"
                    onclick="updateShipStatus('${s.id}','In Transit')">▶ Ship</button>
                ` : ''}
                ${s.status === 'In Transit' ? `
                  <button class="btn btn-sm btn-secondary"
                    onclick="updateShipStatus('${s.id}','Delivered')">✓ POD</button>
                ` : ''}
                <button class="btn btn-sm btn-secondary" onclick="viewShipment('${s.id}')">👁</button>
              </div>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3)">No shipments found</td></tr>'}
      </tbody>
    </table>
  `;
}

async function updateShipStatus(id, status) {
  try {
    const updated = await ShipmentsAPI.updateStatus(id, status);
    const idx = _shipments.findIndex(s => s.id === id);
    if (idx >= 0) _shipments[idx] = { ..._shipments[idx], status };
    renderShipments();
    toast(`${id} → ${status}`, 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function viewShipment(id) { toast(`Shipment detail: ${id}`, 'info'); }
function openNewShipment() { toast('New shipment modal — coming soon', 'info'); }


// ═══════════════════════════════════════════════════════════════════
// Carriers Page
// ═══════════════════════════════════════════════════════════════════

function renderCarriers() {
  const el = document.getElementById('carriers-content');
  if (!el) return;

  el.innerHTML = `
    <div class="kpi-row">
      <div class="stat-card">
        <div class="stat-label">Total Carriers</div>
        <div class="stat-val">${_carriers.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active</div>
        <div class="stat-val" style="color:var(--green)">${_carriers.filter(c => c.status === 'Active').length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Preferred</div>
        <div class="stat-val" style="color:var(--accent)">${_carriers.filter(c => c.preferred).length}</div>
      </div>
    </div>

    <div class="card" style="overflow:hidden">
      <table>
        <thead><tr>
          <th>Name</th><th>SCAC</th><th>Mode</th><th>OTD %</th><th>Rating</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>
          ${_carriers.map(c => `
            <tr>
              <td style="font-weight:500">${c.name} ${c.preferred ? '⭐' : ''}</td>
              <td class="mono" style="font-size:12px;color:var(--text3)">${c.scac || '—'}</td>
              <td><span class="badge badge-blue">${c.mode || 'TL'}</span></td>
              <td class="mono" style="color:${c.otd >= 95 ? 'var(--green)' : c.otd >= 85 ? 'var(--amber)' : 'var(--red)'}">${c.otd || 0}%</td>
              <td style="font-size:13px">${'★'.repeat(Math.round(c.rating || 0))}${'☆'.repeat(5 - Math.round(c.rating || 0))}</td>
              <td><span class="badge ${c.status === 'Active' ? 'badge-green' : 'badge-red'}">${c.status}</span></td>
              <td>
                <button class="btn btn-sm btn-danger" onclick="deleteCarrier('${c.id}')">🗑</button>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No carriers configured</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function deleteCarrier(id) {
  if (!confirm('Remove this carrier?')) return;
  try {
    await CarriersAPI.delete(id);
    _carriers = _carriers.filter(c => c.id !== id);
    renderCarriers();
    toast('Carrier removed', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function openAddCarrier() { toast('Add carrier form — coming soon', 'info'); }


// ═══════════════════════════════════════════════════════════════════
// Rates Page
// ═══════════════════════════════════════════════════════════════════

async function renderRates() {
  const el = document.getElementById('rates-content');
  if (!el) return;
  el.innerHTML = `<div style="color:var(--text3);padding:20px">Loading rates…</div>`;

  try {
    const { rates } = await RatesAPI.list();
    el.innerHTML = `
      <div class="card" style="overflow:hidden">
        <table>
          <thead><tr>
            <th>Lane</th><th>Carrier</th><th>Mode</th><th>Rate/CWT</th><th>FSC %</th><th>Transit</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${rates.map(r => `
              <tr>
                <td style="font-weight:500">${r.origin} → ${r.destination}</td>
                <td>${r.carrier}</td>
                <td><span class="badge badge-blue">${r.mode}</span></td>
                <td class="mono">$${r.ratePerMile}</td>
                <td class="mono">${r.fscPct}%</td>
                <td class="mono">${r.transitDays ? r.transitDays + 'd' : '—'}</td>
                <td>
                  <button class="btn btn-sm btn-danger" onclick="deleteRate('${r.id}')">🗑</button>
                </td>
              </tr>
            `).join('') || '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text3)">No rates configured</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (e) {
    if (e.upgradeRequired) {
      el.innerHTML = `
        <div style="text-align:center;padding:60px;color:var(--text3)">
          <div style="font-size:48px;margin-bottom:16px">🔒</div>
          <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">
            Rate Management requires Pro or Enterprise
          </div>
          <div style="font-size:13px;margin-bottom:20px">Upgrade your plan to unlock rate management, freight audit, and analytics.</div>
          <button class="btn btn-primary" onclick="navigate('settings')">View Plans →</button>
        </div>
      `;
    } else {
      el.innerHTML = `<div style="color:var(--red);padding:20px">${e.message}</div>`;
    }
  }
}

async function deleteRate(id) {
  if (!confirm('Delete this rate?')) return;
  try {
    await RatesAPI.delete(id);
    renderRates();
    toast('Rate deleted', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

function openAddRate() { toast('Add rate form — coming soon', 'info'); }


// ═══════════════════════════════════════════════════════════════════
// Settings Page
// ═══════════════════════════════════════════════════════════════════

async function renderSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;

  const user   = ZoreeAPI.Auth.getUser();
  const tenant = ZoreeAPI.Auth.getTenant();

  el.innerHTML = `
    <div style="max-width:600px">
      <div class="section-title">Account</div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div style="width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff">
            ${(user?.name || 'U')[0]}
          </div>
          <div>
            <div style="font-weight:600;font-size:15px">${user?.name || '—'}</div>
            <div style="font-size:12px;color:var(--text3)">${user?.email || '—'} · ${user?.role || '—'}</div>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="ZoreeAPI.AuthAPI.logout()">Sign Out</button>
      </div>

      <div class="section-title">Current Plan</div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-family:var(--font-display);font-size:16px;font-weight:700">${tenant?.brandName || 'ZoreeTMS'}</div>
            <div style="font-size:12px;color:var(--text3)">Tenant: ${tenant?.id || '—'}</div>
          </div>
          <span class="badge badge-${tenant?.tier === 'enterprise' ? 'purple' : tenant?.tier === 'pro' ? 'blue' : 'amber'}" style="font-size:11px;padding:4px 10px">
            ${(tenant?.tier || 'starter').toUpperCase()}
          </span>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:12px">Active features:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${(tenant?.features || []).map(f =>
            f === '*'
              ? `<span class="badge badge-purple">All Features</span>`
              : `<span class="badge badge-teal" style="font-size:9px">${f}</span>`
          ).join('')}
        </div>
      </div>

      <div class="section-title">API Configuration</div>
      <div class="card" style="padding:20px">
        <div style="font-size:12px;color:var(--text3);margin-bottom:8px">API Endpoint</div>
        <div class="mono" style="font-size:12px;background:var(--bg3);padding:8px 12px;border-radius:var(--radius-sm);color:var(--text2)">
          ${window.ZOREE_API_URL || 'http://localhost:3001/api'}
        </div>
      </div>
    </div>
  `;
}
