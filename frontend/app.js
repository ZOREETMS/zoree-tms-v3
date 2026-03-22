// ═══════════════════════════════════════════════════════════════════
// ZoreeTMS v3 — App Controller
// Direct Supabase connection — works without the API server running
// ═══════════════════════════════════════════════════════════════════

var SUPABASE_URL = 'https://ljbeihotrmyqthxptcgp.supabase.co';
var ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE';

var _orders    = [];
var _shipments = [];
var _carriers  = [];

function getAuthHeaders() {
  var token = sessionStorage.getItem('zoree_token') || ANON_KEY;
  return { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer ' + token };
}

async function sbGet(table, query) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + (query || 'select=*&order=created_at.desc&limit=500'), { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbUpsert(table, data) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=id', {
    method: 'POST',
    headers: Object.assign({}, getAuthHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  var r = await res.json(); return Array.isArray(r) ? r[0] : r;
}

async function sbUpdate(table, id, data) {
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: Object.assign({}, getAuthHeaders(), { 'Prefer': 'return=representation' }),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  var r = await res.json(); return Array.isArray(r) ? r[0] : r;
}

async function sbDelete(table, id) {
  await fetch(SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: getAuthHeaders() });
  return { deleted: true, id: id };
}

function dbToOrder(r) {
  return { id: r.id, customer: r.customer, origin: r.origin, destination: r.dest, weight: r.weight || 0, pieces: r.pieces || 0, commodity: r.commodity || 'General', incoterms: r.incoterms || null, readyDate: r.ready || null, dueDate: r.due || null, status: r.status || 'Unplanned', shipmentId: r.shipment_id || null, hazmat: r.hazmat || false, notes: r.notes || null, createdAt: r.created_at };
}

function dbToShipment(r) {
  return { id: r.id, carrier: r.carrier || '', mode: r.mode || 'TL', origin: r.origin, destination: r.dest, weight: r.weight || 0, pieces: r.pieces || 0, status: r.status || 'Planned', pickupDate: r.pickup_date || null, deliveryDate: r.delivery_date || null, cost: r.total_cost || 0, bolNumber: r.bol_number || null, proNumber: r.pro_number || null, consolidatedOrders: r.order_ids || [], createdAt: r.created_at };
}

function dbToCarrier(r) {
  return { id: r.id, name: r.name, scac: r.scac || '', mode: r.mode || 'TL', status: r.status || 'Active', otd: r.on_time_pct || 0, rating: r.rating || 4.0, preferred: r.preferred || false };
}

function groupByLane(orders) {
  var lanes = {};
  orders.forEach(function(o) {
    var key = (o.origin || '') + '|' + (o.destination || '');
    if (!lanes[key]) lanes[key] = { origin: o.origin, destination: o.destination, orders: [], totalWeight: 0, totalPieces: 0 };
    lanes[key].orders.push(o);
    lanes[key].totalWeight += (o.weight || 0);
    lanes[key].totalPieces += (o.pieces || 0);
  });
  Object.values(lanes).forEach(function(l) {
    l.loadType = l.totalWeight >= 35000 ? 'Full TL' : l.totalWeight >= 10000 ? 'Partial TL' : 'LTL';
  });
  return Object.values(lanes);
}

function statusBadge(status) {
  var map = { 'Unplanned': 'badge-amber', 'Planned': 'badge-teal', 'Consolidated': 'badge-blue', 'In Transit': 'badge-blue', 'Delivered': 'badge-green', 'Tendered': 'badge-purple', 'Exception': 'badge-red', 'Cancelled': 'badge-red', 'Shipped': 'badge-green' };
  return '<span class="badge ' + (map[status] || 'badge-blue') + '">' + (status || '—') + '</span>';
}

function toast(msg, type, duration) {
  var wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  var el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function() { el.remove(); }, duration || 3500);
}

function navigate(page) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  var pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  var navEl = document.querySelector('.nav-item[data-page="' + page + '"]');
  if (navEl) navEl.classList.add('active');
  var renders = { dashboard: renderDashboard, orders: renderOrders, shipments: renderShipments, carriers: renderCarriers, settings: renderSettings };
  if (renders[page]) renders[page]();
}

function showLoginScreen(msg) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  if (msg) { var err = document.getElementById('login-error'); if (err) { err.textContent = msg; err.classList.remove('hidden'); } }
}

function hideLoginScreen() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

function updateUserUI() {
  var user = JSON.parse(sessionStorage.getItem('zoree_user') || '{}');
  var name = user.name || 'Sridhar R.';
  var initials = name.split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
  var n = document.getElementById('user-name'); if (n) n.textContent = name;
  var r = document.getElementById('user-role'); if (r) r.textContent = (user.role || 'Admin') + ' · Zoree';
  var a = document.getElementById('user-avatar'); if (a) a.textContent = initials || 'SR';
}

