// ═══════════════════════════════════════════════════════════════════
// Bulk Planning Workbench — OTM-style bulk plan, rate, execute
// ═══════════════════════════════════════════════════════════════════

var _bpSelected   = {};      // orderId → true
var _bpLanes      = [];      // grouped lane objects
var _bpRates      = {};      // laneKey → { quotes:[], bestQuote }
var _bpAssign     = {};      // laneKey → chosen carrier quote
var _bpResults    = null;    // execution results for results tab

// Ensure statusBadge helper exists (may be defined in main app)
if (typeof statusBadge === 'undefined') {
  window.statusBadge = function(status) {
    var map = { 'Unplanned':'badge-amber','Planned':'badge-teal','Consolidated':'badge-blue',
      'In Transit':'badge-blue','Delivered':'badge-green','Tendered':'badge-purple',
      'Exception':'badge-red','Cancelled':'badge-red','LTL':'badge-blue','TL':'badge-green' };
    return '<span class="badge ' + (map[status] || 'badge-blue') + '">' + (status || '\u2014') + '</span>';
  };
}
var _bpTab        = 'select';
var _bpImported   = [];      // parsed from CSV/Excel
var _bpRating     = false;   // loading flag
var _bpExecuting  = false;

// ── Helpers ────────────────────────────────────────────────────────
function _bpApi(method, path, body) {
  var base = window.ZOREE_API_URL || 'http://localhost:3001/api';
  var token = (typeof _authToken !== 'undefined' && _authToken) || sessionStorage.getItem('zoree_token') || '';
  return fetch(base + path, {
    method: method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  }).then(function(r) { return r.json(); });
}

function _bpLoadType(w) {
  return w >= 35000 ? 'Full TL' : w >= 10000 ? 'Partial TL' : 'LTL';
}
function _bpLoadBadge(w) {
  var lt = _bpLoadType(w);
  var cls = lt === 'Full TL' ? 'badge-green' : lt === 'Partial TL' ? 'badge-amber' : 'badge-blue';
  return '<span class="badge ' + cls + '" style="font-size:9px">' + lt + '</span>';
}

// ── Tab Switching ──────────────────────────────────────────────────
function switchBPTab(tab) {
  _bpTab = tab;
  renderBulkPlan();
}

// ── Main Render ────────────────────────────────────────────────────
function renderBulkPlan() {
  var el = document.getElementById('bp-content');
  if (!el) return;

  // Update tab chips
  ['select','lanes','rates','summary','results'].forEach(function(t) {
    var chip = document.getElementById('bp-tab-' + t);
    if (chip) {
      chip.className = 'ord-chip' + (t === _bpTab ? ' active-chip' : '');
      if (t === 'results') chip.style.display = (_bpResults || _bpTab === 'results') ? '' : 'none';
    }
  });

  // Update action buttons visibility
  var execBtn = document.getElementById('bp-execute-btn');
  if (execBtn) execBtn.style.display = _bpTab === 'summary' ? '' : 'none';

  if (_bpTab === 'select')  return renderBPSelect(el);
  if (_bpTab === 'lanes')   return renderBPLanes(el);
  if (_bpTab === 'rates')   return renderBPRates(el);
  if (_bpTab === 'summary') return renderBPSummary(el);
  if (_bpTab === 'results') return renderBPResults(el);
}

// ══════════════════════════════════════════════════════════════════
// TAB 1: SELECT ORDERS
// ══════════════════════════════════════════════════════════════════
// Helper: get destination from order (handles both 'dest' and 'destination' field names)
function _bpDest(o) { return o.destination || o.dest || ''; }
function _bpReady(o) { return o.readyDate || o.ready || ''; }
function _bpDue(o) { return o.dueDate || o.due || ''; }

// US Federal holidays (fixed + observed floating)
function _bpUSHolidays(year) {
  var h = [];
  // New Year's Day
  h.push(year + '-01-01');
  // MLK Day — 3rd Monday in January
  h.push(_bpNthWeekday(year, 0, 1, 3));
  // Presidents' Day — 3rd Monday in February
  h.push(_bpNthWeekday(year, 1, 1, 3));
  // Memorial Day — last Monday in May
  h.push(_bpLastWeekday(year, 4, 1));
  // Independence Day
  h.push(year + '-07-04');
  // Labor Day — 1st Monday in September
  h.push(_bpNthWeekday(year, 8, 1, 1));
  // Columbus Day — 2nd Monday in October
  h.push(_bpNthWeekday(year, 9, 1, 2));
  // Veterans Day
  h.push(year + '-11-11');
  // Thanksgiving — 4th Thursday in November
  h.push(_bpNthWeekday(year, 10, 4, 4));
  // Christmas Day
  h.push(year + '-12-25');
  return h;
}
// Format local date as YYYY-MM-DD (avoids UTC timezone shift from toISOString)
function _bpFmtDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
// Parse YYYY-MM-DD string as local date (not UTC)
function _bpParseDate(str) {
  var parts = str.split('-');
  return new Date(+parts[0], +parts[1] - 1, +parts[2]);
}
function _bpNthWeekday(year, month, dow, n) {
  var d = new Date(year, month, 1);
  var count = 0;
  while (count < n) {
    if (d.getDay() === dow) count++;
    if (count < n) d.setDate(d.getDate() + 1);
  }
  return _bpFmtDate(d);
}
function _bpLastWeekday(year, month, dow) {
  var d = new Date(year, month + 1, 0); // last day of month
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
  return _bpFmtDate(d);
}
function _bpIsBusinessDay(date) {
  var day = date.getDay();
  if (day === 0 || day === 6) return false; // weekend
  var iso = _bpFmtDate(date);
  var holidays = _bpUSHolidays(date.getFullYear());
  return holidays.indexOf(iso) === -1;
}
// Subtract N business days from a date (skip weekends + holidays)
function _bpSubtractBusinessDays(fromDate, days) {
  var d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  var remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (_bpIsBusinessDay(d)) remaining--;
  }
  // If landing on a non-business day, move back to previous business day
  while (!_bpIsBusinessDay(d)) d.setDate(d.getDate() - 1);
  return d;
}
function _bpExtractZip(str) {
  if (!str) return '';
  var m = str.match(/\b(\d{5})\b/);
  return m ? m[1] : '';
}
function _bpOZip(o) { return o.originZip || _bpExtractZip(o.origin) || ''; }
function _bpDZip(o) { return o.destZip || _bpExtractZip(_bpDest(o)) || ''; }

