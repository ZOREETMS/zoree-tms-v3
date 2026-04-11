// ═══════════════════════════════════════════════════════════════════
// User Management Page — Admin-only role assignment
// Roles: admin, planner, carrier, finance
// ═══════════════════════════════════════════════════════════════════

var _usersList = [];

const ROLE_BADGES = {
  admin:   { color: '#7c3aed', bg: 'rgba(124,58,237,.12)', label: 'Admin' },
  planner: { color: '#0d9488', bg: 'rgba(13,148,136,.12)', label: 'Planner' },
  carrier: { color: '#2563eb', bg: 'rgba(37,99,235,.12)',  label: 'Carrier' },
  finance: { color: '#d97706', bg: 'rgba(217,119,6,.12)',  label: 'Finance' },
};

const ROLE_DESCRIPTIONS = {
  admin:   'Full access to all features, settings, and user management',
  planner: 'Manage orders, shipments, bulk planning, and carriers (read-only rates)',
  carrier: 'View shipments, update shipment status, access carrier portal',
  finance: 'Access invoices, rates, freight audit, analytics, and reports',
};

function roleBadge(role) {
  var r = ROLE_BADGES[role] || ROLE_BADGES.planner;
  return '<span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;color:' + r.color + ';background:' + r.bg + '">' + r.label + '</span>';
}