async function handleLogin() {
  var email    = document.getElementById('login-email').value.trim();
  var password = document.getElementById('login-password').value;
  var btn      = document.getElementById('login-btn');
  var btnText  = document.getElementById('login-btn-text');
  var err      = document.getElementById('login-error');

  if (!email || !password) { err.textContent = 'Enter your email and password'; err.classList.remove('hidden'); return; }

  btn.disabled = true; btnText.textContent = 'Signing in…'; err.classList.add('hidden');

  try {
    var res  = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      body: JSON.stringify({ email: email, password: password }),
    });
    var data = await res.json();

    if (!res.ok || !data.access_token) {
      err.textContent = data.error_description || data.msg || 'Invalid email or password';
      err.classList.remove('hidden');
      btn.disabled = false; btnText.textContent = 'Sign In →';
      return;
    }

    var user = data.user;
    sessionStorage.setItem('zoree_token', data.access_token);
    sessionStorage.setItem('zoree_user', JSON.stringify({ id: user.id, email: user.email, name: (user.user_metadata && user.user_metadata.full_name) || 'Sridhar R.', role: 'admin', tenantId: 'zoree-default' }));
    sessionStorage.setItem('zoree_tenant', JSON.stringify({ id: 'zoree-default', brandName: 'ZoreeTMS', primaryColor: '#3b82f6', tier: 'enterprise', features: ['*'] }));

    updateUserUI();
    await refreshAll();
    hideLoginScreen();
    navigate('dashboard');
    toast('Welcome back, Sridhar! 👋', 'success');

  } catch (e) {
    err.textContent = 'Error: ' + e.message;
    err.classList.remove('hidden');
    btn.disabled = false; btnText.textContent = 'Sign In →';
  }
}

document.addEventListener('DOMContentLoaded', function() {
  var pw = document.getElementById('login-password');
  if (pw) pw.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleLogin(); });
});

async function loadOrders() {
  try {
    var rows = await sbGet('orders', 'select=*&order=created_at.desc&limit=500');
    _orders  = (Array.isArray(rows) ? rows : []).map(dbToOrder);
    var badge = document.getElementById('badge-orders');
    if (badge) badge.textContent = _orders.filter(function(o) { return o.status === 'Unplanned'; }).length;
  } catch (e) { console.warn('[Orders]', e); _orders = []; }
  return _orders;
}

async function loadShipments() {
  try {
    var rows   = await sbGet('shipments', 'select=*&order=created_at.desc&limit=500');
    _shipments = (Array.isArray(rows) ? rows : []).map(dbToShipment);
    var badge  = document.getElementById('badge-shipments');
    if (badge) badge.textContent = _shipments.length;
    var sub = document.getElementById('ship-sub');
    if (sub) sub.textContent = _shipments.filter(function(s){return s.status==='In Transit';}).length + ' in transit · ' + _shipments.filter(function(s){return s.status==='Planned';}).length + ' planned';
  } catch (e) { console.warn('[Shipments]', e); _shipments = []; }
  return _shipments;
}

async function loadCarriers() {
  try {
    var rows  = await sbGet('carriers', 'select=*&order=name&limit=200');
    _carriers = (Array.isArray(rows) ? rows : []).map(dbToCarrier);
  } catch (e) { console.warn('[Carriers]', e); _carriers = []; }
  return _carriers;
}

async function refreshAll() {
  await Promise.all([loadOrders(), loadShipments(), loadCarriers()]);
  var activePage = document.querySelector('.page.active');
  if (activePage) {
    var page = activePage.id.replace('page-', '');
    var renders = { dashboard: renderDashboard, orders: renderOrders, shipments: renderShipments, carriers: renderCarriers };
    if (renders[page]) renders[page]();
  }
}

async function checkApiStatus() {
  var dot = document.getElementById('api-status-dot');
  var label = document.getElementById('api-status-label');
  try {
    await fetch(SUPABASE_URL + '/rest/v1/?select=1', { headers: { 'apikey': ANON_KEY } });
    if (dot) dot.className = 'status-dot green';
    if (label) label.textContent = 'DB Connected';
  } catch(e) {
    if (dot) dot.className = 'status-dot red';
    if (label) label.textContent = 'DB Offline';
  }
}

(async function boot() {
  checkApiStatus();
  setInterval(checkApiStatus, 30000);
  var token = sessionStorage.getItem('zoree_token');
  if (!token) { showLoginScreen(); return; }
  updateUserUI();
  try {
    await refreshAll();
    hideLoginScreen();
    navigate('dashboard');
  } catch(e) {
    showLoginScreen('Session expired. Please sign in again.');
  }
})();