function renderBPSelect(el) {
  var q = (document.getElementById('bp-search') || {}).value || '';
  q = q.toLowerCase();
  var custFilter = (document.getElementById('bp-cust-filter') || {}).value || '';

  var unplanned = (typeof orders !== 'undefined' ? orders : _orders).filter(function(o) {
    return o.status === 'Unplanned';
  });

  var filtered = unplanned.filter(function(o) {
    if (custFilter && (o.customer || '') !== custFilter) return false;
    if (q && !(o.id + (o.customer || '') + (o.origin || '') + _bpDest(o)).toLowerCase().includes(q)) return false;
    return true;
  });

  // Unique customers for dropdown
  var custs = {};
  unplanned.forEach(function(o) { if (o.customer) custs[o.customer] = true; });
  var custList = Object.keys(custs).sort();

  var selCount = Object.keys(_bpSelected).length;
  var selWeight = 0;
  filtered.forEach(function(o) { if (_bpSelected[o.id]) selWeight += (o.weight || 0); });

  var allChecked = filtered.length > 0 && filtered.every(function(o) { return _bpSelected[o.id]; });

  el.innerHTML = `
    <div style="padding:16px 20px">
      <!-- Filters -->
      <div style="display:flex;gap:10px;margin-bottom:14px;align-items:center;flex-wrap:wrap">
        <div class="search-wrap" style="flex:1;min-width:200px">
          <svg viewBox="0 0 20 20" fill="currentColor" style="width:14px;height:14px;position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text3)"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"/></svg>
          <input class="search-input" id="bp-search" placeholder="Search orders…" value="${q}" oninput="renderBulkPlan()" style="padding-left:32px">
        </div>
        <select id="bp-cust-filter" onchange="renderBulkPlan()" style="padding:7px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:#fff">
          <option value="">All Customers</option>
          ${custList.map(function(c) { return '<option value="' + c + '"' + (c === custFilter ? ' selected' : '') + '>' + c + '</option>'; }).join('')}
        </select>
        <button class="btn btn-sm btn-secondary" onclick="bpImportModal()" style="gap:4px">📤 Import Orders</button>
      </div>

      <!-- Selection summary -->
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding:10px 14px;background:var(--bg2);border-radius:10px;border:1px solid var(--border)">
        <span style="font-size:13px;font-weight:600;color:var(--text)">${selCount} order${selCount !== 1 ? 's' : ''} selected</span>
        <span style="font-size:12px;color:var(--text3)">${selWeight.toLocaleString()} lbs total</span>
        <span style="flex:1"></span>
        ${selCount > 0 ? '<button class="btn btn-sm" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-weight:600" onclick="bpPlanNow()">⚡ Bulk Plan Now</button>' : ''}
        ${selCount > 0 ? '<button class="btn btn-sm btn-secondary" onclick="bpClearSelection()">Clear</button>' : ''}
      </div>

      <!-- Orders table -->
      <table>
        <thead><tr>
          <th style="width:36px"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="bpSelectAll(this.checked)"></th>
          <th>Order ID</th><th>Customer</th><th>Origin</th><th>Destination</th>
          <th>Weight</th><th>Pieces</th><th>Commodity</th><th>Due Date</th>
        </tr></thead>
        <tbody>
          ${filtered.length === 0 ? '<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text3)">No unplanned orders</td></tr>' : ''}
          ${filtered.map(function(o) {
            var checked = _bpSelected[o.id] ? 'checked' : '';
            return '<tr style="cursor:pointer" onclick="bpToggle(\'' + o.id + '\')">' +
              '<td><input type="checkbox" ' + checked + ' onclick="event.stopPropagation();bpToggle(\'' + o.id + '\')"></td>' +
              '<td class="mono" style="color:var(--accent);font-size:12px">' + o.id + '</td>' +
              '<td style="font-weight:500">' + (o.customer || '—') + '</td>' +
              '<td style="font-size:12px;color:var(--text2)">' + (o.origin || '—') + '</td>' +
              '<td style="font-size:12px;color:var(--text2)">' + (_bpDest(o) || '—') + '</td>' +
              '<td class="mono">' + (o.weight || 0).toLocaleString() + ' lbs</td>' +
              '<td class="mono">' + (o.pieces || '—') + '</td>' +
              '<td style="font-size:12px;color:var(--text3)">' + (o.commodity || '—') + '</td>' +
              '<td style="font-size:12px">' + (_bpDue(o) || '—') + '</td>' +
            '</tr>';
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bpToggle(id) {
  if (_bpSelected[id]) delete _bpSelected[id];
  else _bpSelected[id] = true;
  renderBulkPlan();
}

function bpSelectAll(checked) {
  var q = (document.getElementById('bp-search') || {}).value || '';
  q = q.toLowerCase();
  var custFilter = (document.getElementById('bp-cust-filter') || {}).value || '';
  var unplanned = (typeof orders !== 'undefined' ? orders : _orders).filter(function(o) {
    if (o.status !== 'Unplanned') return false;
    if (custFilter && (o.customer || '') !== custFilter) return false;
    if (q && !(o.id + (o.customer || '') + (o.origin || '') + _bpDest(o)).toLowerCase().includes(q)) return false;
    return true;
  });
  if (checked) {
    unplanned.forEach(function(o) { _bpSelected[o.id] = true; });
  } else {
    unplanned.forEach(function(o) { delete _bpSelected[o.id]; });
  }
  renderBulkPlan();
}

function bpClearSelection() {
  _bpSelected = {};
  renderBulkPlan();
}

// ══════════════════════════════════════════════════════════════════
// TAB 2: LANE GROUPS
// ══════════════════════════════════════════════════════════════════
function bpGroupLanes() {
  var allOrders = (typeof orders !== 'undefined' ? orders : _orders);
  var selected = allOrders.filter(function(o) { return _bpSelected[o.id]; });
  if (!selected.length) { toast('Select at least one order', 'warning'); return; }

  // Group by lane (case-insensitive + normalize whitespace)
  var map = {};
  selected.forEach(function(o) {
    var dest = _bpDest(o);
    var key = (o.origin || '').trim().toLowerCase() + '|' + dest.trim().toLowerCase();
    if (!map[key]) map[key] = {
      laneKey: key,
      origin: o.origin || '',
      destination: dest,
      orders: [],
      totalWeight: 0,
      totalPieces: 0,
      originZip: _bpOZip(o) || '',
      destZip: _bpDZip(o) || '',
    };
    map[key].orders.push(o);
    map[key].totalWeight += (o.weight || 0);
    map[key].totalPieces += (o.pieces || 0);
    // Auto-fill ZIPs from order data if available
    if (!map[key].originZip && _bpOZip(o)) map[key].originZip = _bpOZip(o);
    if (!map[key].destZip && _bpDZip(o)) map[key].destZip = _bpDZip(o);
  });
  _bpLanes = Object.values(map);
  _bpTab = 'lanes';
  renderBulkPlan();
}

function renderBPLanes(el) {
  if (!_bpLanes.length) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">📍</div><div style="font-size:16px;font-weight:600">No lanes grouped yet</div><div style="font-size:13px;margin-top:6px">Go back to Select Orders and group by lane</div></div>';
    return;
  }

  var totalOrders = _bpLanes.reduce(function(s, l) { return s + l.orders.length; }, 0);
  var totalWeight = _bpLanes.reduce(function(s, l) { return s + l.totalWeight; }, 0);

  el.innerHTML = `
    <div style="padding:16px 20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;background:var(--bg2);border-radius:10px;border:1px solid var(--border)">
        <span style="font-size:13px;font-weight:600">${_bpLanes.length} lane${_bpLanes.length !== 1 ? 's' : ''}</span>
        <span style="font-size:12px;color:var(--text3)">${totalOrders} orders · ${totalWeight.toLocaleString()} lbs</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm" style="background:var(--accent);color:#fff" onclick="bpRateAll()">
          ${_bpRating ? '⏳ Rating…' : '💰 Rate All Lanes →'}
        </button>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:14px">
        ${_bpLanes.map(function(lane, idx) {
          return `
          <div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:16px;position:relative">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span style="font-size:14px;font-weight:600;color:var(--text)">📍 ${lane.origin}</span>
              <span style="color:var(--text3)">→</span>
              <span style="font-size:14px;font-weight:600;color:var(--text)">${lane.destination}</span>
              ${_bpLoadBadge(lane.totalWeight)}
            </div>
            <div style="display:flex;gap:16px;font-size:12px;color:var(--text2);margin-bottom:10px">
              <span>📦 ${lane.orders.length} order${lane.orders.length > 1 ? 's' : ''}</span>
              <span>⚖️ ${lane.totalWeight.toLocaleString()} lbs</span>
              <span>📐 ${lane.totalPieces} pcs</span>
            </div>
            <div style="display:flex;gap:6px;margin-bottom:8px">
              <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:3px">Origin ZIP</label>
              <input id="bp-ozip-${idx}" placeholder="ZIP" value="${lane.originZip || ''}" style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'JetBrains Mono',monospace" onchange="_bpLanes[${idx}].originZip=this.value">
              <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:3px">Dest ZIP</label>
              <input id="bp-dzip-${idx}" placeholder="ZIP" value="${lane.destZip || ''}" style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'JetBrains Mono',monospace" onchange="_bpLanes[${idx}].destZip=this.value">
              <label style="font-size:11px;color:var(--text3);display:block;margin-bottom:3px">Class</label>
              <input id="bp-class-${idx}" placeholder="70" value="${lane.freightClass || '70'}" style="width:50px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:'JetBrains Mono',monospace" onchange="_bpLanes[${idx}].freightClass=this.value">
            </div>
            <div style="font-size:11px;color:var(--text3)">
              Orders: ${lane.orders.map(function(o) { return '<span class="mono" style="color:var(--accent)">' + o.id + '</span>'; }).join(', ')}
            </div>
            <button class="btn btn-sm btn-danger" style="position:absolute;top:10px;right:10px;font-size:10px" onclick="bpRemoveLane(${idx})">✕</button>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function bpRemoveLane(idx) {
  var lane = _bpLanes[idx];
  if (lane) {
    lane.orders.forEach(function(o) { delete _bpSelected[o.id]; });
  }
  _bpLanes.splice(idx, 1);
  renderBulkPlan();
}

// ══════════════════════════════════════════════════════════════════
// TAB 3: RATE SHOPPING
// ══════════════════════════════════════════════════════════════════
async function bpRateAll() {
  // Sync ZIP values from inputs (if user edited them)
  _bpLanes.forEach(function(l, idx) {
    var ozEl = document.getElementById('bp-ozip-' + idx);
    var dzEl = document.getElementById('bp-dzip-' + idx);
    var fcEl = document.getElementById('bp-class-' + idx);
    if (ozEl && ozEl.value) l.originZip = ozEl.value;
    if (dzEl && dzEl.value) l.destZip = dzEl.value;
    if (fcEl && fcEl.value) l.freightClass = fcEl.value;
    // Fallback: extract ZIP from address string
    if (!l.originZip) l.originZip = _bpExtractZip(l.origin);
    if (!l.destZip) l.destZip = _bpExtractZip(l.destination);
  });

  // Validate ZIPs
  var missing = _bpLanes.filter(function(l) { return !l.originZip || !l.destZip; });
  if (missing.length) {
    toast('Enter ZIP codes for ' + missing.length + ' lane(s): ' + missing.map(function(l) { return l.origin + ' → ' + l.destination; }).join(', '), 'warning');
    return;
  }

  _bpRating = true;
  renderBulkPlan();

  try {
    var payload = {
      lanes: _bpLanes.map(function(l) {
        var miles = (typeof getDist === 'function') ? getDist(l.origin, l.destination) : 0;
        return {
          laneKey: l.laneKey,
          origin: l.origin,
          destination: l.destination,
          originZip: l.originZip,
          destZip: l.destZip,
          totalWeight: l.totalWeight,
          freightClass: parseInt(l.freightClass) || 70,
          orderIds: l.orders.map(function(o) { return o.id; }),
          miles: miles,
        };
      }),
      optimizeBy: 'cost',
    };

    var data = await _bpApi('POST', '/bulk-plan/rate', payload);

    if (data.error) throw new Error(data.error);

    // Store rates
    _bpRates = {};
    (data.results || []).forEach(function(r) {
      _bpRates[r.laneKey] = r;
      // Auto-assign: prefer lane preference carrier, then order preferred, then cheapest
      var assigned = _bpAssignWithPrefs(r.laneKey, r.quotes || []);
      if (assigned) _bpAssign[r.laneKey] = assigned;
      else if (r.bestQuote) _bpAssign[r.laneKey] = r.bestQuote;
    });

    _bpTab = 'rates';
    toast(_bpLanes.length + ' lane' + (_bpLanes.length > 1 ? 's' : '') + ' rated successfully', 'success');

  } catch (e) {
    toast('Rate error: ' + e.message, 'error');
  }

  _bpRating = false;
  renderBulkPlan();
}

function renderBPRates(el) {
  if (!Object.keys(_bpRates).length) {
    el.innerHTML = '<div style="text-align:center;padding:60px;color:var(--text3)"><div style="font-size:48px;margin-bottom:12px">💰</div><div style="font-size:16px;font-weight:600">No rates yet</div><div style="font-size:13px;margin-top:6px">Go to Lane Groups and click Rate All Lanes</div></div>';
    return;
  }

  var assignedCount = Object.keys(_bpAssign).length;

  el.innerHTML = `
    <div style="padding:16px 20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:10px 14px;background:var(--bg2);border-radius:10px;border:1px solid var(--border)">
        <span style="font-size:13px;font-weight:600">${assignedCount}/${_bpLanes.length} carriers assigned</span>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-secondary" onclick="bpAutoAssign('cost')">Auto: Cheapest</button>
        <button class="btn btn-sm btn-secondary" onclick="bpAutoAssign('transit')">Auto: Fastest</button>
        ${assignedCount === _bpLanes.length ? '<button class="btn btn-sm" style="background:var(--accent);color:#fff" onclick="switchBPTab(\'summary\')">Review Plan →</button>' : ''}
      </div>

      ${_bpLanes.map(function(lane) {
        var r = _bpRates[lane.laneKey];
        if (!r) return '<div style="padding:10px;color:var(--text3)">No rates for ' + lane.origin + ' → ' + lane.destination + '</div>';

        var quotes = r.quotes || [];
        var assigned = _bpAssign[lane.laneKey];

        return `
        <div style="background:#fff;border:1.5px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden">
          <div style="padding:12px 16px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px">
            <span style="font-weight:600;font-size:13px">📍 ${lane.origin} → ${lane.destination}</span>
            ${_bpLoadBadge(lane.totalWeight)}
            <span style="font-size:12px;color:var(--text3)">${lane.totalWeight.toLocaleString()} lbs · ${lane.orders.length} orders</span>
            ${assigned ? '<span class="badge badge-green" style="margin-left:auto;font-size:10px">✓ ' + assigned.carrier + '</span>' : '<span class="badge badge-amber" style="margin-left:auto;font-size:10px">Select carrier</span>'}
          </div>
          <table style="margin:0">
            <thead><tr>
              <th style="width:30px"></th>
              <th>Carrier</th><th>SCAC</th><th>Total</th>
              <th>Discount</th><th>FSC</th><th>Transit</th><th>Delivery</th>
            </tr></thead>
            <tbody>
              ${quotes.length === 0 ? '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--text3)">No carrier quotes available</td></tr>' : ''}
              ${quotes.map(function(q, qi) {
                var isSelected = assigned && assigned.carrier === q.carrier && assigned.scac === q.scac;
                var isBest = q.recommended;
                return '<tr style="' + (isSelected ? 'background:rgba(59,130,246,.06)' : '') + '">' +
                  '<td><input type="radio" name="bp-carrier-' + lane.laneKey.replace(/[^a-zA-Z0-9]/g,'_') + '" ' + (isSelected ? 'checked' : '') + ' onchange="bpPickCarrier(\'' + lane.laneKey + '\',' + qi + ')"></td>' +
                  '<td style="font-weight:500">' + q.carrier + (isBest ? ' <span class="badge badge-green" style="font-size:9px">Best</span>' : '') + '</td>' +
                  '<td class="mono" style="font-size:12px">' + (q.scac || '—') + '</td>' +
                  '<td class="mono" style="font-weight:600;color:var(--accent)">$' + (q.totalCharge || 0).toLocaleString() + '</td>' +
                  '<td class="mono" style="font-size:12px">' + (q.discountPct || 0) + '%</td>' +
                  '<td class="mono" style="font-size:12px">$' + (q.fscCharge || 0).toLocaleString() + '</td>' +
                  '<td class="mono">' + (q.transitDays || '—') + ' days</td>' +
                  '<td style="font-size:12px">' + (q.deliveryDate || '—') + '</td>' +
                '</tr>';
              }).join('')}
            </tbody>
          </table>
        </div>`;
      }).join('')}
    </div>
  `;
}

function bpPickCarrier(laneKey, quoteIdx) {
  var r = _bpRates[laneKey];
  if (r && r.quotes && r.quotes[quoteIdx]) {
    _bpAssign[laneKey] = r.quotes[quoteIdx];
  }
  renderBulkPlan();
}

// Find matching lane preference for a lane
function _bpFindLanePref(lane) {
  if (typeof lanePreferences === 'undefined' || !lanePreferences.length) return null;
  var oNorm = (lane.origin || '').toLowerCase().replace(/[,\s]+/g, ' ').trim();
  var dNorm = (lane.destination || lane.dest || '').toLowerCase().replace(/[,\s]+/g, ' ').trim();
  return lanePreferences.find(function(lp) {
    if (lp.status !== 'Active') return false;
    var lpO = (lp.origin || '').toLowerCase().replace(/[,\s]+/g, ' ').trim();
    var lpD = (lp.dest || '').toLowerCase().replace(/[,\s]+/g, ' ').trim();
    // Both origin AND destination must match (by city name)
    var oCity = oNorm.split(' ')[0];
    var dCity = dNorm.split(' ')[0];
    var lpOCity = lpO.split(' ')[0];
    var lpDCity = lpD.split(' ')[0];
    var originMatch = oCity === lpOCity || oNorm.indexOf(lpO) >= 0 || lpO.indexOf(oNorm) >= 0;
    var destMatch = dCity === lpDCity || dNorm.indexOf(lpD) >= 0 || lpD.indexOf(dNorm) >= 0;
    return originMatch && destMatch;
  }) || null;
}

// Check if carrier is feasible
function _bpIsFeasible(q) {
  if (!q.carrier) return false;
  // Use backend infeasible flag if available (set by /api/bulk-plan/rate)
  if (q.infeasible) return false;
  // Fallback: check carriers table
  var carrierUp = (q.carrier || '').toUpperCase();
  var carrierRec = (typeof carriers !== 'undefined' ? carriers : []).find(function(c) {
    if (!c.name) return false;
    var cUp = c.name.toUpperCase();
    return carrierUp === cUp || carrierUp.indexOf(cUp) >= 0 || cUp.indexOf(carrierUp) >= 0;
  });
  var ccxlEnabled = carrierRec && (carrierRec.carrierconnect_enabled || carrierRec.carrierconnectEnabled);
  if (ccxlEnabled && !q.transitDays) return false;
  return true;
}

// Check if a quote will deliver late for a lane
function _bpIsLate(q, lane) {
  var earliestDue = null;
  var earliestReady = null;
  (lane.orders || []).forEach(function(o) {
    var d = o.due || o.dueDate || '';
    var r = o.ready || o.readyDate || '';
    if (d && (!earliestDue || d < earliestDue)) earliestDue = d;
    if (r && (!earliestReady || r < earliestReady)) earliestReady = r;
  });
  if (!earliestDue) return false;
  var today = _bpFmtDate(new Date());
  var transit = q.transitDays || null;
  if (!transit) return false; // can't determine, assume ok

  // Pickup = max(today, readyDate)
  var pickup = today;
  if (earliestReady && earliestReady > pickup) pickup = earliestReady;

  // Delivery = pickup + transit business days
  var deliveryDate = _bpFmtDate(_bpAddBusinessDays(_bpParseDate(pickup), transit));
  return deliveryDate > earliestDue;
}

// Add business days forward
function _bpAddBusinessDays(fromDate, days) {
  var d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  var remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (_bpIsBusinessDay(d)) remaining--;
  }
  return d;
}

// Assign carrier respecting lane prefs + order constraints + feasibility + lateness
function _bpAssignWithPrefs(laneKey, quotes) {
  if (!quotes || !quotes.length) return null;
  var lane = _bpLanes.find(function(l) { return l.laneKey === laneKey; });
  if (!lane) return null;

  // 1. Get lane preference
  var pref = _bpFindLanePref(lane);
  var preferred = pref ? (pref.preferred || []) : [];
  var excluded = pref ? (pref.excluded || []) : [];
  var prefMode = pref ? (pref.mode || '') : '';

  // 2. Get order-level preferred/excluded carriers
  (lane.orders || []).forEach(function(o) {
    if (o.preferredCarrier && preferred.indexOf(o.preferredCarrier) < 0) preferred.push(o.preferredCarrier);
    if (o.excludedCarrier && excluded.indexOf(o.excludedCarrier) < 0) excluded.push(o.excludedCarrier);
  });

  // 3. Filter out excluded carriers
  var filtered = quotes;
  if (excluded.length) {
    filtered = quotes.filter(function(q) {
      var name = (q.carrier || '').toLowerCase();
      var scac = (q.scac || '').toLowerCase();
      return !excluded.some(function(ex) {
        var exL = ex.toLowerCase();
        return name.indexOf(exL) >= 0 || scac.indexOf(exL) >= 0 || exL.indexOf(name) >= 0 || exL.indexOf(scac) >= 0;
      });
    });
  }
  if (!filtered.length) filtered = quotes; // fallback if all excluded

  // 4. Filter out infeasible carriers (CCXL enabled but no transit)
  var feasible = filtered.filter(function(q) { return _bpIsFeasible(q); });
  if (!feasible.length) feasible = filtered; // fallback if all infeasible

  // 5. Tag late/on-time
  feasible.forEach(function(q) {
    q._isLate = _bpIsLate(q, lane);
  });

  // 6. Weight constraint: if lane weight > LTL max (15000), skip LTL mode preference
  var laneWt = lane.totalWeight || 0;
  var effectivePrefMode = (prefMode === 'LTL' && laneWt > 15000) ? '' : prefMode;

  // 7. Sort: preferred+on-time > on-time > preferred+late > late, within each: cheapest
  feasible.sort(function(a, b) {
    var aIsPref = preferred.length && preferred.some(function(p) {
      return (a.carrier || '').toLowerCase().indexOf(p.toLowerCase()) >= 0;
    });
    var bIsPref = preferred.length && preferred.some(function(p) {
      return (b.carrier || '').toLowerCase().indexOf(p.toLowerCase()) >= 0;
    });
    // Mode match
    var aMode = effectivePrefMode ? (effectivePrefMode === (a.mode || 'LTL') ? 1 : 0) : 1;
    var bMode = effectivePrefMode ? (effectivePrefMode === (b.mode || 'LTL') ? 1 : 0) : 1;

    // Tier: on-time preferred+mode > on-time preferred > on-time > late preferred > late
    var aScore = (a._isLate ? 0 : 100) + (aIsPref ? 50 : 0) + (aMode ? 10 : 0);
    var bScore = (b._isLate ? 0 : 100) + (bIsPref ? 50 : 0) + (bMode ? 10 : 0);
    if (aScore !== bScore) return bScore - aScore;

    // Within same tier: if both late, sort by fastest transit
    if (a._isLate && b._isLate) return (a.transitDays || 99) - (b.transitDays || 99);

    // Otherwise sort by cost
    return (a.totalCharge || 99999) - (b.totalCharge || 99999);
  });

  console.log('[BulkPlan/assign] ' + laneKey + ' → ' + feasible.map(function(q) { return q.carrier + ' ' + (q.mode||'?') + ' $' + (q.totalCharge||0) + ' ' + (q.transitDays||'?') + 'd' + (q._isLate?' LATE':'') + (q.infeasible?' INFEASIBLE':''); }).join(' | '));
  console.log('[BulkPlan/assign] PICKED: ' + (feasible[0]||{}).carrier + ' ' + (feasible[0]||{}).mode + ' $' + (feasible[0]||{}).totalCharge);
  return feasible[0];
}

function bpAutoAssign(by) {
  _bpLanes.forEach(function(lane) {
    var r = _bpRates[lane.laneKey];
    if (!r || !r.quotes || !r.quotes.length) return;
    _bpAssign[lane.laneKey] = _bpAssignWithPrefs(lane.laneKey, r.quotes);
  });
  toast('Carriers auto-assigned by ' + (by === 'transit' ? 'fastest transit' : 'lowest cost') + ' (preferences + feasibility enforced)', 'success');
  renderBulkPlan();
}

// ══════════════════════════════════════════════════════════════════
// TAB 4: PLAN SUMMARY
// ══════════════════════════════════════════════════════════════════
function renderBPSummary(el) {
  var totalCost = 0;
  var totalOrders = 0;
  var allAssigned = true;

  _bpLanes.forEach(function(l) {
    var a = _bpAssign[l.laneKey];
    if (a) totalCost += (a.totalCharge || 0);
    else allAssigned = false;
    totalOrders += l.orders.length;
  });

  el.innerHTML = `
    <div style="padding:16px 20px">
      <!-- Summary stats -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px">
        <div class="stat-card blue">
          <div class="stat-label">Shipments</div>
          <div class="stat-value">${_bpLanes.length}</div>
        </div>
        <div class="stat-card green">
          <div class="stat-label">Orders Planned</div>
          <div class="stat-value">${totalOrders}</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">Est. Total Cost</div>
          <div class="stat-value">$${totalCost.toLocaleString()}</div>
        </div>
        <div class="stat-card teal">
          <div class="stat-label">Avg Cost/Shipment</div>
          <div class="stat-value">$${_bpLanes.length ? Math.round(totalCost / _bpLanes.length).toLocaleString() : 0}</div>
        </div>
      </div>

      <!-- Plan table -->
      <table>
        <thead><tr>
          <th>#</th><th>Origin</th><th>Destination</th><th>Carrier</th>
          <th>Mode</th><th>Weight</th><th>Orders</th><th>Cost</th>
          <th>Pickup</th><th>Delivery</th><th>Transit</th>
        </tr></thead>
        <tbody>
          ${_bpLanes.map(function(lane, idx) {
            var a = _bpAssign[lane.laneKey] || {};
            var mode = _bpLoadType(lane.totalWeight) === 'LTL' ? 'LTL' : 'TL';
            var today = new Date().toISOString().slice(0, 10);
            var transit = a.transitDays || null;

            // Find earliest due date from orders in this lane
            var earliestDue = null;
            lane.orders.forEach(function(o) {
              var d = o.due || o.dueDate || '';
              if (d && (!earliestDue || d < earliestDue)) earliestDue = d;
            });

            // Calculate dates: delivery = due date, pickup = due date - transit business days
            var deliveryDate = earliestDue || '';
            var pickupDate = today;
            if (earliestDue && transit) {
              var dd = _bpSubtractBusinessDays(_bpParseDate(earliestDue), transit);
              var todayDate = _bpParseDate(today);
              if (dd >= todayDate) {
                pickupDate = _bpFmtDate(dd);
              }
            } else if (earliestDue) {
              // No transit info, default pickup = due date - 3 business days
              var dd2 = _bpSubtractBusinessDays(_bpParseDate(earliestDue), 3);
              var todayDate2 = _bpParseDate(today);
              if (dd2 >= todayDate2) pickupDate = _bpFmtDate(dd2);
            }

            return '<tr>' +
              '<td class="mono">' + (idx + 1) + '</td>' +
              '<td style="font-size:12px">' + lane.origin + '</td>' +
              '<td style="font-size:12px">' + lane.destination + '</td>' +
              '<td style="font-weight:500">' + (a.carrier || '<span class="badge badge-red" style="font-size:9px">Not assigned</span>') + '</td>' +
              '<td><span class="badge ' + (mode === 'LTL' ? 'badge-blue' : 'badge-green') + '">' + mode + '</span></td>' +
              '<td class="mono">' + lane.totalWeight.toLocaleString() + ' lbs</td>' +
              '<td class="mono">' + lane.orders.length + '</td>' +
              '<td class="mono" style="font-weight:600;color:var(--accent)">$' + (a.totalCharge || 0).toLocaleString() + '</td>' +
              '<td><input type="date" id="bp-pickup-' + idx + '" value="' + pickupDate + '" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit"></td>' +
              '<td><input type="date" id="bp-delivery-' + idx + '" value="' + deliveryDate + '" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:inherit"></td>' +
              '<td class="mono">' + (transit || '—') + 'd</td>' +
            '</tr>';
          }).join('')}
        </tbody>
      </table>

      <div style="margin-top:18px;display:flex;justify-content:flex-end;gap:10px">
        <button class="btn btn-secondary" onclick="switchBPTab('rates')">← Back to Rates</button>
        ${allAssigned
          ? '<button class="btn" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-weight:600" onclick="bpExecute()">' + (_bpExecuting ? '⏳ Creating…' : '⚡ Execute Plan — Create ' + _bpLanes.length + ' Shipments') + '</button>'
          : '<button class="btn btn-secondary" disabled>Assign all carriers first</button>'}
      </div>
    </div>
  `;
}

// ── Execute Plan ───────────────────────────────────────────────────
async function bpExecute() {
  if (!confirm('Create ' + _bpLanes.length + ' shipment' + (_bpLanes.length > 1 ? 's' : '') + ' and plan ' + Object.keys(_bpSelected).length + ' orders?')) return;

  _bpExecuting = true;
  renderBulkPlan();

  try {
    var plans = _bpLanes.map(function(lane, idx) {
      var a = _bpAssign[lane.laneKey] || {};
      var pickupEl = document.getElementById('bp-pickup-' + idx);
      var pickupDate = pickupEl ? pickupEl.value : new Date().toISOString().slice(0, 10);
      var deliveryEl = document.getElementById('bp-delivery-' + idx);
      var deliveryDate = deliveryEl ? deliveryEl.value : '';

      var resolvedMode = a.mode || (_bpLoadType(lane.totalWeight) === 'LTL' ? 'LTL' : 'TL');
      var isCzarlite = resolvedMode === 'LTL' || (resolvedMode || '').toUpperCase() === 'LTL';
      console.log('[BulkPlan/execute] Lane:', lane.laneKey, 'Carrier:', a.carrier, 'a.mode:', a.mode, 'resolved:', resolvedMode, 'czarlite:', isCzarlite);
      return {
        laneKey: lane.laneKey,
        origin: lane.origin,
        destination: lane.destination,
        carrier: a.carrier || '',
        scac: a.scac || '',
        mode: resolvedMode,
        totalWeight: lane.totalWeight,
        totalPieces: lane.totalPieces,
        totalCost: a.totalCharge || 0,
        orderIds: lane.orders.map(function(o) { return o.id; }),
        pickupDate: pickupDate,
        deliveryDate: deliveryDate,
        transitDays: a.transitDays || null,
        czarliteRate: isCzarlite,
      };
    });

    var data = await _bpApi('POST', '/bulk-plan/execute', { plans: plans });

    if (data.error) throw new Error(data.error);

    // Record change history for each order
    var createdShipments = data.shipments || [];
    plans.forEach(function(plan, idx) {
      var shipment = createdShipments[idx];
      var shipId = shipment ? (shipment.id || '') : '';
      (plan.orderIds || []).forEach(function(orderId) {
        // Update in-memory order data
        var ord = (typeof orders !== 'undefined' ? orders : []).find(function(o) { return o.id === orderId; });
        if (ord) {
          ord.status = 'Planned';
          ord.shipmentId = shipId;
          ord.shipment_id = shipId;
        }
        // Record in orderChangeLog for History tab
        if (typeof orderChangeLog !== 'undefined') {
          if (!orderChangeLog[orderId]) orderChangeLog[orderId] = [];
          orderChangeLog[orderId].unshift({
            ts: new Date().toLocaleString(),
            user: 'System (Bulk Plan)',
            type: 'plan',
            changes: [
              { label: 'Status', old: 'Unplanned', new: 'Planned' },
              { label: 'Shipment', old: '—', new: shipId },
              { label: 'Carrier', old: '—', new: plan.carrier || '—' },
              { label: 'Cost', old: '—', new: '$' + (plan.totalCost || 0).toLocaleString() },
            ]
          });
        }
      });
    });

    // Add created shipments to in-memory shipments array
    createdShipments.forEach(function(s) {
      if (!s || !s.id) return;
      // Remove any existing with same ID
      if (typeof shipments !== 'undefined') {
        var existIdx = shipments.findIndex(function(x) { return x.id === s.id; });
        if (existIdx >= 0) shipments.splice(existIdx, 1);
        shipments.unshift({
          id: s.id, carrier: s.carrier, mode: s.mode, origin: s.origin, dest: s.dest,
          weight: s.weight, pieces: s.pieces, status: s.status || 'Planned',
          totalCost: s.total_cost || 0, pickupDate: s.pickup_date, deliveryDate: s.delivery_date,
          orderIds: s.order_ids || [], czarliteRate: s.czarlite_rate || false,
        });
      }
    });

    // Store results and switch to results tab
    _bpResults = {
      shipments: createdShipments,
      ordersUpdated: data.ordersUpdated || 0,
      totalCost: plans.reduce(function(s, p) { return s + (p.totalCost || 0); }, 0),
      totalWeight: plans.reduce(function(s, p) { return s + (p.totalWeight || 0); }, 0),
      plans: plans,
      executedAt: new Date().toLocaleString(),
    };
    _bpTab = 'results';

    // Refresh global data
    if (typeof refreshAll === 'function') await refreshAll();
    else if (typeof supaLoadAll === 'function') await supaLoadAll();

    renderBulkPlan();

  } catch (e) {
    toast('Execute error: ' + e.message, 'error');
  }

  _bpExecuting = false;
}

// ══════════════════════════════════════════════════════════════════
// BULK PLAN NOW — one-click: group → rate → assign → execute
// ══════════════════════════════════════════════════════════════════
async function bpPlanNow() {
  var allOrders = (typeof orders !== 'undefined' ? orders : []);
  var selected = allOrders.filter(function(o) { return _bpSelected[o.id]; });
  if (!selected.length) { toast('Select at least one order', 'warning'); return; }

  var unplannedCount = selected.filter(function(o) { return o.status === 'Unplanned'; }).length;
  if (!confirm('Bulk plan ' + unplannedCount + ' order' + (unplannedCount !== 1 ? 's' : '') + '?\n\nThis will:\n1. Group orders by lane\n2. Get CzarLite rates\n3. Auto-assign best carrier per lane\n4. Create shipments')) return;

  // Show progress
  _bpTab = 'results';
  _bpResults = null;
  var el = document.getElementById('bp-content');
  if (el) el.innerHTML = '<div style="text-align:center;padding:80px 20px"><div style="font-size:48px;margin-bottom:16px">⏳</div><div style="font-size:18px;font-weight:600;color:var(--text)">Bulk Planning in Progress…</div><div style="font-size:13px;color:var(--text3);margin-top:8px">Grouping lanes, fetching rates, assigning carriers…</div></div>';

  try {
    // Step 1: Group by lane
    bpGroupLanes();

    // Filter out lanes without ZIPs
    _bpLanes = _bpLanes.filter(function(l) { return l.originZip && l.destZip; });
    if (!_bpLanes.length) { toast('No lanes with valid ZIP codes', 'error'); _bpTab = 'select'; renderBulkPlan(); return; }

    // Step 2: Rate all lanes
    var rateBody = { lanes: _bpLanes.map(function(lane) {
      // Get miles from distance lookup
      var miles = (typeof getDist === 'function') ? getDist(lane.origin, lane.destination) : 500;
      return {
        laneKey: lane.laneKey,
        originZip: lane.originZip,
        destZip: lane.destZip,
        origin: lane.origin,
        destination: lane.destination,
        totalWeight: lane.totalWeight,
        freightClass: lane.freightClass || '70',
        orderIds: lane.orders.map(function(o) { return o.id; }),
        miles: miles,
      };
    }), optimizeBy: 'cost' };

    var rateData = await _bpApi('POST', '/bulk-plan/rate', rateBody);
    if (rateData.error) throw new Error(rateData.error);

    // Store rates
    (rateData.results || []).forEach(function(r) {
      _bpRates[r.laneKey] = { quotes: r.quotes || [], loadType: r.loadType };
    });

    // Step 3: Auto-assign best carrier per lane (using all rules)
    _bpLanes.forEach(function(lane) {
      var r = _bpRates[lane.laneKey];
      if (!r || !r.quotes || !r.quotes.length) return;
      _bpAssign[lane.laneKey] = _bpAssignWithPrefs(lane.laneKey, r.quotes);
    });

    // Step 4: Calculate dates and build execution plans
    var today = _bpFmtDate(new Date());
    var plans = _bpLanes.map(function(lane) {
      var a = _bpAssign[lane.laneKey] || {};
      var transit = a.transitDays || null;

      // Find earliest due and ready dates
      var earliestDue = null;
      var earliestReady = null;
      (lane.orders || []).forEach(function(o) {
        var d = o.due || o.dueDate || '';
        var r = o.ready || o.readyDate || '';
        if (d && (!earliestDue || d < earliestDue)) earliestDue = d;
        if (r && (!earliestReady || r < earliestReady)) earliestReady = r;
      });

      // Pickup: max(today, readyDate), then check if transit allows on-time delivery
      var pickupDate = today;
      if (earliestReady && earliestReady > pickupDate) pickupDate = earliestReady;
      if (earliestDue && transit) {
        var idealPickup = _bpFmtDate(_bpSubtractBusinessDays(_bpParseDate(earliestDue), transit));
        if (idealPickup > pickupDate) pickupDate = idealPickup;
      }

      // Delivery: pickup + transit business days
      var deliveryDate = '';
      if (transit) {
        deliveryDate = _bpFmtDate(_bpAddBusinessDays(_bpParseDate(pickupDate), transit));
      } else if (earliestDue) {
        deliveryDate = earliestDue;
      }

      return {
        laneKey: lane.laneKey,
        origin: lane.origin,
        destination: lane.destination,
        carrier: a.carrier || '',
        scac: a.scac || '',
        mode: a.mode || (_bpLoadType(lane.totalWeight) === 'LTL' ? 'LTL' : 'TL'),
        totalWeight: lane.totalWeight,
        totalPieces: lane.totalPieces,
        totalCost: a.totalCharge || 0,
        orderIds: lane.orders.map(function(o) { return o.id; }),
        pickupDate: pickupDate,
        deliveryDate: deliveryDate,
        transitDays: transit,
      };
    });

    // Filter out plans with no carrier assigned
    var validPlans = plans.filter(function(p) { return p.carrier; });
    var skippedPlans = plans.filter(function(p) { return !p.carrier; });

    if (!validPlans.length) { toast('No carriers could be assigned — check rates and preferences', 'error'); _bpTab = 'select'; renderBulkPlan(); return; }

    // Step 5: Execute
    var data = await _bpApi('POST', '/bulk-plan/execute', { plans: validPlans });
    if (data.error) throw new Error(data.error);

    // Update in-memory orders + history
    var createdShipments = data.shipments || [];
    validPlans.forEach(function(plan, idx) {
      var shipment = createdShipments[idx];
      var shipId = shipment ? (shipment.id || '') : '';
      (plan.orderIds || []).forEach(function(orderId) {
        var ord = allOrders.find(function(o) { return o.id === orderId; });
        if (ord) { ord.status = 'Planned'; ord.shipmentId = shipId; ord.shipment_id = shipId; }
        if (typeof orderChangeLog !== 'undefined') {
          if (!orderChangeLog[orderId]) orderChangeLog[orderId] = [];
          orderChangeLog[orderId].unshift({
            ts: new Date().toLocaleString(), user: 'System (Bulk Plan)', type: 'plan',
            changes: [
              { label: 'Status', old: 'Unplanned', new: 'Planned' },
              { label: 'Shipment', old: '—', new: shipId },
              { label: 'Carrier', old: '—', new: plan.carrier || '—' },
              { label: 'Cost', old: '—', new: '$' + (plan.totalCost || 0).toLocaleString() },
            ]
          });
        }
      });
    });

    // Show results
    _bpResults = {
      shipments: createdShipments,
      ordersUpdated: data.ordersUpdated || 0,
      totalCost: validPlans.reduce(function(s, p) { return s + (p.totalCost || 0); }, 0),
      totalWeight: validPlans.reduce(function(s, p) { return s + (p.totalWeight || 0); }, 0),
      plans: validPlans,
      skipped: skippedPlans,
      executedAt: new Date().toLocaleString(),
    };
    _bpTab = 'results';

    if (typeof refreshAll === 'function') await refreshAll();
    else if (typeof supaLoadAll === 'function') await supaLoadAll();

    _bpSelected = {};
    toast('Bulk plan complete — ' + createdShipments.length + ' shipments created', 'success');

  } catch (e) {
    toast('Bulk plan error: ' + e.message, 'error');
    _bpTab = 'select';
  }

  renderBulkPlan();
}

// ══════════════════════════════════════════════════════════════════
// TAB 5: EXECUTION RESULTS
// ══════════════════════════════════════════════════════════════════
function renderBPResults(el) {
  if (!_bpResults) { switchBPTab('select'); return; }

  var r = _bpResults;
  var shipments = r.shipments || [];
  var succeeded = shipments.filter(function(s) { return s && s.id; });
  var failed = shipments.filter(function(s) { return s && s.error; });
  var uniqueCarriers = {};
  r.plans.forEach(function(p) { if (p.carrier) uniqueCarriers[p.carrier] = true; });

  el.innerHTML = `
    <div style="padding:20px 24px;max-width:960px;margin:0 auto">

      <!-- Success banner -->
      <div style="text-align:center;padding:28px 20px;background:linear-gradient(135deg,#ecfdf5,#d1fae5);border-radius:14px;border:1.5px solid #6ee7b7;margin-bottom:24px">
        <div style="font-size:42px;margin-bottom:8px">${failed.length === 0 ? '✅' : '⚠️'}</div>
        <div style="font-size:20px;font-weight:700;color:#065f46;margin-bottom:4px">
          ${failed.length === 0 ? 'Bulk Plan Executed Successfully' : 'Plan Executed with ' + failed.length + ' Error' + (failed.length > 1 ? 's' : '')}
        </div>
        <div style="font-size:13px;color:#047857">${r.executedAt}</div>
      </div>

      <!-- Summary stats -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
        <div class="stat-card green">
          <div class="stat-label">Shipments Created</div>
          <div class="stat-value">${succeeded.length}</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-label">Orders Planned</div>
          <div class="stat-value">${r.ordersUpdated}</div>
        </div>
        <div class="stat-card amber">
          <div class="stat-label">Total Est. Cost</div>
          <div class="stat-value">$${r.totalCost.toLocaleString()}</div>
        </div>
        <div class="stat-card teal">
          <div class="stat-label">Carriers Used</div>
          <div class="stat-value">${Object.keys(uniqueCarriers).length}</div>
        </div>
      </div>

      ${failed.length > 0 ? '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;margin-bottom:18px;font-size:13px;color:#991b1b"><b>⚠ Failed:</b> ' + failed.map(function(f) { return f.error || 'Unknown error'; }).join(', ') + '</div>' : ''}

      <!-- Shipment list -->
      <div style="font-size:14px;font-weight:600;margin-bottom:10px">Created Shipments</div>
      <table>
        <thead><tr>
          <th>#</th><th>Shipment ID</th><th>Origin</th><th>Destination</th>
          <th>Carrier</th><th>Mode</th><th>Weight</th><th>Orders</th><th>Cost</th><th></th>
        </tr></thead>
        <tbody>
          ${succeeded.map(function(s, idx) {
            var plan = r.plans[idx] || {};
            var mode = plan.mode || 'LTL';
            var shipId = s.id || '';
            var shortId = shipId.length > 12 ? shipId.substring(0, 12) + '…' : shipId;
            return '<tr>' +
              '<td class="mono">' + (idx + 1) + '</td>' +
              '<td><a href="#" onclick="bpOpenShipment(\'' + shipId + '\');return false" style="color:var(--accent);font-weight:600;font-family:\'JetBrains Mono\',monospace;font-size:12px">' + shortId + '</a></td>' +
              '<td style="font-size:12px">' + (plan.origin || '') + '</td>' +
              '<td style="font-size:12px">' + (plan.destination || '') + '</td>' +
              '<td style="font-weight:500">' + (plan.carrier || '—') + '</td>' +
              '<td><span class="badge ' + (mode === 'LTL' ? 'badge-blue' : 'badge-green') + '">' + mode + '</span></td>' +
              '<td class="mono">' + (plan.totalWeight || 0).toLocaleString() + ' lbs</td>' +
              '<td class="mono">' + (plan.orderIds ? plan.orderIds.length : 0) + '</td>' +
              '<td class="mono" style="font-weight:600;color:var(--accent)">$' + (plan.totalCost || 0).toLocaleString() + '</td>' +
              '<td><a href="#" onclick="bpOpenShipment(\'' + shipId + '\');return false" class="btn btn-sm" style="font-size:11px">Open →</a></td>' +
            '</tr>';
          }).join('')}
        </tbody>
        <tfoot><tr style="font-weight:700;background:var(--bg2)">
          <td colspan="6">Totals</td>
          <td class="mono">${r.totalWeight.toLocaleString()} lbs</td>
          <td class="mono">${r.ordersUpdated}</td>
          <td class="mono" style="color:var(--accent)">$${r.totalCost.toLocaleString()}</td>
          <td></td>
        </tr></tfoot>
      </table>

      <!-- Action buttons -->
      <div style="margin-top:24px;display:flex;justify-content:center;gap:12px">
        <button class="btn" style="background:var(--accent);color:#fff" onclick="navigate('shipments')">
          📦 View All Shipments
        </button>
        <button class="btn btn-secondary" onclick="bpNewPlan()">
          ⚡ Start New Bulk Plan
        </button>
      </div>
    </div>
  `;
}

function bpOpenShipment(id) {
  navigate('shipments');
  setTimeout(function() {
    if (typeof viewShipment === 'function') viewShipment(id);
  }, 300);
}

function bpNewPlan() {
  _bpSelected = {};
  _bpLanes = [];
  _bpRates = {};
  _bpAssign = {};
  _bpResults = null;
  _bpTab = 'select';
  renderBulkPlan();
}

// ══════════════════════════════════════════════════════════════════
// CSV / EXCEL IMPORT
// ══════════════════════════════════════════════════════════════════
function bpImportModal() {
  var modal = document.getElementById('bp-import-modal');
  if (modal) modal.classList.add('open');
}
function bpImportClose() {
  var modal = document.getElementById('bp-import-modal');
  if (modal) modal.classList.remove('open');
  _bpImported = [];
}

function bpHandleFile(file) {
  if (!file) return;
  var ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'xlsx' && ext !== 'csv' && ext !== 'xls') {
    toast('Please upload .xlsx, .xls, or .csv file', 'error');
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var wb = XLSX.read(e.target.result, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      _bpImported = rows.map(function(r, i) {
        return {
          _row: i + 2,
          customer:    r['Customer'] || r['customer'] || r['CUSTOMER'] || '',
          origin:      r['Origin'] || r['origin'] || r['ORIGIN'] || r['Ship From'] || '',
          destination: r['Destination'] || r['destination'] || r['DESTINATION'] || r['Ship To'] || r['Dest'] || '',
          weight:      parseFloat(r['Weight'] || r['weight'] || r['WEIGHT'] || 0),
          pieces:      parseInt(r['Pieces'] || r['pieces'] || r['PIECES'] || r['Qty'] || 0),
          commodity:   r['Commodity'] || r['commodity'] || r['COMMODITY'] || r['Description'] || 'General',
          readyDate:   r['Ready Date'] || r['ready_date'] || r['ReadyDate'] || '',
          dueDate:     r['Due Date'] || r['due_date'] || r['DueDate'] || '',
        };
      });

      // Validate
      _bpImported.forEach(function(o) {
        o._errors = [];
        if (!o.customer) o._errors.push('Customer required');
        if (!o.origin) o._errors.push('Origin required');
        if (!o.destination) o._errors.push('Destination required');
        if (!o.weight || o.weight <= 0) o._errors.push('Weight must be > 0');
      });

      bpRenderImportPreview();
      toast(rows.length + ' rows parsed', 'success');
    } catch (err) {
      toast('Parse error: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function bpRenderImportPreview() {
  var el = document.getElementById('bp-import-preview');
  if (!el) return;

  var errors = _bpImported.filter(function(o) { return o._errors.length; });
  var valid = _bpImported.filter(function(o) { return !o._errors.length; });

  el.innerHTML = `
    <div style="margin-bottom:10px;font-size:13px">
      <span style="color:var(--accent);font-weight:600">${_bpImported.length} rows</span> parsed ·
      <span style="color:#059669">${valid.length} valid</span> ·
      <span style="color:#dc2626">${errors.length} errors</span>
    </div>
    <div style="max-height:300px;overflow-y:auto">
      <table>
        <thead><tr>
          <th>Row</th><th>Customer</th><th>Origin</th><th>Destination</th>
          <th>Weight</th><th>Pieces</th><th>Commodity</th><th>Due Date</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${_bpImported.map(function(o) {
            var hasErr = o._errors.length > 0;
            return '<tr style="' + (hasErr ? 'background:rgba(220,38,38,.05)' : '') + '">' +
              '<td class="mono">' + o._row + '</td>' +
              '<td>' + (o.customer || '—') + '</td>' +
              '<td style="font-size:12px">' + (o.origin || '—') + '</td>' +
              '<td style="font-size:12px">' + (_bpDest(o) || '—') + '</td>' +
              '<td class="mono">' + (o.weight || 0).toLocaleString() + '</td>' +
              '<td class="mono">' + (o.pieces || 0) + '</td>' +
              '<td style="font-size:12px">' + (o.commodity || '—') + '</td>' +
              '<td style="font-size:12px">' + (o.dueDate || '—') + '</td>' +
              '<td>' + (hasErr ? '<span class="badge badge-red" style="font-size:9px">' + o._errors.join(', ') + '</span>' : '<span class="badge badge-green" style="font-size:9px">OK</span>') + '</td>' +
            '</tr>';
          }).join('')}
        </tbody>
      </table>
    </div>
    ${valid.length > 0 ? '<div style="margin-top:12px;text-align:right"><button class="btn" style="background:var(--accent);color:#fff" onclick="bpImportSubmit()">📥 Import ' + valid.length + ' Orders</button></div>' : ''}
  `;
}

async function bpImportSubmit() {
  var valid = _bpImported.filter(function(o) { return !o._errors.length; });
  if (!valid.length) { toast('No valid orders to import', 'warning'); return; }

  try {
    var payload = valid.map(function(o) {
      return {
        customer: o.customer,
        origin: o.origin,
        destination: o.destination,
        weight: o.weight,
        pieces: o.pieces,
        commodity: o.commodity,
        readyDate: o.readyDate,
        dueDate: o.dueDate,
      };
    });

    var data = await _bpApi('POST', '/bulk-plan/import', { orders: payload });

    if (data.error) throw new Error(data.error);

    toast('✅ ' + (data.created || 0) + ' orders imported!', 'success');
    bpImportClose();

    // Refresh
    if (typeof refreshAll === 'function') await refreshAll();
    else if (typeof supaLoadAll === 'function') await supaLoadAll();

    renderBulkPlan();

  } catch (e) {
    toast('Import error: ' + e.message, 'error');
  }
}

function bpDownloadTemplate() {
  var headers = ['Customer', 'Origin', 'Destination', 'Weight', 'Pieces', 'Commodity', 'Ready Date', 'Due Date'];
  var sample  = ['Acme Corp', 'Houston, TX', 'Dallas, TX', 5000, 8, 'Electronics', '2026-04-01', '2026-04-05'];
  var ws = XLSX.utils.aoa_to_sheet([headers, sample]);
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Orders');
  XLSX.writeFile(wb, 'zoree-order-import-template.xlsx');
  toast('Template downloaded', 'success');
}