async function loadUsers() {
  try {
    var token = sessionStorage.getItem('zoree_token');
    var res = await fetch((window.ZOREE_API_URL || 'http://localhost:3001/api') + '/users', {
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    if (res.status === 403) {
      _usersList = [];
      return { forbidden: true };
    }
    if (!res.ok) throw new Error('Failed to load users');
    var data = await res.json();
    _usersList = data.users || [];
    return { forbidden: false };
  } catch (e) {
    console.warn('[Users] Load failed:', e.message);
    _usersList = [];
    return { forbidden: false, error: e.message };
  }
}

async function renderUsers() {
  var el = document.getElementById('users-content');
  if (!el) return;

  el.innerHTML = '<div style="color:var(--text3);padding:20px">Loading users...</div>';

  var result = await loadUsers();
  var currentUser = JSON.parse(sessionStorage.getItem('zoree_user') || '{}');

  // Non-admin sees access denied
  if (result.forbidden || (currentUser.role && currentUser.role !== 'admin')) {
    el.innerHTML = '\
      <div style="text-align:center;padding:60px;color:var(--text3)">\
        <div style="font-size:48px;margin-bottom:16px">🔒</div>\
        <div style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--text);margin-bottom:8px">\
          Admin Access Required\
        </div>\
        <div style="font-size:13px;margin-bottom:20px">User management is only available to administrators.</div>\
        <button class="btn btn-primary" onclick="navigate(\'dashboard\')">Back to Dashboard</button>\
      </div>';
    return;
  }

  var roleStats = { admin: 0, planner: 0, carrier: 0, finance: 0 };
  _usersList.forEach(function(u) {
    if (roleStats[u.role] !== undefined) roleStats[u.role]++;
  });

  el.innerHTML = '\
    <!-- Role Overview Cards -->\
    <div class="kpi-row">\
      <div class="stat-card">\
        <div class="stat-label">Total Users</div>\
        <div class="stat-val">' + _usersList.length + '</div>\
      </div>\
      <div class="stat-card">\
        <div class="stat-label">Admins</div>\
        <div class="stat-val" style="color:#7c3aed">' + roleStats.admin + '</div>\
      </div>\
      <div class="stat-card">\
        <div class="stat-label">Planners</div>\
        <div class="stat-val" style="color:#0d9488">' + roleStats.planner + '</div>\
      </div>\
      <div class="stat-card">\
        <div class="stat-label">Finance</div>\
        <div class="stat-val" style="color:#d97706">' + roleStats.finance + '</div>\
      </div>\
    </div>\
    \
    <!-- Role Permission Matrix -->\
    <div class="section-title">Role Permission Matrix</div>\
    <div class="card" style="overflow:hidden;margin-bottom:24px">\
      <table>\
        <thead><tr>\
          <th>Feature</th>\
          <th style="text-align:center">Admin</th>\
          <th style="text-align:center">Planner</th>\
          <th style="text-align:center">Carrier</th>\
          <th style="text-align:center">Finance</th>\
        </tr></thead>\
        <tbody>\
          <tr><td style="font-weight:500">Dashboard</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--teal)">Limited</td><td style="text-align:center;color:var(--teal)">Limited</td></tr>\
          <tr><td style="font-weight:500">Orders</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--green)">Read/Write</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td></tr>\
          <tr><td style="font-weight:500">Shipments</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--green)">Read/Write</td><td style="text-align:center;color:var(--teal)">View + Status</td><td style="text-align:center;color:var(--amber)">View Only</td></tr>\
          <tr><td style="font-weight:500">Bulk Planning</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td></tr>\
          <tr><td style="font-weight:500">Carriers</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--amber)">View Only</td><td style="text-align:center;color:var(--amber)">View Only</td><td style="text-align:center;color:var(--amber)">View Only</td></tr>\
          <tr><td style="font-weight:500">Rates</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--amber)">View Only</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--amber)">View Only</td></tr>\
          <tr><td style="font-weight:500">Invoices & Audit</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--green)">Full</td></tr>\
          <tr><td style="font-weight:500">Analytics & Reports</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--green)">Full</td></tr>\
          <tr><td style="font-weight:500">User Management</td><td style="text-align:center;color:var(--green)">Full</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td><td style="text-align:center;color:var(--text3)">No Access</td></tr>\
        </tbody>\
      </table>\
    </div>\
    \
    <!-- User List -->\
    <div class="section-title">Assigned Users</div>\
    <div class="card" style="overflow:hidden">\
      <table>\
        <thead><tr>\
          <th>User</th><th>Email</th><th>Role</th><th>Assigned</th><th>Actions</th>\
        </tr></thead>\
        <tbody id="users-table-body">\
          ' + (_usersList.length === 0 ?
            '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text3)">No users configured yet. Add your first user below.</td></tr>' :
            _usersList.map(function(u) {
              var isSelf = u.user_id === currentUser.id;
              return '<tr>' +
                '<td style="font-weight:500">' + (u.name || 'Unknown') + (isSelf ? ' <span style="font-size:10px;color:var(--accent)">(you)</span>' : '') + '</td>' +
                '<td style="font-size:12px;color:var(--text2)">' + (u.email || u.user_id) + '</td>' +
                '<td>' + roleBadge(u.role) + '</td>' +
                '<td style="font-size:12px;color:var(--text3)">' + (u.updated_at ? new Date(u.updated_at).toLocaleDateString() : '—') + '</td>' +
                '<td><div style="display:flex;gap:4px">' +
                  '<select onchange="changeUserRole(\'' + u.user_id + '\',\'' + (u.email || '') + '\',\'' + (u.name || '') + '\',this.value)" ' +
                    'style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);font-size:12px;background:var(--bg2);color:var(--text)">' +
                    '<option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option>' +
                    '<option value="planner"' + (u.role === 'planner' ? ' selected' : '') + '>Planner</option>' +
                    '<option value="carrier"' + (u.role === 'carrier' ? ' selected' : '') + '>Carrier</option>' +
                    '<option value="finance"' + (u.role === 'finance' ? ' selected' : '') + '>Finance</option>' +
                  '</select>' +
                  (isSelf ? '' : '<button class="btn btn-sm btn-danger" onclick="removeUserRole(\'' + u.user_id + '\')">Remove</button>') +
                '</div></td>' +
              '</tr>';
            }).join('')) + '\
        </tbody>\
      </table>\
    </div>\
    \
    <!-- Add User Form -->\
    <div class="section-title" style="margin-top:24px">Add User</div>\
    <div class="card" style="padding:20px">\
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">\
        <div>\
          <label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:4px">USER ID (from Supabase)</label>\
          <input type="text" id="add-user-id" placeholder="e.g. uuid from auth.users" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--bg2);color:var(--text)" />\
        </div>\
        <div>\
          <label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:4px">EMAIL</label>\
          <input type="email" id="add-user-email" placeholder="user@example.com" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--bg2);color:var(--text)" />\
        </div>\
        <div>\
          <label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:4px">ROLE</label>\
          <select id="add-user-role" style="width:100%;padding:8px 12px;border-radius:8px;border:1px solid var(--border);font-size:13px;background:var(--bg2);color:var(--text)">\
            <option value="planner">Planner</option>\
            <option value="carrier">Carrier</option>\
            <option value="finance">Finance</option>\
            <option value="admin">Admin</option>\
          </select>\
        </div>\
        <button class="btn btn-primary" onclick="addUserRole()" style="height:38px">Add User</button>\
      </div>\
      <div style="margin-top:12px;font-size:11px;color:var(--text3)">\
        Tip: The User ID is the Supabase auth UUID. You can find it in the Supabase dashboard under Authentication &gt; Users.\
      </div>\
    </div>';
}

async function addUserRole() {
  var userId = document.getElementById('add-user-id').value.trim();
  var email  = document.getElementById('add-user-email').value.trim();
  var role   = document.getElementById('add-user-role').value;

  if (!userId) { toast('User ID is required', 'error'); return; }

  try {
    var token = sessionStorage.getItem('zoree_token');
    var res = await fetch((window.ZOREE_API_URL || 'http://localhost:3001/api') + '/users/role', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email: email, name: email ? email.split('@')[0] : '', role: role }),
    });
    var data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to add user', 'error'); return; }
    toast('User role assigned: ' + (email || userId) + ' -> ' + role, 'success');
    renderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function changeUserRole(userId, email, name, newRole) {
  try {
    var token = sessionStorage.getItem('zoree_token');
    var res = await fetch((window.ZOREE_API_URL || 'http://localhost:3001/api') + '/users/role', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, email: email, name: name, role: newRole }),
    });
    var data = await res.json();
    if (!res.ok) { toast(data.error || 'Failed to update role', 'error'); return; }
    toast('Role updated: ' + (email || userId) + ' -> ' + newRole, 'success');

    // If user changed their own role, update session
    var currentUser = JSON.parse(sessionStorage.getItem('zoree_user') || '{}');
    if (userId === currentUser.id) {
      currentUser.role = newRole;
      sessionStorage.setItem('zoree_user', JSON.stringify(currentUser));
      updateUserUI();
      applyRoleGating();
    }
    renderUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function removeUserRole(userId) {
  if (!confirm('Remove this user\'s role assignment? They will default to Planner.')) return;
  try {
    var token = sessionStorage.getItem('zoree_token');
    var res = await fetch((window.ZOREE_API_URL || 'http://localhost:3001/api') + '/users/role/' + encodeURIComponent(userId), {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) { var data = await res.json(); toast(data.error || 'Failed to remove user', 'error'); return; }
    toast('User role removed', 'success');
    renderUsers();
  } catch (e) { toast(e.message, 'error'); }
}
