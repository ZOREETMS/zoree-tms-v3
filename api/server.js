// ═══════════════════════════════════════════════════════════════════
// ZoreeTMS API — Tier 2 (Business Logic) — Complete Single File
// No external route files needed — everything is here.
// Supabase credentials stay server-side — never reach the browser.
// ═══════════════════════════════════════════════════════════════════
// (touch 2026-04-19 to nudge nodemon after DEFECT-001 fix in api/routes/invoices.js)

require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');
const { createRolePermissionService } = require('./services/rolePermissions');
const { createRolesRouter } = require('./routes/roles');
const ingestRouter = require('./routes/ingest');
const fusionIngestRouter = require('./routes/fusionIngest');
const { buildMwQueueAdminRouter } = require('./routes/mwQueueAdmin');
const mwQueueWorker = require('./services/mwQueueWorker');
const fusionPublisher = require('./services/fusionPublisher');
const { bus, EVENTS } = require('./services/eventBus');
const { executeBulkPlans } = require('./services/bulkPlanExecution');
const { matchRate, matchAllRates } = require('./services/rateMatcher');
const { getLtlMaxWeight } = require('./services/equipmentLimits');
const {
  apiOrderToDbPatch,
  cleanupOrphanShipmentAfterUnassign,
  syncLinkedShipmentForOrderStatus,
} = require('./services/orderMutations');
const { createLaneQuoteCache } = require('./services/laneQuoteCache');
const history = require('./services/changeHistory');
// TMS bug #1: persistent Clear History per (order|shipment) entity.
const historyClears = require('./services/changeHistoryClears');
const orderLinesAudit = require('./services/orderLinesAudit');
const { buildOrderLineId } = require('./services/orderLineIds');
const shipmentMutations = require('./services/shipmentMutations');
// QA bug #101 / #102 fix: PATCH /api/shipments/:id/status was defined
// only in routes/shipments.js but that router was never mounted, so
// the mobile Confirm / Tender / In-Transit / Delivered taps all hit
// Express's default 404 ("Route not found") and surfaced as
// "Status update failed". We now reach into the same shipService
// updateShipment that the router file used, but expose the endpoint
// inline so the existing /api/shipments/* inline routes stay
// authoritative for the paths they already serve.
const shipService = require('./services/shipments');
// Defense-in-depth guard reused by the inline app.patch('/api/orders/:id')
// handler below. Lives in the orders service so there's one source of
// truth for the "Planned requires shipment_id" rule (root cause of the
// ORD-2026-991550 orphan bug).
const { assertPlannedHasShipment } = require('./services/orders');
const userMgmt = require('./services/userManagement');
const createUsersRouter = require('./routes/users');
const createInvoicesRouter = require('./routes/invoices');
const locationsRouter = require('./routes/locations');  // REQ-29 / REQ-30

// Fields on orders we record diffs for (label used in change_history.field).
//
// TMS bug #2 fix: include service_level so edits to the Service Level
// dropdown in the Edit tab produce a History row. ref_num and po_number
// were already listed; the missing piece for those two was the frontend
// patch builder (see frontend/src/pages/OrdersPage.jsx#saveOrderEdit).
const ORDER_HISTORY_FIELDS = {
  customer: 'customer', origin: 'origin', dest: 'destination',
  weight: 'weight', pieces: 'pieces', ship_mode: 'shipMode',
  service_level: 'serviceLevel',
  commodity: 'commodity', incoterms: 'incoterms', ref_num: 'refNum',
  po_number: 'poNum', ready: 'readyDate', due: 'dueDate', status: 'status',
  shipment_id: 'shipmentId', origin_zip: 'originZip', dest_zip: 'destZip',
  hazmat: 'hazmat', preferred_carrier: 'preferredCarrier',
  excluded_carrier: 'excludedCarrier', no_consolidate: 'noConsolidate',
  dedicated_equip: 'dedicatedEquip', no_contract_rate: 'noContractRate',
  notes: 'notes',
};


// ── Crash prevention ─────────────────────────────────────────────────────────
process.on('uncaughtException', function(err) {
  console.error('[CRASH PREVENTED] uncaughtException:', err.message);
});
process.on('unhandledRejection', function(reason) {
  console.error('[CRASH PREVENTED] unhandledRejection:', reason && reason.message ? reason.message : reason);
});
// ─────────────────────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Config ─────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://ljbeihotrmyqthxptcgp.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxqYmVpaG90cm15cXRoeHB0Y2dwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTg1ODIsImV4cCI6MjA4ODQ3NDU4Mn0.dc1WOPBdJuDKOOjJnl1roVFVI6e0DMrAD1zQf2iJqAE';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || ANON_KEY;

// ── Middleware ──────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ── Supabase REST helpers (server-side only) ────────────────────────
function sbHeaders(token) {
  // Use service_role key for server-side requests (no user token),
  // user's own token for authenticated requests.
  const key = token || SERVICE_KEY;
  return {
    'Content-Type':  'application/json',
    'apikey':        SERVICE_KEY,
    'Authorization': 'Bearer ' + key,
    'Prefer':        'return=representation',
  };
}

async function dbSelect(table, query, token) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query || 'select=*&order=created_at.desc&limit=500'}`;
  const res = await fetch(url, { headers: sbHeaders(token) });
  if (!res.ok) throw new Error(`DB read failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function dbUpsert(table, data, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method:  'POST',
    headers: {
      ...sbHeaders(token),
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`DB upsert failed (${res.status}): ${await res.text()}`);
  const r = await res.json();
  return Array.isArray(r) ? r[0] : r;
}

async function dbUpdate(table, id, data, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: sbHeaders(token),
    body:    JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`DB update failed (${res.status}): ${await res.text()}`);
  const r = await res.json();
  const row = Array.isArray(r) ? r[0] : r;
  // PostgREST returns [] when no row matched — do not treat as success (avoids false "saved" on stubs / wrong id)
  if (Array.isArray(r) && r.length === 0) {
    throw new Error(`DB update matched no rows for ${table} id=${id}`);
  }
  return row;
}

async function dbDelete(table, id, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method:  'DELETE',
    headers: sbHeaders(token),
  });
  if (!res.ok) throw new Error(`DB delete failed (${res.status}): ${await res.text()}`);
  return { deleted: true, id };
}

// ── Auth helper ─────────────────────────────────────────────────────
async function verifyTokenSoft(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    if (token && token.length > 20) {
      try {
        const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token }
        });
        if (r.ok) { const u = await r.json(); u._token = token; return u; }
      } catch(e) {}
    }
  }
  return { id: 'guest', role: 'anon', _token: ANON_KEY };
}

// Small in-memory profile cache so verifyToken doesn't load user_profiles
// on every single request. 30-second TTL keeps role-switch latency short
// while avoiding per-request DB overhead under load.
const _profileCache = new Map();  // userId -> { profile, at }
const PROFILE_TTL_MS = 30_000;
async function _loadProfileCached(user) {
  const hit = _profileCache.get(user.id);
  if (hit && (Date.now() - hit.at) < PROFILE_TTL_MS) return hit.profile;
  try {
    const profile = await userMgmt.ensureProfile({
      userId: user.id, email: user.email,
      fullName: (user.user_metadata && user.user_metadata.full_name) || user.email,
    });
    _profileCache.set(user.id, { profile, at: Date.now() });
    return profile;
  } catch (_) { return null; }
}
function _invalidateProfileCache(userId) { _profileCache.delete(userId); }

async function verifyToken(req, res) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return null;
  }
  const token = auth.slice(7);
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + token }
    });
    if (!r.ok) { res.status(401).json({ error: 'Invalid or expired token' }); return null; }
    const user = await r.json();
    user._token = token;
    // REQ-08: hydrate user.roles + user.activeRole from user_profiles (cached).
    // Endpoints check against user.roles for access; getUserRole() reads activeRole.
    const profile = await _loadProfileCached(user);
    if (profile) {
      user.roles = profile.roles || ['viewer'];
      user.activeRole = profile.active_role || user.roles[0];
      user.disabled = !!profile.disabled;
      if (user.disabled) {
        res.status(403).json({ error: 'Account disabled. Contact an admin.' });
        return null;
      }
    } else {
      user.roles = [(user.user_metadata && user.user_metadata.role) || 'viewer'];
      user.activeRole = user.roles[0];
    }
    // REQ-08: reflect activeRole into user_metadata so the legacy getUserRole()
    // helper returns the UI-selected role. Existing role-check sites
    // (['admin','planner'].includes(getUserRole(u))) honour the switch for free.
    user.user_metadata = { ...(user.user_metadata || {}), role: user.activeRole };
    return user;
  } catch (e) {
    res.status(401).json({ error: 'Token verification failed' });
    return null;
  }
}

// REQ-08: role check helper. Backend role gates check against the full
// roles[] list (authorisation), not the UI-driven activeRole.
function hasAnyRole(user, ...allowedRoles) {
  if (!user || !Array.isArray(user.roles)) return false;
  return allowedRoles.some((r) => user.roles.includes(r));
}

// Allowed tables — security whitelist
const ALLOWED = [
  // Core TMS
  'orders','shipments','carriers','rates','items','drivers','locations',
  'order_lines','lane_preferences','order_history','route_templates','change_history','invoices',
  'equipment_types','planning_parameters','dock_loading_durations','documents','vehicles',
  // Dock & scheduling
  'dock_appointments','dock_schedules','crossdock_hubs','warehouse_dock_config',
  // Events & messaging
  'shipment_events','tms_messages','system_config','tenant_config',
  // Access control
  'access_roles','access_features','role_feature_permissions',
  // OMS
  'oms_orders','oms_order_lines','oms_customers','oms_locations',
  'oms_inventory','oms_inv_transactions','oms_dock_schedule','oms_stage_log',
  // Middleware
  'mw_requests','mw_event_log',
  // Marketing
  'trial_signups',
];

const rolePermissionService = createRolePermissionService({ dbSelect, dbUpsert, dbDelete });
const {
  ROLE_FEATURES,
  getTenantId,
  getUserRole,
  loadRolePermissions,
  saveRolePermissions,
  createRole: createRolePerm,
  deleteRole: deleteRolePerm,
  canWriteTable,
} = rolePermissionService;

const laneQuoteCache = createLaneQuoteCache({
  ttlMs: Number(process.env.LANE_QUOTE_CACHE_TTL_MS || 120000),
  maxEntries: Number(process.env.LANE_QUOTE_CACHE_MAX_ENTRIES || 2000),
});

let ratesVersionCache = { value: 'none', at: 0 };
function invalidateLaneRateCaches() {
  ratesVersionCache = { value: 'none', at: 0 };
  laneQuoteCache.clear();
}
async function getRatesVersionStamp() {
  const now = Date.now();
  if (now - ratesVersionCache.at < 15000) return ratesVersionCache.value;
  try {
    const rows = await dbSelect(
      'rates',
      'select=updated_at,created_at&order=updated_at.desc&limit=1',
      null
    );
    const top = Array.isArray(rows) ? rows[0] : null;
    const stamp = (top && (top.updated_at || top.created_at)) || 'none';
    ratesVersionCache = { value: String(stamp), at: now };
    return ratesVersionCache.value;
  } catch {
    return ratesVersionCache.value || 'none';
  }
}

// ══════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════

// ── Tender / SMTP diagnostics (updated after startup verify) ───────────────
let smtpVerifyState = { ok: null, error: null, checkedAt: null };

// ── Health (public) ────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', version: '3.0.0',
  tier: 'API (Tier 2) — 3-Tier Architecture',
  ts: new Date().toISOString(),
  tenderEmail: {
    smtpConfigured: !!process.env.SMTP_HOST,
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    from: (process.env.SMTP_FROM || process.env.SMTP_USER || 'contact@zoree.io'),
    verifyOk: smtpVerifyState.ok,
    verifyError: smtpVerifyState.ok === false ? smtpVerifyState.error : undefined,
    verifyCheckedAt: smtpVerifyState.checkedAt,
  },
}));

// ── POST /api/trial-signup (public — no auth) ────────────────────────
const trialSignupLimiter = require('express-rate-limit')({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many signup requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post('/api/trial-signup', trialSignupLimiter, async (req, res) => {
  try {
    const { first_name, last_name, email, company, role, monthly_shipments } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email || !company) {
      return res.status(400).json({ error: 'first_name, last_name, email, and company are required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check for duplicate
    const existing = await fetch(
      `${SUPABASE_URL}/rest/v1/trial_signups?email=eq.${encodeURIComponent(email)}&select=id,created_at&limit=1`,
      { headers: sbHeaders() }
    );
    const existingData = await existing.json();
    if (Array.isArray(existingData) && existingData.length > 0) {
      return res.json({ success: true, message: 'We already have your request — our team will be in touch soon!' });
    }

    // Save to database
    const record = { first_name, last_name, email, company, role: role || null, monthly_shipments: monthly_shipments || null, status: 'pending', source: 'landing_page' };
    const saved = await dbUpsert('trial_signups', record);

    // Send notification email to Zoree team
    const transport = getSmtpTransport();
    const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER || 'contact@zoree.io';

    if (transport) {
      // Notification to team
      await transport.sendMail({
        from: `"Zoree TMS" <${fromAddr}>`,
        to: 'contact@zoree.io',
        subject: `New Trial Signup: ${company} — ${first_name} ${last_name}`,
        text: [
          'NEW TRIAL SIGNUP REQUEST',
          '========================',
          '',
          `Name: ${first_name} ${last_name}`,
          `Email: ${email}`,
          `Company: ${company}`,
          `Role: ${role || 'Not specified'}`,
          `Monthly Shipments: ${monthly_shipments || 'Not specified'}`,
          '',
          `Submitted: ${new Date().toISOString()}`,
          '',
          '---',
          'Reply to this email to contact the lead directly.',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:#0F172A;padding:20px 24px;border-radius:12px 12px 0 0">
              <h2 style="color:#fff;margin:0;font-size:18px">New Trial Signup</h2>
              <p style="color:#94A3B8;margin:4px 0 0;font-size:13px">${new Date().toLocaleString()}</p>
            </div>
            <div style="border:1px solid #E2E8F0;border-top:none;padding:24px;border-radius:0 0 12px 12px">
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:8px 0;color:#64748B;font-size:13px;width:140px">Name</td><td style="padding:8px 0;font-weight:600;font-size:14px">${first_name} ${last_name}</td></tr>
                <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Email</td><td style="padding:8px 0;font-size:14px"><a href="mailto:${email}" style="color:#2563EB">${email}</a></td></tr>
                <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Company</td><td style="padding:8px 0;font-weight:600;font-size:14px">${company}</td></tr>
                <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Role</td><td style="padding:8px 0;font-size:14px">${role || '—'}</td></tr>
                <tr><td style="padding:8px 0;color:#64748B;font-size:13px">Monthly Shipments</td><td style="padding:8px 0;font-weight:600;font-size:14px;color:#2563EB">${monthly_shipments || '—'}</td></tr>
              </table>
              <div style="margin-top:20px;padding:12px 16px;background:#FEF3C7;border-radius:8px;border-left:4px solid #d97706">
                <p style="margin:0;font-size:13px;color:#92400E"><strong>Action needed:</strong> Reach out to this lead within 1 business day to set up their trial environment.</p>
              </div>
            </div>
          </div>`,
        replyTo: email,
      });

      // Confirmation email to lead
      await transport.sendMail({
        from: `"Zoree TMS" <${fromAddr}>`,
        to: email,
        subject: `Welcome to Zoree TMS, ${first_name}!`,
        text: [
          `Hi ${first_name},`,
          '',
          'Thanks for your interest in Zoree TMS! We received your trial request.',
          '',
          'Our onboarding specialist will reach out within 1 business day to:',
          '  - Understand your operations and shipment volume',
          '  - Set up your personalized trial environment',
          '  - Walk you through getting started',
          '',
          'In the meantime, feel free to reply to this email with any questions.',
          '',
          'Best,',
          'The Zoree TMS Team',
          'contact@zoree.io',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:linear-gradient(135deg,#0F172A,#1E293B);padding:28px 24px;border-radius:12px 12px 0 0;text-align:center">
              <h1 style="color:#fff;margin:0;font-size:22px;font-weight:800">Zoree<span style="color:#60A5FA">TMS</span></h1>
              <p style="color:#94A3B8;margin:6px 0 0;font-size:12px">Modern Transportation Management</p>
            </div>
            <div style="border:1px solid #E2E8F0;border-top:none;padding:28px 24px;border-radius:0 0 12px 12px">
              <h2 style="font-size:20px;color:#0F172A;margin:0 0 12px">Thanks for signing up, ${first_name}!</h2>
              <p style="font-size:14px;color:#475569;line-height:1.6;margin:0 0 16px">We received your trial request for <strong>${company}</strong>. Our team is excited to help you reduce freight costs and streamline your operations.</p>
              <div style="background:#F8FAFC;border-radius:10px;padding:16px;margin:16px 0">
                <p style="font-size:13px;color:#0F172A;font-weight:600;margin:0 0 8px">What happens next:</p>
                <p style="font-size:13px;color:#475569;margin:0;line-height:1.7">1. Our onboarding specialist will reach out within <strong>1 business day</strong><br>2. We'll configure your personalized trial environment<br>3. You'll get full Professional plan access for <strong>14 days</strong></p>
              </div>
              <p style="font-size:14px;color:#475569;line-height:1.6;margin:16px 0 0">Questions? Just reply to this email — we're here to help.</p>
              <p style="font-size:14px;color:#475569;margin:20px 0 0">Best,<br><strong style="color:#0F172A">The Zoree TMS Team</strong></p>
            </div>
            <p style="text-align:center;font-size:11px;color:#94A3B8;margin-top:16px">Zoree TMS — Reduce freight costs, save time, get visibility.</p>
          </div>`,
      });
    }

    console.log(`[trial-signup] New signup: ${email} (${company})`);
    res.json({ success: true, message: 'Your trial request has been received. Our team will reach out within 1 business day.' });

  } catch (err) {
    console.error('[trial-signup] Error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again or email contact@zoree.io directly.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });

    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SERVICE_KEY },
      body:    JSON.stringify({ email, password }),
    });
    const data = await r.json();

    if (!r.ok || !data.access_token)
      return res.status(401).json({ error: data.error_description || data.msg || 'Invalid email or password' });

    const user = data.user;
    // REQ-08: look up the user's profile for roles + active_role. If no
    // profile exists yet, auto-provision a 'viewer' default (safe for
    // fresh accounts; admin can promote via the User Management page).
    const fullName = (user.user_metadata && user.user_metadata.full_name) || email.split('@')[0];
    let profile = null;
    try {
      profile = await userMgmt.ensureProfile({ userId: user.id, email: user.email, fullName });
    } catch (e) {
      console.error('[login] profile ensure failed:', e.message);
    }
    const roles = profile?.roles || ['viewer'];
    const activeRole = profile?.active_role || roles[0];

    res.json({
      token:         data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      expires_in:    data.expires_in,
      user: {
        id:         user.id,
        email:      user.email,
        name:       profile?.full_name || fullName,
        // Back-compat: keep `role` for older clients; new clients use roles+activeRole.
        role:       activeRole,
        roles,
        activeRole,
        disabled:   !!profile?.disabled,
        tenantId:   'zoree-default',
      },
      tenant: {
        id: 'zoree-default', brandName: 'ZoreeTMS',
        primaryColor: '#3b82f6', tier: 'enterprise', features: ['*'],
      },
      expiresIn: data.expires_in,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/refresh ─────────────────────────────────────────
// Mobile-bug 59 fix: clients that get a 401 (Supabase access_token
// expired after ~1h) call this with their refresh_token instead of
// forcing the user back to the login screen. Returns the same shape as
// /api/auth/login so the mobile API client can drop-in replace the
// stored token.
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const refreshToken = (req.body && req.body.refresh_token) || '';
    if (!refreshToken) return res.status(400).json({ error: 'refresh_token required' });
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
      return res.status(401).json({ error: data.error_description || data.msg || 'Refresh failed' });
    }
    res.json({
      access_token:  data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      expires_in:    data.expires_in,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  // Surface roles + active_role from the profile so the frontend can
  // render the role switcher without an extra fetch.
  let profile = null;
  try {
    profile = await userMgmt.ensureProfile({
      userId: user.id,
      email: user.email,
      fullName: (user.user_metadata && user.user_metadata.full_name) || user.email,
    });
  } catch (_) { /* best effort */ }
  const roles = profile?.roles || [getUserRole(user)];
  const activeRole = profile?.active_role || roles[0];
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: activeRole,
      roles,
      activeRole,
      disabled: !!profile?.disabled,
      name: profile?.full_name || (user.user_metadata && user.user_metadata.full_name) || user.email,
    }
  });
});

app.use('/api/roles', createRolesRouter({
  verifyToken,
  getTenantId,
  getUserRole,
  loadRolePermissions,
  saveRolePermissions,
  createRole: createRolePerm,
  deleteRole: deleteRolePerm,
  roleFeatures: ROLE_FEATURES,
}));

// ── REQ-08: PATCH /api/auth/active-role ──────────────────────────
// Authenticated user switches the role currently rendered by the UI.
// The target role must already be in their user_profiles.roles array.
app.patch('/api/auth/active-role', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    const { activeRole } = req.body || {};
    if (!activeRole) return res.status(400).json({ error: 'activeRole is required' });
    const updated = await userMgmt.switchActiveRole({ userId: user.id, nextActiveRole: activeRole });
    // Invalidate cache so the next request sees the new activeRole immediately.
    _invalidateProfileCache(user.id);
    res.json({
      user: {
        id: user.id,
        email: user.email,
        role: updated.active_role,
        roles: updated.roles,
        activeRole: updated.active_role,
        name: updated.full_name || user.email,
      },
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ── REQ-08: User Management (admin-only CRUD) ─────────────────────
app.use('/api/users', createUsersRouter({
  verifyToken,
  getUserRole,
  SUPABASE_URL,
  SERVICE_KEY,
  invalidateProfileCache: _invalidateProfileCache,
}));

// ── REQ-06: Freight Invoice CRUD + auto-approval on tolerance ─────
app.use('/api/invoices', createInvoicesRouter({
  verifyToken,
  hasAnyRole,
}));

// ── REQ-01: OMS ingest + SSE stream ───────────────────────────────
// POST /api/ingest/oms-orders  — middleware pushes OMS orders
// GET  /api/events/orders      — SSE stream of live order events
// Both routes live in routes/ingest.js.
app.use('/api/ingest', ingestRouter);
app.use('/api', ingestRouter); // exposes /api/events/orders via the same router
// Fusion (OM/Inv) inbound via OIC — see docs/integrations/oic/README.md.
// Endpoints: /api/ingest/fusion/{sales-orders,shipment-requests,inventory/...,items,locations,carriers}
app.use('/api/ingest/fusion', fusionIngestRouter);

// ── MW Queue Admin (REQ-31) ───────────────────────────────────────
// GET  /api/mw-queue/status     — worker state
// POST /api/mw-queue/start      — begin periodic drain
// POST /api/mw-queue/stop       — halt periodic drain
// POST /api/mw-queue/run-once   — single-batch drain on demand
// Auth helpers are passed in so the route module stays free of
// server.js-level concerns (Supabase client, etc).
app.use('/api/mw-queue', buildMwQueueAdminRouter({ verifyToken, getUserRole }));

// REQ-29 / REQ-30 — location master search + create
app.use('/api/locations', locationsRouter);

// ── POST /api/tender/email — notify carrier when a shipment is tendered ──
function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const opts = {
    host,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  };
  if (process.env.SMTP_DEBUG === 'true') opts.debug = true;
  return nodemailer.createTransport(opts);
}

async function verifySmtpOnStartup() {
  const t = getSmtpTransport();
  smtpVerifyState = { ok: null, error: null, checkedAt: new Date().toISOString() };
  if (!t) {
    console.log('   📧 Tender email: SMTP not configured — set SMTP_HOST (and usually SMTP_USER / SMTP_PASS) in api/.env');
    return;
  }
  try {
    await t.verify();
    smtpVerifyState = { ok: true, error: null, checkedAt: new Date().toISOString() };
    console.log('   📧 Tender email: SMTP server accepted connection (' + (process.env.SMTP_HOST || '') + ':' + (process.env.SMTP_PORT || '587') + ')');
  } catch (e) {
    smtpVerifyState = { ok: false, error: e.message || String(e), checkedAt: new Date().toISOString() };
    console.error('   📧 Tender email: SMTP verify FAILED — fix credentials or network before carriers receive mail.');
    console.error('      ', e.message || e);
  }
}

app.post('/api/tender/email', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  // REQ-04: only admin + planner can tender shipments to carriers.
  const roleT = getUserRole(user);
  if (!['admin', 'planner'].includes(roleT)) {
    return res.status(403).json({ error: `Role '${roleT}' cannot tender shipments. Required: admin, planner.` });
  }
  const b = req.body || {};
  const toRaw = String(b.to || '').trim();
  if (!toRaw || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toRaw)) {
    return res.status(400).json({ error: 'Valid "to" email required' });
  }
  const override = (process.env.TENDER_EMAIL_OVERRIDE || '').trim();
  const actualTo = override || toRaw;
  const shipmentId = String(b.shipmentId || '');
  const carrierName = String(b.carrierName || '');
  const refNum = String(b.refNum || '');
  const origin = String(b.origin || '');
  const dest = String(b.dest || '');
  const pickup = String(b.pickup || '');
  const delivery = String(b.delivery || '');
  const mode = String(b.mode || '');
  const cost = '$' + String(b.cost || '0').replace(/[$,]/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const weight = String(b.weight || '');
  const pieces = String(b.pieces || '');
  const commodity = String(b.commodity || '');
  const dockDoor = String(b.dockDoor || '');
  const dockTime = String(b.dockTime || '');
  const specialInstructions = String(b.specialInstructions || '');
  const contactName = String(b.contactName || '');
  const contactPhone = String(b.contactPhone || '');
  const contactEmail = String(b.contactEmail || toRaw);
  const today = new Date().toISOString().slice(0, 10);
  const companyName = String(b.companyName || 'ZOREE LLC');
  const mcNumber = String(b.mcNumber || '');
  const webUrl = String(b.webUrl || 'www.zoree.io');
  const orderNumbers = Array.isArray(b.orderNumbers) ? b.orderNumbers : [];
  const customerName = String(b.customerName || '');
  const lineItems = Array.isArray(b.lineItems) ? b.lineItems : [];
  const childShipments = Array.isArray(b.childShipments) ? b.childShipments : [];

  // Plain text fallback
  const textLines = [
    'BROKER - CARRIER LOAD TENDER & RATE CONFIRMATION',
    '================================================',
    '',
    'Name of Carrier: ' + carrierName,
    'Load Number: ' + shipmentId,
    'Fax/Email: ' + contactEmail,
    'Date: ' + today,
    'Pickup Date: ' + pickup,
    'Delivery Date: ' + (delivery || '—'),
  ];
  if (customerName) textLines.push('Customer: ' + customerName);
  if (orderNumbers.length) textLines.push('Order Number(s): ' + orderNumbers.join(', '));
  textLines.push(
    'Origin: ' + origin,
    'Destination: ' + dest,
    'Commodity & Weight: ' + commodity + ' / ' + weight + ' lbs',
    'Mode: ' + mode,
    'Agreed Rate: ' + cost,
  );
  if (childShipments.length) {
    textLines.push('', 'Multi-Stop Route:', '---');
    childShipments.forEach((cs) => {
      textLines.push('Stop ' + cs.stop + ': ' + (cs.origin || '—') + ' → ' + (cs.dest || '—') + (cs.delivery ? ' | Delivery: ' + cs.delivery : ''));
    });
  }
  if (lineItems.length) {
    textLines.push('', 'Line Items:', '---');
    lineItems.forEach((li, i) => {
      textLines.push((i + 1) + '. ' + (li.itemId || '—') + ' | ' + (li.description || '—') + ' | Qty: ' + (li.qty || 0) + ' | ' + (li.unitWeight || 0) + ' lbs');
    });
  }
  textLines.push(
    '',
    'THIS LOAD IS TENDERED TO THE NAMED CARRIER BY',
    companyName + ', A LICENSED PROPERTY BROKER, PURSUANT TO WRITTEN SIGNED CONTRACTS,',
    'IF ANY, AND THE BROKER/CARRIER TERMS AND CONDITIONS FOUND AT ' + webUrl,
    'TO WHICH CARRIER EXPRESSLY AGREES.',
    '',
    'Special Service Requirements: ' + (specialInstructions || 'None'),
    '',
    'Send Freight Bills to: ' + companyName,
    'MUST INCLUDE THIS COPY OF CONFIRMATION, P.O.D. AND INVOICE',
    '',
    'Please respond via the Carrier Portal or contact your shipper rep.',
    '— ' + companyName,
  );
  const text = textLines.join('\n');

  // Professional HTML tender form
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5">
<div style="max-width:700px;margin:0 auto;background:#fff;border:2px solid #1a237e;padding:0">

  <!-- Header -->
  <div style="background:#1a237e;color:#fff;padding:16px 24px;text-align:center">
    <div style="font-size:18px;font-weight:bold;letter-spacing:1px">${companyName}</div>
    <div style="font-size:14px;font-weight:bold;margin-top:6px;letter-spacing:0.5px">BROKER &mdash; CARRIER LOAD TENDER &amp; RATE CONFIRMATION</div>
  </div>

  <!-- Main Info Table -->
  <table style="width:100%;border-collapse:collapse;font-size:13px" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px;width:50%">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Name of Carrier</div>
        <div style="font-size:15px;font-weight:bold;color:#1a237e">${carrierName}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px;width:50%">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Load Number</div>
        <div style="font-size:15px;font-weight:bold;color:#1a237e">${shipmentId}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Customer</div>
        <div style="font-size:14px;font-weight:bold;color:#1a237e">${customerName || '—'}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Order Number(s)</div>
        <div style="font-size:13px;font-weight:bold;color:#1a237e">${orderNumbers.length ? orderNumbers.join(', ') : '—'}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Carrier Email</div>
        <div>${contactEmail}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Date</div>
        <div>${today}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Pickup Date</div>
        <div style="font-size:14px;font-weight:bold;color:#2e7d32">${pickup || '—'}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Delivery Date</div>
        <div style="font-size:14px;font-weight:bold;color:#2e7d32">${delivery || '—'}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Pickup Dock</div>
        <div style="font-weight:bold">${dockDoor || '—'}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Pickup Time</div>
        <div style="font-weight:bold">${dockTime || '—'}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Origin</div>
        <div style="font-weight:bold">${origin}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Destination</div>
        <div style="font-weight:bold">${dest}</div>
      </td>
    </tr>
    <tr>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Mode</div>
        <div>${mode}</div>
      </td>
      <td style="border:1px solid #ccc;padding:8px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:3px">Commodity &amp; Weight</div>
        <div style="font-weight:bold">${commodity || '—'} &bull; ${weight || '—'} lbs &bull; ${pieces || '—'} pcs</div>
      </td>
    </tr>
  </table>

  <!-- Multi-Stop Route -->
  ${childShipments.length ? `
  <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #ccc;border-top:none" cellpadding="0" cellspacing="0">
    <tr>
      <td colspan="4" style="padding:10px 12px;background:#e3f2fd;font-size:10px;color:#1a237e;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;border-bottom:1px solid #ccc">&#128652; Multi-Stop Route</td>
    </tr>
    <tr style="background:#f5f5f5">
      <th style="padding:6px 10px;text-align:center;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Stop</th>
      <th style="padding:6px 10px;text-align:left;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Origin</th>
      <th style="padding:6px 10px;text-align:left;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Destination</th>
      <th style="padding:6px 10px;text-align:left;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Delivery Date</th>
    </tr>
    ${childShipments.map((cs, i) => '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#fafafa') + '"><td style="padding:5px 10px;border-bottom:1px solid #eee;text-align:center;font-weight:bold;color:#1a237e">' + (cs.stop || i + 1) + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee">' + (cs.origin || '—') + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee;font-weight:bold">' + (cs.dest || '—') + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee;color:#2e7d32;font-weight:bold">' + (cs.delivery || '—') + '</td></tr>').join('')}
  </table>
  ` : ''}

  <!-- Legal Notice -->
  <div style="background:#fff3e0;border:1px solid #ccc;border-top:none;padding:12px 16px;font-size:11px;line-height:1.5;color:#333">
    THIS LOAD IS TENDERED TO THE NAMED CARRIER BY <strong>${companyName}</strong>${mcNumber ? ' (MC-' + mcNumber + ')' : ''}, A LICENSED PROPERTY BROKER, PURSUANT TO WRITTEN SIGNED CONTRACTS, IF ANY, AND THE BROKER/CARRIER TERMS AND CONDITIONS FOUND AT <strong>${webUrl}</strong> TO WHICH CARRIER EXPRESSLY AGREES.
  </div>

  <!-- Line Items -->
  ${lineItems.length ? `
  <table style="width:100%;border-collapse:collapse;font-size:12px;border:1px solid #ccc;border-top:none" cellpadding="0" cellspacing="0">
    <tr>
      <td colspan="4" style="padding:10px 12px;background:#e8eaf6;font-size:10px;color:#1a237e;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;border-bottom:1px solid #ccc">Item Details</td>
    </tr>
    <tr style="background:#f5f5f5">
      <th style="padding:6px 10px;text-align:left;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Item ID</th>
      <th style="padding:6px 10px;text-align:left;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Description</th>
      <th style="padding:6px 10px;text-align:right;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Qty</th>
      <th style="padding:6px 10px;text-align:right;font-size:10px;color:#666;font-weight:bold;border-bottom:1px solid #ccc">Unit Wt</th>
    </tr>
    ${lineItems.map((li, i) => '<tr style="background:' + (i % 2 === 0 ? '#fff' : '#fafafa') + '"><td style="padding:5px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;color:#1a237e;font-weight:bold">' + (li.itemId || '—') + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee">' + (li.description || '—') + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee;text-align:right;font-weight:600">' + (li.qty || 0) + '</td><td style="padding:5px 10px;border-bottom:1px solid #eee;text-align:right;font-family:monospace">' + (li.unitWeight || 0) + ' lbs</td></tr>').join('')}
  </table>
  ` : ''}

  <!-- Shipment Details -->
  <table style="width:100%;border-collapse:collapse;font-size:13px" cellpadding="0" cellspacing="0">
    <tr>
      <td colspan="2" style="border:1px solid #ccc;padding:10px 12px;background:#f9f9f9">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:4px">Shipment Information</div>
        <div>Reference: ${refNum || shipmentId}</div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:1px solid #ccc;padding:10px 12px">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:4px">Special Service Requirements</div>
        <div>${specialInstructions || 'None specified'}</div>
      </td>
    </tr>
    <tr>
      <td colspan="2" style="border:1px solid #ccc;padding:10px 12px;background:#f9f9f9">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:4px">Communications and Invoicing Requirements</div>
        <div>Send Freight Bills to: <strong>${companyName}</strong></div>
        <div style="margin-top:4px;font-size:11px;color:#666">MUST INCLUDE THIS COPY OF CONFIRMATION, P.O.D. AND INVOICE</div>
      </td>
    </tr>
  </table>

  <!-- Rate & Signature -->
  <table style="width:100%;border-collapse:collapse;font-size:13px" cellpadding="0" cellspacing="0">
    <tr>
      <td style="border:1px solid #ccc;padding:12px 16px;width:50%;background:#e8f5e9">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:4px">Agreed Rate</div>
        <div style="font-size:22px;font-weight:bold;color:#2e7d32">${cost}</div>
      </td>
      <td style="border:1px solid #ccc;padding:12px 16px;width:50%">
        <div style="font-size:10px;color:#666;text-transform:uppercase;font-weight:bold;margin-bottom:4px">Carrier Acknowledgment</div>
        <div style="font-size:11px;color:#888;margin-top:8px">Please reply to this email to confirm acceptance.</div>
      </td>
    </tr>
  </table>

  <!-- Footer -->
  <div style="background:#1a237e;color:#fff;padding:12px 24px;text-align:center;font-size:11px">
    <div>${companyName} &bull; ${webUrl}</div>
    <div style="margin-top:4px;opacity:0.7">Powered by Zoree TMS</div>
  </div>

</div>
</body></html>`;

  const subject = String(b.subject || ('Load Tender: ' + shipmentId + ' — ' + origin + ' → ' + dest));
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'contact@zoree.io';
  const transport = getSmtpTransport();

  if (!transport) {
    console.warn('[tender/email] SKIP — SMTP_HOST not set. Would send to:', toRaw, '| subject:', subject);
    return res.json({
      sent: false,
      skipped: 'smtp',
      message: 'SMTP not configured; tender saved but email not sent. Set SMTP_HOST and related env vars.',
      draftTo: toRaw,
    });
  }

  // Perf: respond immediately (202 Accepted) so the UI doesn't block on SMTP
  // handshake/TLS/relay. Email delivery + status flip + audit history run in
  // the background. Failures land in the server log and in change_history
  // (tender_failed) so they remain observable.
  res.status(202).json({
    sent: true,
    queued: true,
    to: actualTo,
    originalTo: override ? toRaw : undefined,
  });

  setImmediate(async () => {
    try {
      const info = await transport.sendMail({
        from,
        to: actualTo,
        replyTo: process.env.SMTP_REPLY_TO || undefined,
        subject,
        text,
        html,
        headers: override ? { 'X-Original-To': toRaw } : undefined,
      });
      console.log('[tender/email] SENT ok | to=' + actualTo + (override ? ' (orig ' + toRaw + ')' : '') + ' | messageId=' + (info.messageId || 'n/a'));

      if (!shipmentId) return;
      try {
        const beforeRows = await dbSelect('shipments', `select=id,status&id=eq.${encodeURIComponent(shipmentId)}&limit=1`, null);
        const shipBefore = Array.isArray(beforeRows) && beforeRows.length ? beforeRows[0] : null;
        if (shipBefore && shipBefore.status !== 'Tendered') {
          await dbUpdate('shipments', shipmentId, { status: 'Tendered' }, null).catch((e) => {
            console.warn('[tender/email] status update failed:', e.message);
          });
          await history.recordChange({
            entityType: 'shipment',
            entityId:   shipmentId,
            action:     'status',
            field:      'status',
            before:     shipBefore.status,
            after:      'Tendered',
            user,
            metadata:   { via: 'tender-email', carrier: carrierName || null, to: actualTo },
          });
        }
        await history.recordChange({
          entityType: 'shipment',
          entityId:   shipmentId,
          action:     'tender',
          user,
          metadata:   {
            carrier: carrierName || null,
            to: actualTo,
            originalTo: override ? toRaw : null,
            messageId: info.messageId || null,
            refNum: refNum || null,
            origin, dest,
          },
        });
      } catch (auditErr) {
        console.error('[tender/email] history write failed:', auditErr.message);
      }
    } catch (e) {
      console.error('[tender/email] SEND FAILED:', e.message);
      if (shipmentId) {
        try {
          await history.recordChange({
            entityType: 'shipment',
            entityId:   shipmentId,
            action:     'tender_failed',
            user,
            metadata:   {
              carrier: carrierName || null,
              to: actualTo,
              error: e.message || String(e),
            },
          });
        } catch (_histErr) { /* already logged above */ }
      }
    }
  });
});

// ── POST /api/oms/push — Send shipment details to OMS after tender acceptance ──
app.post('/api/oms/push', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  const b = req.body || {};
  const payload = {
    shipmentId:      String(b.shipmentId || ''),
    carrier:         String(b.carrier || ''),
    mode:            String(b.mode || ''),
    serviceLevel:    String(b.serviceLevel || ''),
    pickupDate:      String(b.pickupDate || ''),
    deliveryDate:    String(b.deliveryDate || ''),
    proNumber:       String(b.proNumber || ''),
    bolNumber:       String(b.bolNumber || ''),
    // REQ-22 / REQ-24: carry the trailer seal through the push so the
    // OMS oms_orders mirror captures it automatically too.
    sealNumber:      String(b.sealNumber || ''),
    dockNumber:      String(b.dockNumber || ''),
    dockLoadStart:   String(b.dockLoadStart || ''),
    dockLoadEnd:     String(b.dockLoadEnd || ''),
    origin:          String(b.origin || ''),
    destination:     String(b.destination || ''),
    weight:          Number(b.weight || 0),
    pieces:          Number(b.pieces || 0),
    commodity:       String(b.commodity || ''),
    cost:            Number(b.cost || 0),
    orderIds:        Array.isArray(b.orderIds) ? b.orderIds : [],
    notes:           String(b.notes || ''),
    timestamp:       new Date().toISOString(),
    source:          'ZoreeTMS',
  };

  // REQ-24: run the MW auto-sync job. This mirrors the tender-accept
  // onto every linked oms_orders row (carrier / BOL / PRO / seal /
  // dock / pickup / delivery / service level + tendered_at timestamp)
  // so the OMS sees the accept immediately, without OMS_API_URL or
  // any operator push. This runs even when the external OMS endpoint
  // is not configured, because both tables share the same Supabase
  // project and a direct UPSERT is the most reliable path.
  const omsSync = require('./services/omsSync');
  let syncResult = null;
  try {
    syncResult = await omsSync.syncTenderAcceptToOms(payload, user);
    console.log(`[OMS Push] MW auto-sync complete → ${syncResult.updated.length} updated, ${syncResult.skipped.length} skipped`);
  } catch (syncErr) {
    console.error('[OMS Push] MW auto-sync failed:', syncErr.message);
  }

  // Check if an external OMS endpoint is configured (legacy
  // pass-through for tenants that run OMS as a separate service).
  const omsUrl = process.env.OMS_API_URL || '';
  const omsApiKey = process.env.OMS_API_KEY || '';

  if (!omsUrl) {
    // The inline MW sync above has already kept OMS current. Respond
    // with its summary so the caller can show a meaningful toast.
    // `sent` is true only when at least one oms_orders row was actually
    // updated — otherwise the UI must not claim "sent to OMS" (REQ-24
    // honest reporting: avoid the old false-positive toast where every
    // row was silently skipped because a column was missing).
    const updatedCount = syncResult ? syncResult.updated.length : 0;
    const skippedCount = syncResult ? syncResult.skipped.length : 0;
    let message;
    if (!syncResult)            message = 'MW auto-sync failed — see server logs.';
    else if (updatedCount > 0)  message = `MW auto-sync updated ${updatedCount} oms_orders row(s)` + (skippedCount ? `; ${skippedCount} skipped (${Object.keys(syncResult.skippedByReason || {}).join(', ')}).` : '.');
    else                        message = `MW auto-sync updated 0 rows — ${skippedCount} skipped (${Object.keys(syncResult.skippedByReason || {}).join(', ') || 'unknown'}). Check server logs.`;
    return res.json({
      sent: updatedCount > 0,
      via: 'mw-auto-sync',
      message,
      omsSync: syncResult,
      payload,
    });
  }

  try {
    const omsRes = await fetch(omsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(omsApiKey ? { 'Authorization': `Bearer ${omsApiKey}`, 'X-API-Key': omsApiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    const omsText = await omsRes.text();
    console.log(`[OMS Push] ${omsRes.status} | ${omsText.slice(0, 300)}`);
    if (omsRes.ok) {
      // REQ-24: external forward succeeded AND the inline MW sync ran.
      res.json({ sent: true, via: 'external+mw-auto-sync', status: omsRes.status, omsSync: syncResult, payload });
    } else {
      res.status(502).json({ sent: false, via: 'mw-auto-sync-only', error: `OMS returned ${omsRes.status}`, detail: omsText.slice(0, 500), omsSync: syncResult, payload });
    }
  } catch (err) {
    console.error('[OMS Push] external forward FAILED:', err.message);
    // Inline sync still succeeded (payload mirrored into oms_orders), so
    // return 200 with a "partial" marker rather than 502 — the OMS db
    // view is current even if the external endpoint was unreachable.
    res.json({ sent: !!syncResult, via: 'mw-auto-sync-only', warning: err.message, omsSync: syncResult, payload });
  }
});

// ══════════════════════════════════════════════════════════════════
// GENERIC TABLE PROXY — handles all TMS data reads/writes
// Replaces individual order/shipment/carrier routes with one
// flexible proxy that the frontend supaFetch can call.
// ══════════════════════════════════════════════════════════════════

// GET /api/db/:table?q=<supabase query string>
app.get('/api/db/:table', async (req, res) => {
  const user = await verifyTokenSoft(req);
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  try {
    const query = req.query.q || 'select=*&order=created_at.desc&limit=500';
    // Use service role to bypass RLS for all reads
    const rows  = await dbSelect(req.params.table, query, null);
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/:table  — insert or upsert
app.post('/api/db/:table', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  if (!(await canWriteTable(user, req.params.table, 'POST', getTenantId(user)))) {
    return res.status(403).json({ error: `Role '${getUserRole(user)}' cannot create ${req.params.table}` });
  }
  try {
    // Use service role for all allowed tables (RLS blocks writes with user JWT)
    const row = await dbUpsert(req.params.table, req.body, null);
    // Lane quotes are cached post-pref-filtering; pref or rate changes
    // must invalidate or stale "preferred=false" quotes leak through.
    if (['rates', 'lane_preferences', 'planning_parameters'].includes(req.params.table)) {
      invalidateLaneRateCaches();
    }
    res.status(201).json(row || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/:table/:id  — update by id
// PATCH /api/db/rates — update by lane query string (for supaSaveRate)
app.patch('/api/db/rates', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  if (!(await canWriteTable(user, 'rates', 'PATCH', getTenantId(user)))) {
    return res.status(403).json({ error: `Role '${getUserRole(user)}' cannot edit rates` });
  }
  const q = req.query;
  // Build filter from query string e.g. lane=eq.AVRT-HOU-DAL
  const qs = Object.entries(q).map(([k,v]) => k+'='+v).join('&');
  if (!qs) return res.status(400).json({ error: 'No filter provided' });
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rates?${qs}`, {
      method: 'PATCH',
      headers: { ...sbHeaders(user._token), 'Prefer': 'return=representation' },
      body: JSON.stringify(req.body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: 'DB update failed', detail: data });
    invalidateLaneRateCaches();
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/:table/:id', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  if (!(await canWriteTable(user, req.params.table, 'PATCH', getTenantId(user)))) {
    return res.status(403).json({ error: `Role '${getUserRole(user)}' cannot edit ${req.params.table}` });
  }
  try {
    // ── Bug #62 (was: AI tender accept UI mismatch). The previous
    // workaround here remapped `status: 'Confirmed'` → `'Tendered'`
    // because the chk_shipments_status_controlled CHECK predated
    // 'Confirmed'/'Tender Accepted'. Migration 036 widened the
    // whitelist to include both, so the rewrite is no longer needed —
    // and was actively masking the AI accept bug (the AI patched
    // 'Confirmed', the server silently downgraded it to 'Tendered',
    // displayStatus stayed at 'Tendered', the UI kept showing
    // Accept/Reject).
    let body = req.body;

    // ── Bug #40: capture the existing shipment row before the update ──
    // so the audit helper below can diff status / dock fields. We can't
    // delegate to shipService.updateShipment because shipmentToDb does
    // not currently round-trip every DB column (service_level,
    // seal_number, …) and would silently drop them. So we keep the raw
    // dbUpdate path and invoke recordRawPatchAudit() afterwards.
    let shipmentBefore = null;
    if (req.params.table === 'shipments') {
      try {
        const beforeRows = await dbSelect('shipments', `select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`);
        shipmentBefore = beforeRows && beforeRows[0] ? beforeRows[0] : null;
      } catch (_e) { /* best-effort; audit will no-op without before */ }
    }

    // Use service role for all allowed tables (RLS blocks writes with user JWT)
    const row = await dbUpdate(req.params.table, req.params.id, body, null);
    if (['rates', 'lane_preferences', 'planning_parameters'].includes(req.params.table)) {
      invalidateLaneRateCaches();
    }

    // Bug #40: write the same change_history row updateShipment would
    // have written, so the Shipment Timeline can render the "Tendered
    // to Carrier" timestamp (and dock-field changes flow through to
    // the OMS Load & Ship modal). Best-effort — never fail the PATCH.
    if (req.params.table === 'shipments' && shipmentBefore && row) {
      try {
        await shipService.recordRawPatchAudit({
          id:     req.params.id,
          before: shipmentBefore,
          after:  row,
          user,
          via:    'db-patch',
        });
      } catch (auditErr) {
        console.error('[PATCH /api/db/shipments] audit failed:', auditErr.message);
      }
    }

    res.json(row || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/db/:table/:id  — delete by id
app.delete('/api/db/:table/:id', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  if (!(await canWriteTable(user, req.params.table, 'DELETE', getTenantId(user)))) {
    return res.status(403).json({ error: `Role '${getUserRole(user)}' cannot delete ${req.params.table}` });
  }
  try {
    await dbDelete(req.params.table, req.params.id, null);
    if (['rates', 'lane_preferences', 'planning_parameters'].includes(req.params.table)) {
      invalidateLaneRateCaches();
    }
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Order Lines: GET /api/orders/:id/lines ────────────────────────
app.get('/api/orders/:id/lines', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    // Use null token to use service role key — bypasses RLS for reads
    const rows = await dbSelect('order_lines',
      `select=*&order_id=eq.${encodeURIComponent(req.params.id)}&order=line_num.asc`,
      null);
    console.log('[Lines] GET', req.params.id, '→', Array.isArray(rows) ? rows.length : 0, 'rows');
    res.json(Array.isArray(rows) ? rows : []);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Order Lines: POST /api/orders/:id/lines — replace all lines (delete + insert)
app.post('/api/orders/:id/lines', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    const orderId = req.params.id;
    const lines = Array.isArray(req.body) ? req.body : (req.body ? [req.body] : []);

    // REQ-02: snapshot current state BEFORE we mutate so we can write
    // per-line diffs to change_history after the replace. Audit logic
    // lives in services/orderLinesAudit.js per CLAUDE_RULES §1/§6.
    const { beforeLines, beforeOrder } = await orderLinesAudit.snapshotBeforeLinesEdit({
      dbSelect, orderId,
    });

    // Step 1: Delete all existing lines for this order (service role to bypass RLS)
    await fetch(`${SUPABASE_URL}/rest/v1/order_lines?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'DELETE', headers: sbHeaders(null)
    });

    // Step 2: Insert new lines
    let results = [];
    const normalizedLines = lines.map((line, i) => ({
      id:           buildOrderLineId(orderId, line.line_num || (i + 1)),
      order_id:     orderId,
      line_num:     line.line_num || (i + 1),
      item_id:      line.item_id || line.itemId || null,
      description:  line.description || '',
      qty_ordered:  parseInt(line.qty_ordered ?? line.qty) || 0,
      unit_weight:  parseFloat(line.unit_weight ?? line.unitWt) || 0,
      total_weight: parseFloat(line.total_weight ?? line.totalWt) || 0,
      unit_value:   parseFloat(line.unit_weight ?? line.unitWt) || 0,   // actual DB column
      total_value:  parseFloat(line.total_weight ?? line.totalWt) || 0, // actual DB column
    }));
    if (normalizedLines.length > 0) {
      console.log('[Lines] Inserting rows:', JSON.stringify(normalizedLines));
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/order_lines`, {
        method: 'POST',
        headers: { ...sbHeaders(null), 'Prefer': 'return=representation' },
        body: JSON.stringify(normalizedLines)
      });
      const insText = await insRes.text();
      console.log('[Lines] Insert status:', insRes.status, '| response:', insText.slice(0,300));
      if (insRes.ok) results = JSON.parse(insText);
      else console.error('[Lines] Insert FAILED:', insRes.status, insText);
    }

    // Step 3: Update weight, pieces and line_count on parent order
    const totalWeight = normalizedLines.reduce((s, l) => s + (l.total_weight || 0), 0);
    const totalPieces = normalizedLines.reduce((s, l) => s + (l.qty_ordered || 0), 0);
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: sbHeaders(null),
      body: JSON.stringify({ line_count: normalizedLines.length, weight: totalWeight, pieces: totalPieces })
    });
    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      console.error('[Lines] Order PATCH failed:', patchRes.status, patchErr);
    }

    // REQ-02: write change_history rows for the lines replace + the
    // cascading parent-order totals. Delegated to orderLinesAudit so
    // the route handler stays small (CLAUDE_RULES §6/§9).
    await orderLinesAudit.recordLinesEdit({
      history,
      orderId,
      beforeLines,
      afterLines:  normalizedLines,
      beforeOrder,
      afterOrder:  beforeOrder ? {
        weight:     totalWeight,
        pieces:     totalPieces,
        line_count: normalizedLines.length,
      } : null,
      user,
    });

    console.log(`[Lines] Order ${orderId}: replaced ${normalizedLines.length} lines, weight=${totalWeight}lbs, pieces=${totalPieces}`);
    res.status(201).json({ lines: results, line_count: normalizedLines.length, weight: totalWeight, pieces: totalPieces });
  } catch (e) { console.error('[Lines] Error:', e.message); res.status(500).json({ error: e.message }); }
});

// ── Order Lines: DELETE /api/orders/:id/lines — clear all lines
app.delete('/api/orders/:id/lines', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/order_lines?order_id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE', headers: sbHeaders(user._token)
    });
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(req.params.id)}`, {
      method: 'PATCH', headers: sbHeaders(user._token),
      body: JSON.stringify({ line_count: 0, weight: 0, pieces: 0 })
    });
    res.json({ deleted: true, order_id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Orders with lines: GET /api/orders/:id/full ────────────────────
app.get('/api/orders/:id/full', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    const [orderRows, lineRows] = await Promise.all([
      dbSelect('orders', `select=*&id=eq.${encodeURIComponent(req.params.id)}`, user._token),
      dbSelect('order_lines', `select=*&order_id=eq.${encodeURIComponent(req.params.id)}&order=line_num.asc`, user._token),
    ]);
    if (!orderRows || !orderRows.length)
      return res.status(404).json({ error: 'Order not found' });
    const order = orderRows[0];
    order.lines = Array.isArray(lineRows) ? lineRows : [];
    res.json(order);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Orders list with lines count ───────────────────────────────────
app.get('/api/orders/full', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    const rows = await dbSelect('orders', 'select=*&order=created_at.desc&limit=500', user._token);
    res.json({ orders: Array.isArray(rows) ? rows : [], total: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Convenience named routes (used by dashboard etc.) ──────────────
// Transform raw DB rows to consistent API field names
function dbToOrderApi(r) {
  return {
    id:              r.id,
    order_id:        r.id,
    customer:        r.customer,
    origin:          r.origin,
    destination:     r.dest,
    weight:          r.weight,
    pieces:          r.pieces,
    commodity:       r.commodity,
    incoterms:       r.incoterms   || null,
    // TMS bug: Reference # / PO Number edits were saved to DB but never
    // round-tripped to the UI because this mapper omitted them. Expose
    // both snake_case and camelCase aliases so consumers reading either
    // shape (OrderDetailModal reads o.ref_num / o.po_number; OrdersPage
    // edit-form init at line ~505 also accepts o.refNum / o.poNum) get
    // the persisted value back. Companion migration: 034_orders_add_ref_num.
    ref_num:         r.ref_num    || null,
    refNum:          r.ref_num    || null,
    po_number:       r.po_number  || null,
    poNum:           r.po_number  || null,
    readyDate:       r.ready       || null,
    dueDate:         r.due         || null,
    status:          r.status      || 'Unplanned',
    shipmentId:      r.shipment_id || null,
    hazmat:          r.hazmat      || false,
    preferredCarrier:r.preferred_carrier || null,
    excludedCarrier: r.excluded_carrier  || null,
    notes:           r.notes       || null,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}
app.get('/api/orders',    async (req, res) => { const u = await verifyToken(req,res); if(!u) return; try { const rows = await dbSelect('orders','select=*&order=created_at.desc&limit=500',u._token); const orders = rows.map(dbToOrderApi); res.json({ orders, total: orders.length }); } catch(e){ res.status(500).json({error:e.message}); } });

app.patch('/api/orders/:id', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: only admin + planner can edit orders.
  const rolePP = getUserRole(u);
  if (!['admin', 'planner'].includes(rolePP)) {
    return res.status(403).json({ error: `Role '${rolePP}' cannot edit orders. Required: admin, planner.` });
  }
  try {
    const beforeRows = await dbSelect('orders', `select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`, null);
    const before = Array.isArray(beforeRows) && beforeRows.length ? beforeRows[0] : null;
    const patch = apiOrderToDbPatch(req.body);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    // Defense-in-depth: reject status='Planned' transitions that don't
    // also assign a shipment_id. The bulk-plan execute path (which is
    // the only legitimate way an order should reach 'Planned') always
    // sets both fields together — so this guard never trips for it.
    // It DOES catch a bare PATCH from a client that's just flipping
    // the status field, which is what produced the ORD-2026-991550
    // orphan. See `assertPlannedHasShipment` in api/services/orders.js
    // for the rule's single source of truth.
    try {
      assertPlannedHasShipment(
        { status: before?.status, shipmentId: before?.shipment_id },
        { status: patch.status, shipment_id: patch.shipment_id },
      );
    } catch (guardErr) {
      return res.status(guardErr.status || 400).json({
        error: guardErr.message,
        code:  guardErr.code || 'PLANNED_REQUIRES_SHIPMENT',
      });
    }
    // Use server-side service key to bypass Supabase client-role RLS on writes.
    const row = await dbUpdate('orders', req.params.id, patch, null);

    // Auto-clean orphan shipments: if order was unassigned and no orders remain on that shipment, delete it.
    // If the shipment still has orders, recalc weight/pieces/total_cost/fuel/accessorials/order_ids
    // server-side so the detail panel always reflects the post-unassign totals (REQ-03 mirror).
    const prevShipmentId = before?.shipment_id || null;
    const nowShipmentId = row?.shipment_id || null;
    if (prevShipmentId && !nowShipmentId) {
      const { deleted } = await cleanupOrphanShipmentAfterUnassign({
        previousShipmentId: prevShipmentId,
        dbSelect,
        dbDelete,
      });
      if (!deleted) {
        try {
          await shipmentMutations.recalcShipmentAfterOrderRemoval({
            shipmentId:     prevShipmentId,
            removedOrderId: row.id,
            user:           u,
          });
        } catch (recalcErr) {
          console.error('[orders.patch] recalc after unassign failed:', recalcErr.message);
        }
      }
    }

    // Mobile-bug 58 / 61: when a planner taps "Tender" or
    // "Tender Accepted" from the order side, the linked shipment must
    // follow. This mirrors the shipment→order cascade in
    // shipmentEvents.syncLinkedOrdersForShipmentStatus so the UI never
    // shows a Tendered order paired with a still-Planned shipment.
    // Idempotent — no-ops when status didn't change or there is no
    // linked shipment.
    const statusChanged = !!before && before.status !== row.status;
    const cascadeShipmentId = row?.shipment_id || before?.shipment_id || null;
    if (statusChanged && cascadeShipmentId) {
      try {
        await syncLinkedShipmentForOrderStatus({
          shipmentId:     cascadeShipmentId,
          newOrderStatus: row.status,
          user:           u,
          dbSelect,
          dbUpdate,
          history,
        });
      } catch (cascadeErr) {
        console.error('[orders.patch] shipment cascade failed:', cascadeErr.message);
      }
    }

    // REQ-02: capture per-field diffs for this edit. If the edit
    // unassigned the order from a shipment, log a dedicated 'unassign'
    // event in addition to the field diff (so reports can filter).
    if (before) {
      await history.recordFieldDiffs({
        entityType: 'order',
        entityId:   row.id,
        before,
        after:      row,
        user:       u,
        fields:     ORDER_HISTORY_FIELDS,
      });
      if (prevShipmentId && !nowShipmentId) {
        await history.recordChange({
          entityType: 'order',
          entityId:   row.id,
          action:     'unassign',
          user:       u,
          metadata:   { previousShipmentId: prevShipmentId },
        });
        // REQ-20: also log the unassign on the shipment side so planners
        // can see "Order X was removed" in the shipment's history drawer.
        await history.recordChange({
          entityType: 'shipment',
          entityId:   prevShipmentId,
          action:     'unassign',
          user:       u,
          metadata:   { orderId: row.id, previousShipmentId: prevShipmentId },
        });
      }
    }

    // REQ-01: broadcast update to SSE subscribers.
    bus.emit(EVENTS.ORDER_UPDATED, { id: row.id, status: row.status, shipment_id: row.shipment_id });

    res.json(dbToOrderApi(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: only admin + planner can create orders.
  const roleC = getUserRole(u);
  if (!['admin', 'planner'].includes(roleC)) {
    return res.status(403).json({ error: `Role '${roleC}' cannot create orders. Required: admin, planner.` });
  }
  try {
    const id = req.body?.id || `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
    const row = await dbUpsert('orders', { id, ...apiOrderToDbPatch(req.body || {}) }, null);

    // QA bug #91 ("New order creation is failing and order is not
    // getting created") fix: PostgREST's upsert can return an empty
    // payload when the row write was silently discarded (RLS denial,
    // etc.). dbUpsert previously returned `undefined` in that case and
    // we still 201'd, so the mobile thought the create succeeded but
    // no row appeared. Validate the response carries an id before
    // confirming success — surfaces a concrete error to the form
    // instead of a phantom-success.
    if (!row || !row.id) {
      console.error('[orders.create] dbUpsert returned no row for id', id);
      return res.status(500).json({
        error: 'Order create did not return a row. The write may have been blocked by row-level security or a constraint.',
      });
    }

    // REQ-01: broadcast to SSE subscribers so orders appear in TMS
    // without any manual refresh, regardless of which path created them.
    bus.emit(EVENTS.ORDER_CREATED, {
      id: row.id,
      customer: row.customer,
      origin: row.origin,
      dest: row.dest,
      weight: row.weight,
      sync_source: row.sync_source || 'manual',
      auto_synced_at: row.auto_synced_at || null,
      oms_order_ref: row.oms_order_ref || null,
    });
    // REQ-02: record creation event.
    await history.recordChange({
      entityType: 'order',
      entityId:   row.id,
      action:     'create',
      user:       u,
      metadata:   { sync_source: row.sync_source || 'manual' },
    });
    res.status(201).json(dbToOrderApi(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: only admin can delete orders.
  const roleD = getUserRole(u);
  if (roleD !== 'admin') {
    return res.status(403).json({ error: `Role '${roleD}' cannot delete orders. Required: admin.` });
  }
  try {
    // Read the row first so we can keep a tombstone for history.
    const beforeRows = await dbSelect('orders', `select=*&id=eq.${encodeURIComponent(req.params.id)}&limit=1`, null);
    const before = Array.isArray(beforeRows) && beforeRows.length ? beforeRows[0] : null;
    await dbDelete('orders', req.params.id, null);
    // REQ-02: record deletion.
    await history.recordChange({
      entityType: 'order',
      entityId:   req.params.id,
      action:     'delete',
      before,
      user:       u,
    });
    bus.emit(EVENTS.ORDER_DELETED, { id: req.params.id });
    res.json({ deleted: true, id: req.params.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REQ-02: history read endpoints ─────────────────────────────────
app.get('/api/orders/:id/history', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await history.getHistory('order', req.params.id, { limit });
    res.json({ entity: 'order', id: req.params.id, rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/shipments/:id/history', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await history.getHistory('shipment', req.params.id, { limit });
    res.json({ entity: 'shipment', id: req.params.id, rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// TMS bug #1: Clear History endpoints.
//
// Records a cleared_at marker via the changeHistoryClears service so the
// History tab stops surfacing rows older than the marker — without
// destroying the immutable change_history ledger. Audit-compliant by
// design: DBAs can still query change_history directly.
//
// Role gate mirrors the order/shipment edit gate (admin + planner).
// We deliberately do NOT widen this to viewers/customers.
app.post('/api/orders/:id/history/clear', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  const role = getUserRole(u);
  if (!['admin', 'planner'].includes(role)) {
    return res.status(403).json({ error: `Role '${role}' cannot clear order history. Required: admin, planner.` });
  }
  try {
    const marker = await historyClears.recordClear({
      entityType: 'order',
      entityId:   req.params.id,
      user:       u,
      metadata:   { source: 'order-detail-modal' },
    });
    res.json({ entity: 'order', id: req.params.id, clearedAt: marker?.cleared_at || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/shipments/:id/history/clear', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  const role = getUserRole(u);
  if (!['admin', 'planner'].includes(role)) {
    return res.status(403).json({ error: `Role '${role}' cannot clear shipment history. Required: admin, planner.` });
  }
  try {
    const marker = await historyClears.recordClear({
      entityType: 'shipment',
      entityId:   req.params.id,
      user:       u,
      metadata:   { source: 'shipment-detail-modal' },
    });
    res.json({ entity: 'shipment', id: req.params.id, clearedAt: marker?.cleared_at || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual shipment timeline event from the UI. Transitions the shipment
// status (and linked orders where appropriate) and records change_history
// rows so the event + any note persist beyond the modal's local state.
//   body: { type, note?, date? }
app.post('/api/shipments/:id/events', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  const roleS = getUserRole(u);
  if (!['admin', 'planner'].includes(roleS)) {
    return res.status(403).json({ error: `Role '${roleS}' cannot add shipment events. Required: admin, planner.` });
  }
  try {
    const shipmentEvents = require('./services/shipmentEvents');
    const result = await shipmentEvents.applyShipmentEvent({
      shipmentId: req.params.id,
      type: req.body?.type,
      note: req.body?.note,
      date: req.body?.date,
      user: u,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// REQ-03: Manually add an order to a shipment — recalculates shipment
// weight, pieces, and total_cost (proportional to weight) and plants
// the right REQ-02 history rows on both entities.
//   body: { orderId }
app.post('/api/shipments/:id/add-order', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: only admin + planner can manually attach orders to a shipment.
  const roleS = getUserRole(u);
  if (!['admin', 'planner'].includes(roleS)) {
    return res.status(403).json({ error: `Role '${roleS}' cannot add orders to a shipment. Required: admin, planner.` });
  }
  try {
    const orderId = String(req.body?.orderId || '').trim();
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const result = await shipmentMutations.addOrderToShipment({
      shipmentId: req.params.id,
      orderId,
      user: u,
    });
    // Emit an ORDER_UPDATED so open TMS tabs refresh instantly (REQ-01 SSE).
    bus.emit(EVENTS.ORDER_UPDATED, { id: orderId, status: 'Planned', shipment_id: req.params.id });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// POST /api/shipments/:id/change-carrier — carrier (re)assignment with
// proper audit + WS broadcast (REQ-02). Replaces the previous
// component-level DbApi.patch("shipments", id, { carrier, ... }) call,
// which hit /api/db/shipments/:id (a raw upsert) and therefore skipped
// change_history rows AND the SHIPMENT_UPDATED broadcast — that's what
// produced the "Shipment Details still shows the old carrier" bug.
//   body: { carrier, mode?, total_cost?, rate?, fuel_surcharge?, miles?, service_level?, rate_id? }
app.post('/api/shipments/:id/change-carrier', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: same role gate as the other shipment-edit endpoints.
  const roleC = getUserRole(u);
  if (!['admin', 'planner', 'dispatcher'].includes(roleC)) {
    return res.status(403).json({ error: `Role '${roleC}' cannot change shipment carrier. Required: admin, planner, dispatcher.` });
  }
  try {
    const result = await shipmentMutations.changeShipmentCarrier({
      shipmentId: req.params.id,
      payload:    req.body || {},
      user:       u,
    });
    res.json({ ok: true, ...result });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// PATCH /api/shipments/:id/status — quick status transition used by the
// mobile detail screen for the Tender / Confirm / In-Transit / Delivered
// chip row (QA bugs #101, #102). Validates against the canonical enum
// (kept in lock-step with chk_shipments_status_controlled — see
// migrations/036_shipments_status_add_tender_accepted.sql) and routes
// through shipService.updateShipment so the order cascade in
// shipmentEvents fires and a status row lands in change_history.
app.patch('/api/shipments/:id/status', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  const role = getUserRole(u);
  if (!['admin', 'planner', 'dispatcher'].includes(role)) {
    return res.status(403).json({
      error: `Role '${role}' cannot update shipment status. Required: admin, planner, dispatcher.`,
    });
  }
  const { status } = req.body || {};
  // Mirrors the VALID list in routes/shipments.js so behaviour stays
  // identical if/when that router is eventually mounted.
  const VALID = [
    'Planned',
    'Tendered',
    'Tender Accepted',
    'Tender Rejected',
    'Confirmed',
    'In Transit',
    'Delivered',
    'Cancelled',
    'Exception',
  ];
  if (!VALID.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${VALID.join(', ')}`,
    });
  }
  try {
    const shipment = await shipService.updateShipment(
      req.params.id,
      { status },
      req.tenant || null,
      { user: u, via: 'shipment-status-patch' },
    );
    res.json(shipment);
  } catch (e) {
    const code = e.status || 500;
    res.status(code).json({ error: e.message });
  }
});

// ── PATCH /api/shipments/:id — audited generic shipment update ──
//
// Bug #38: this endpoint was defined in api/routes/shipments.js but
// that router is never mounted in server.js, so every call to
// ShipmentsApi.update() (frontend) returned 404 — silently for the
// dock-scheduling save path, which then surfaced as "dock door not
// reflected on the shipment" because the PATCH never reached the DB.
//
// Mirrors the route in routes/shipments.js so we keep one canonical
// behaviour: validates role, delegates to shipService.updateShipment
// (which writes change_history rows for status/dock changes, fires
// the OMS dock mirror, and cascades linked-order status). Body uses
// app-shape camelCase keys (dockDoor, dockTime, loadingStart,
// loadingEnd, …) per the shipmentToDb mapper.
app.patch('/api/shipments/:id', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  const role = getUserRole(u);
  if (!['admin', 'planner', 'dispatcher'].includes(role)) {
    return res.status(403).json({
      error: `Role '${role}' cannot update shipments. Required: admin, planner, dispatcher.`,
    });
  }
  try {
    const shipment = await shipService.updateShipment(
      req.params.id,
      req.body,
      req.tenant || null,
      { user: u, via: 'shipment-patch' },
    );
    res.json(shipment);
  } catch (e) {
    const code = e.status || 500;
    res.status(code).json({ error: e.message });
  }
});

app.get('/api/shipments', async (req, res) => {
  const u = await verifyToken(req,res); if(!u) return;
  try {
    // REQ-21: allow filtering by a single shipment id so the OMS middleware
    // pull can fetch one shipment's tender-accept details without pulling
    // the full list. Accept both PostgREST-style `?id=eq.FOO` and plain
    // `?id=FOO`. Falls through to the existing "latest 500" list view.
    let qs = 'select=*&order=created_at.desc&limit=500';
    const rawId = typeof req.query.id === 'string' ? req.query.id : '';
    const idMatch = rawId.replace(/^eq\./, '').trim();
    if (idMatch) {
      qs = `select=*&id=eq.${encodeURIComponent(idMatch)}&limit=1`;
    }
    const rows = await dbSelect('shipments', qs, u._token);
    res.json({ shipments: rows, total: rows.length });
  } catch(e){ res.status(500).json({error:e.message}); }
});
// POST /api/shipments — create a single shipment + write a 'create'
// audit row, mirroring the BulkPlan path so the Shipment Details
// timeline can show a real "Order Created & Rate Confirmed" timestamp
// instead of a static "Confirmed" label. Manual creates / copies that
// previously went through DbApi.upsert("shipments", ...) skipped the
// audit and broke the timeline rung (CLAUDE_RULES §4: API + audit
// belong on the server, not in UI).
app.post('/api/shipments', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  const role = getUserRole(user);
  if (!['admin', 'planner'].includes(role)) {
    return res.status(403).json({ error: `Role '${role}' cannot create shipments. Required: admin, planner.` });
  }
  // Pull non-column metadata fields out before insert so they don't
  // poison the DB write but still flow into the audit row.
  const { copiedFrom = null, ...shipmentRow } = req.body || {};
  if (!shipmentRow.id) return res.status(400).json({ error: 'shipment.id required' });
  try {
    const row = await dbUpsert('shipments', shipmentRow, null);
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   shipmentRow.id,
        action:     'create',
        after:      { status: shipmentRow.status, carrier: shipmentRow.carrier, total_cost: shipmentRow.total_cost },
        user,
        metadata:   { mode: shipmentRow.mode, via: copiedFrom ? 'copy' : 'manual', copiedFrom },
      });
    } catch (auditErr) {
      console.error('[shipments/create] history write failed:', auditErr.message);
    }
    res.status(201).json(row || shipmentRow);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/shipments/:id', async (req, res) => {
  const u = await verifyToken(req, res);
  if (!u) return;
  // REQ-04: only admin + planner can delete shipments.
  const roleD = getUserRole(u);
  if (!['admin', 'planner'].includes(roleD)) {
    return res.status(403).json({ error: `Role '${roleD}' cannot delete shipments. Required: admin, planner.` });
  }
  try {
    const shipId = req.params.id;
    // Mobile-bug 57: deleting a shipment must cascade — every order
    // that pointed at this shipment_id needs to drop back to
    // Unplanned with shipment_id=NULL. Without this the orders list
    // shows "Planned" rows that point at a non-existent shipment.
    // Read first so we know which orders to patch (and so we can log
    // the cascade in change_history per REQ-02).
    const linkedOrders = await dbSelect(
      'orders',
      `select=id,status&shipment_id=eq.${encodeURIComponent(shipId)}&limit=500`,
      null,
    ).catch(() => []);

    if (Array.isArray(linkedOrders) && linkedOrders.length) {
      const ids = linkedOrders.map((o) => o.id).filter(Boolean);
      if (ids.length) {
        const inFilter = ids.map((id) => encodeURIComponent(id)).join(',');
        const patchRes = await fetch(
          `${SUPABASE_URL}/rest/v1/orders?id=in.(${inFilter})`,
          {
            method: 'PATCH',
            headers: { ...sbHeaders(null), Prefer: 'return=minimal' },
            body: JSON.stringify({ shipment_id: null, status: 'Unplanned' }),
          },
        );
        if (!patchRes.ok) {
          // Don't fail the whole delete — surface a warning the UI can
          // log so an operator can fix the orphan(s) manually.
          console.error(
            `[shipments.delete] cascade patch failed (${patchRes.status}) for ${shipId}: ${await patchRes.text().catch(() => '')}`,
          );
        } else {
          // REQ-02: record each unassign so the audit trail shows why
          // the orders moved back to Unplanned.
          for (const ord of linkedOrders) {
            try {
              await history.recordChange({
                entityType: 'order',
                entityId:   ord.id,
                action:     'unassign',
                user:       u,
                metadata:   { previousShipmentId: shipId, reason: 'shipment-deleted' },
              });
            } catch (auditErr) {
              console.error('[shipments.delete] history failed:', auditErr.message);
            }
          }
        }
      }
    }

    // Use server-side key for shipment deletes to avoid client-role RLS failures.
    await dbDelete('shipments', shipId, null);

    // REQ-02: log the shipment delete itself.
    try {
      await history.recordChange({
        entityType: 'shipment',
        entityId:   shipId,
        action:     'delete',
        user:       u,
        metadata:   { unassignedOrderIds: (linkedOrders || []).map((o) => o.id) },
      });
    } catch (auditErr) {
      console.error('[shipments.delete] shipment history failed:', auditErr.message);
    }

    // REQ-01: tell SSE subscribers so the orders list updates without
    // a manual refresh.
    bus.emit(EVENTS.SHIPMENT_DELETED, { id: shipId, unassignedOrderIds: (linkedOrders || []).map((o) => o.id) });

    res.json({
      deleted: true,
      id: shipId,
      unassignedOrders: (linkedOrders || []).length,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get('/api/carriers',  async (req, res) => { const u = await verifyToken(req,res); if(!u) return; try { const rows = await dbSelect('carriers','select=*&order=name&limit=200',u._token); res.json({ carriers: rows, total: rows.length }); } catch(e){ res.status(500).json({error:e.message}); } });
app.get('/api/rates',     async (req, res) => { const u = await verifyToken(req,res); if(!u) return; try { const rows = await dbSelect('rates','select=*&order=lane&limit=500',u._token); res.json({ rates: rows, total: rows.length }); } catch(e){ res.status(500).json({error:e.message}); } });

// ── Tenants/config ─────────────────────────────────────────────────
app.get('/api/tenants/me', async (req, res) => {
  const u = await verifyToken(req, res); if (!u) return;
  res.json({ id:'zoree-default', brandName:'ZoreeTMS', tier:'enterprise', features:['*'] });
});
app.get('/api/tenants/tiers', (req, res) => res.json({ tiers:[
  { tier:'starter',    price:'$499/mo',   features:['orders','shipments','carriers'] },
  { tier:'pro',        price:'$1,499/mo', features:['orders','shipments','carriers','rate_management','analytics'] },
  { tier:'enterprise', price:'Custom',    features:['*'] },
]}));


// ── SMC3 CzarLite DEMOLTLA WO465640 ────────────────────────────────────────
// Correct schema from Swagger spec:
// - Headers: licenseKey, username, password, apiVersion: V2_0
// - Body: shipmentRequests[] with origin/destination objects + details[]

// ── Global SMC3 utilities (accessible outside IIFE) ──────────────────────────
function _smc3Auth() {
  return 'Basic ' + Buffer.from(SMC3_USERNAME + ':' + SMC3_PASSWORD).toString('base64');
}
function _smc3Headers(contentLength) {
  return {
    'Content-Type': 'application/json', 'Accept': 'application/json',
    'licenseKey': SMC3_LICENSE, 'username': SMC3_USERNAME,
    'password': SMC3_PASSWORD, 'apiVersion': 'V2_0',
    'Content-Length': contentLength
  };
}
function _ccxlHeaders(contentLength) {
  return {
    'Content-Type': 'application/json', 'Accept': 'application/json',
    'licenseKey': SMC3_CCXL_KEY, 'username': SMC3_USERNAME,
    'password': SMC3_PASSWORD, 'apiVersion': 'V3_0',
    'Content-Length': contentLength
  };
}
function _smc3Post(host, path, body, cb) {
  var https = require('https');
  var pl = JSON.stringify(body);
  var req = https.request({
    hostname: host, path: path, method: 'POST',
    headers: _smc3Headers(Buffer.byteLength(pl)),
    timeout: 30000,
  }, function(res) {
    var raw = '';
    res.on('data', function(c) { raw += c; });
    res.on('end', function() {
      try {
        var j = JSON.parse(raw);
        if (res.statusCode >= 400) cb(new Error('SMC3 ' + res.statusCode + ': ' + JSON.stringify(j).slice(0, 200)));
        else cb(null, j);
      } catch(e) { cb(new Error('SMC3 parse: ' + raw.slice(0, 100))); }
    });
  });
  req.on('timeout', function() { req.destroy(); cb(new Error('SMC3 timeout')); });
  req.on('error', function(e) { cb(e); });
  req.write(pl);
  req.end();
}

// ── SMC3 Global Constants (accessible to all routes) ─────────────────────────
var SMC3_TARIFF    = process.env.SMC3_TARIFF      || 'DEMOLTLA';
var SMC3_LICENSE   = process.env.SMC3_LICENSE_KEY;
var SMC3_CCXL_KEY  = process.env.SMC3_CCXL_KEY;
var SMC3_USERNAME  = process.env.SMC3_USERNAME;
var SMC3_PASSWORD  = process.env.SMC3_PASSWORD;
var SMC3_RW_HOST   = 'applications.smc3.com';
var SMC3_RW_BASE   = '/RateWareXL/services/rest/v2';
var SMC3_CC_HOST   = 'ccxl.smc3.com';
var SMC3_CC_BASE   = '/CarrierConnectXL/services/rest/v3';

(function() {
  var https = require('https');
  var SMC3_L = SMC3_LICENSE;
  var SMC3_U = SMC3_USERNAME;
  var SMC3_P = SMC3_PASSWORD;
  var SMC3_T = SMC3_TARIFF;
  var SMC3_HOST  = SMC3_RW_HOST;
  var SMC3_BASE  = SMC3_RW_BASE;
  var CCXL_HOST  = SMC3_CC_HOST;
  var CCXL_BASE  = SMC3_CC_BASE;
  var CCXL_L     = SMC3_CCXL_KEY;

  function smc3Headers(contentLength) {
    return {
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      'licenseKey':     SMC3_L,
      'username':       SMC3_U,
      'password':       SMC3_P,
      'apiVersion':     'V2_0',
      'Content-Length': contentLength
    };
  }

  // CarrierConnect XL uses different licenseKey + apiVersion V3_0
  function ccxlHeaders(contentLength) {
    return {
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      'licenseKey':     CCXL_L,
      'username':       SMC3_U,
      'password':       SMC3_P,
      'apiVersion':     'V3_0',
      'Content-Length': contentLength
    };
  }

  function ccxlPost(host, path, body, cb) {
    var pl = JSON.stringify(body);
    var req = https.request({
      hostname: host, path: path, method: 'POST',
      headers: ccxlHeaders(Buffer.byteLength(pl)),
      timeout: 30000,
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        try {
          var j = JSON.parse(raw);
          if (res.statusCode >= 400) cb(new Error('CCXL ' + res.statusCode + ': ' + JSON.stringify(j).slice(0, 200)));
          else cb(null, j);
        } catch(e) { cb(new Error('CCXL parse error: ' + raw.slice(0, 100))); }
      });
    });
    req.on('timeout', function() { req.destroy(); cb(new Error('CCXL timeout')); });
    req.on('error', function(e) { cb(e); });
    req.write(pl);
    req.end();
  }

  function ccxlGet(host, path, cb) {
    var https = require('https');
    var req = https.request({
      hostname: host, path: path, method: 'GET',
      headers: ccxlHeaders(0),
      timeout: 15000,
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        try {
          var j = JSON.parse(raw);
          if (res.statusCode >= 400) cb(new Error('CCXL GET ' + res.statusCode + ': ' + JSON.stringify(j).slice(0,200)));
          else cb(null, j);
        } catch(e) { cb(new Error('CCXL GET parse: ' + raw.slice(0,100))); }
      });
    });
    req.on('timeout', function() { req.destroy(); cb(new Error('CCXL GET timeout')); });
    req.on('error', function(e) { cb(e); });
    req.end();
  }
  global._ccxlGet = ccxlGet;

  function smc3Post(host, path, body, cb) {
    var pl = JSON.stringify(body);
    var req = https.request({
      hostname: host, path: path, method: 'POST',
      headers: smc3Headers(Buffer.byteLength(pl)),
      timeout: 30000
    }, function(res) {
      var raw = '';
      res.on('data', function(c) { raw += c; });
      res.on('end', function() {
        try {
          var j = JSON.parse(raw);
          if (res.statusCode >= 400) cb(new Error('SMC3 ' + res.statusCode + ': ' + JSON.stringify(j).slice(0, 200)));
          else cb(null, j);
        } catch(e) { cb(new Error('parse error: ' + raw.slice(0, 100))); }
      });
    });
    req.on('timeout', function() { req.destroy(); cb(new Error('SMC3 timeout')); });
    req.on('error', function(e) { cb(e); });
    req.write(pl);
    req.end();
  }

  function smc3Guard(req, res, next) {
    if (!req.headers.authorization) return res.status(401).json({ error: 'Missing token' });
    next();
  }

  function todayYMD() {
    var d = new Date();
    return d.getFullYear().toString() +
      ('0' + (d.getMonth() + 1)).slice(-2) +
      ('0' + d.getDate()).slice(-2);
  }

  // GET /api/smc3/status
  app.get('/api/smc3/status', smc3Guard, function(req, res) {
    res.json({ live: true, tariff: SMC3_TARIFF, workOrder: '465640', nodeVersion: process.version, apiVersion: 'V2_0' });
  });

  // POST /api/smc3/test — ATL(30301) → DAL(75201), 1000lb Class 70
  app.post('/api/smc3/test', smc3Guard, function(req, res) {
    var body = {
      shipmentRequests: [{
        origin:      { postalCode: '30301', country: 'USA', city: '', stateProvince: '' },
        destination: { postalCode: '75201', country: 'USA', city: '', stateProvince: '' },
        tariffName:          SMC3_TARIFF,
        tariffEffectiveDate: '20070703',
        details: [{ nmfcClass: '70', weight: 1000 }]
      }]
    };
    _smc3Post(SMC3_RW_HOST, SMC3_RW_BASE + '/ltlrateshipment', body, function(err, d) {
      if (err) { console.error('[SMC3/test]', err.message); return res.status(502).json({ ok: false, error: err.message }); }
      var shipments = d.shipmentResponses || d.shipmentResponse || d.shipmentRequests || [];
      var sr = (d.shipmentResponses && d.shipmentResponses[0]) || d;
      var t = sr.totalCharge || sr.totalAmount || 0;
      var l = sr.lineHaulGrossCharge || sr.linehaulCharge || sr.baseCharge || 0;
      var f = sr.surchargeAmount || sr.fuelSurcharge || sr.fuelCharge || 0;
      var a = sr.accessorialCharge || 0;
      console.log('[SMC3/test] SUCCESS $' + Math.round(t));
      res.json({ ok: true, message: 'SMC3 CzarLite LIVE', tariff: SMC3_TARIFF, testRate: Math.round(t), linehaul: Math.round(l), fuel: Math.round(f), acc: Math.round(a), raw: d, shipmentResponse: sr });
    });
  });

  // POST /api/smc3/rate — LTL rate lookup
  app.post('/api/smc3/rate', smc3Guard, function(req, res) {
    var o = req.body.originPostalCode, d = req.body.destinationPostalCode;
    var w = req.body.weight || 1000, fc = req.body.freightClass || 70;
    var tn = req.body.tariffName || SMC3_TARIFFARIFF;
    if (!o || !d) return res.status(400).json({ error: 'originPostalCode + destinationPostalCode required' });
    var body = {
      shipmentRequests: [{
        origin:      { postalCode: o, country: 'USA', city: '', stateProvince: '' },
        destination: { postalCode: d, country: 'USA', city: '', stateProvince: '' },
        tariffName:          tn,
        tariffEffectiveDate: '20070703',  // DEMOLTLA
        details: [{ nmfcClass: String(fc), weight: Math.round(w) }]
      }]
    };
    _smc3Post(SMC3_RW_HOST, SMC3_RW_BASE + '/ltlrateshipment', body, function(err, data) {
      if (err) return res.status(502).json({ error: err.message, source: 'smc3' });
      var shipments = data.shipmentResponses || data.shipmentResponse || [];
      var r = Array.isArray(shipments) && shipments.length ? shipments[0] : data;
      var l = r.linehaulCharge || r.baseCharge || 0;
      var f = r.fuelSurcharge || r.fuelCharge || 0;
      var a = r.accessorialCharge || r.accessorials || 0;
      var t = r.totalCharge || r.totalAmount || (l + f + a);
      var bw = r.billedWeight || w;
      console.log('[SMC3/rate]', o, '->', d, '$' + Math.round(t));
      res.json({ source: 'smc3', tariff: tn, linehaul: Math.round(l), fuel: Math.round(f), acc: Math.round(a), total: Math.round(t), billedWeight: bw, ratePerCwt: bw > 0 ? (l / (bw / 100)).toFixed(2) : '0', raw: d, shipmentResponse: srata });
    });
  });

  // POST /api/smc3/transit — CarrierConnect XL
  app.post('/api/smc3/transit', smc3Guard, function(req, res) {
    var o = req.body.originPostalCode, d = req.body.destinationPostalCode;
    var sc = req.body.scacs || [];
    if (!o || !d) return res.status(400).json({ error: 'originPostalCode + destinationPostalCode required' });

    // CarrierConnect XL v3 schema: carriers[], origin/destination with countryCode, pickupDate CCYY-MM-DD
    var today = new Date();
    var pickupDate = today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);

    var carriers = sc.length > 0
      ? sc.map(function(scac){ return { serviceCode:'', serviceMethod:'LTL', serviceType:'ALL_AVAILABLE', SCAC: scac }; })
      : [{ serviceCode:'', serviceMethod:'LTL', serviceType:'ALL_AVAILABLE', SCAC:'' }];

    var body = {
      carriers: carriers,
      origin:      { postalCode: o, countryCode: 'USA' },
      destination: { postalCode: d, countryCode: 'USA' },
      pickupDate:  pickupDate
    };

    ccxlPost(CCXL_HOST, CCXL_BASE + '/transit', body, function(err, data) {
      if (err) return res.status(502).json({ error: err.message, source: 'smc3' });

      // CCXL v3 response: { carriers: [{ carrierServiceDetail, transitDays, serviceDetail, ... }] }
      var rows = data.carriers || (Array.isArray(data) ? data : []);
      var carriers = rows.map(function(c) {
        // CCXL v3: carrierServiceDetail has SCAC, carrierName; transitDays at top level
        var csd = c.carrierServiceDetail || {};
        var sd  = c.serviceDetail || {};
        return {
          scac:         csd.SCAC          || c.scac          || '',
          carrierName:  csd.carrierName   || c.carrierName   || '',
          serviceMethod: csd.serviceMethod || 'LTL',
          serviceType:  csd.serviceType   || '',
          transitDays:  c.transitDays     || null,
          originService: sd.origin        || '',
          destService:  sd.destination    || '',
        };
      }).filter(function(c) { return c.transitDays != null && c.scac; });
      console.log('[CCXL/transit]', o, '->', d, '-', carriers.length, 'carriers');
      res.json({ source: 'smc3', carriers: carriers, raw: data });
    });
  });

  console.log('  SMC3 CzarLite LIVE - DEMOLTLA - apiVersion V2_0 - WO 465640');

  // Expose CCXL internals for use in outer-scope routes (e.g. /api/ltl/quote Step 5)
  global._ccxlPost = ccxlPost;
  global._CCXL_HOST = CCXL_HOST;
  global._CCXL_BASE = CCXL_BASE;
  global._CCXL_L    = CCXL_L;
})();


// No startup SCAC fetch — all czarlite carriers sent to CCXL, FAIL handled per-row

// ── GET /api/ccxl/carriers — List carriers licensed under your CCXL account ────
app.get('/api/ccxl/carriers', async (req, res) => {
  try {
    _ccxlGet(_CCXL_HOST, _CCXL_BASE + '/carrierServices', (err, data) => {
      if (err) return res.status(502).json({ error: err.message });
      res.json(data);
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ltl/quote — LTL quoting: CzarLite base + carrier adder ──────────
// Works for ANY lane. Carriers are czarlite_enabled in the carriers table.
// Carrier-specific adder comes from rates table if exists, else returns base only.
app.post('/api/ltl/quote', async (req, res) => {
  const user = await verifyTokenSoft(req);

  const {
    originZip, destZip, weight, freightClass, originCity, destCity,
    // Optional country context for match_type='country_to_country' rates.
    // Defaults to 'USA' if caller omits — preserves behavior for existing
    // planning surfaces that don't yet pass country codes.
    originCountry: rawOriginCountry,
    destCountry:   rawDestCountry,
  } = req.body;
  if (!originZip || !destZip) return res.status(400).json({ error: 'originZip + destZip required' });
  const originCountry = (rawOriginCountry || 'USA').toUpperCase();
  const destCountry   = (rawDestCountry   || 'USA').toUpperCase();

  const wt = Math.round(weight || 1000);
  const fc = freightClass || 70;

  // Step 1: Get all czarlite_enabled carriers from carriers table
  let czCarriers = [];
  try {
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/carriers?czarlite_enabled=eq.true&status=eq.Active&select=id,name,scac,mode,carrierconnect_enabled`, {
      headers: sbHeaders(null)
    });
    if (cr.ok) czCarriers = await cr.json();
  } catch(e) { console.error('[LTL/quote] carriers error:', e.message); }

  console.log('[LTL/quote] REQUEST → weight:'+wt+'lbs freightClass:'+fc+' origin:'+originZip+'→'+destZip);
  console.log('[LTL/quote] czarlite_enabled carriers from DB:', czCarriers.map(c=>c.scac||c.name));
  if (!czCarriers.length) return res.status(200).json({ originZip, destZip, weight: wt, freightClass: fc, czarliteBase: null, quotes: [] });

  // Step 2: Get CzarLite base rate for this lane
  let czarBase = null;
  try {
    const czBody = {
      shipmentRequests: [{
        origin:      { postalCode: originZip, country: 'USA', city: originCity || '', stateProvince: '' },
        destination: { postalCode: destZip,   country: 'USA', city: destCity   || '', stateProvince: '' },
        tariffName:          SMC3_TARIFF,
        tariffEffectiveDate: '20070703',
        details: [{ nmfcClass: String(fc), weight: wt }]
      }]
    };
    czarBase = await new Promise((resolve, reject) => {
      _smc3Post(SMC3_RW_HOST, SMC3_RW_BASE + '/ltlrateshipment', czBody, function(err, data) {
        if (err) return reject(err);
        const sr = (data.shipmentResponses && data.shipmentResponses[0]) || data;
        resolve({
          totalCharge:         parseFloat(sr.totalCharge)         || 0,
          lineHaulGrossCharge: parseFloat(sr.lineHaulGrossCharge) || 0,
          surchargeAmount:     parseFloat(sr.surchargeAmount)     || 0,
          billedWeight:        parseFloat(sr.billedWeight)        || wt,
          actualWeight:        parseFloat(sr.actualWeight)        || wt,
          tblno:               sr.tblno  || '',
          rbno:                sr.rbno   || '',
          effectiveDate:       sr.effectiveDate || '',
          raw: sr
        });
      });
    });
    console.log('[LTL/quote] CzarLite base: $'+czarBase.totalCharge+' billedWeight:'+czarBase.billedWeight+'lbs', originZip, '->', destZip);
  } catch(e) {
    console.error('[LTL/quote] CzarLite error:', e.message);
    return res.status(502).json({ error: 'CzarLite error: ' + e.message, source: 'smc3' });
  }

  const baseTotal  = czarBase.totalCharge;
  const billedCwt  = czarBase.billedWeight / 100;

  // ZIP → city map for lane matching
  const ZIP_CITY = {
    // Houston
    '77001':'Houston','77002':'Houston','77003':'Houston','77004':'Houston',
    '77005':'Houston','77006':'Houston','77007':'Houston','77008':'Houston',
    '77009':'Houston','77010':'Houston','77011':'Houston','77019':'Houston',
    '77020':'Houston','77025':'Houston','77030':'Houston','77056':'Houston',
    // Dallas
    '75201':'Dallas','75202':'Dallas','75203':'Dallas','75204':'Dallas',
    '75205':'Dallas','75206':'Dallas','75207':'Dallas','75208':'Dallas',
    '75209':'Dallas','75210':'Dallas','75211':'Dallas','75212':'Dallas',
    '75214':'Dallas','75215':'Dallas','75216':'Dallas','75217':'Dallas',
    '75218':'Dallas','75219':'Dallas','75220':'Dallas','75221':'Dallas',
    '75222':'Dallas','75223':'Dallas','75224':'Dallas','75225':'Dallas',
    '75226':'Dallas','75227':'Dallas','75228':'Dallas','75229':'Dallas',
    '75230':'Dallas','75231':'Dallas','75232':'Dallas','75233':'Dallas',
    '75234':'Dallas','75235':'Dallas','75236':'Dallas','75237':'Dallas',
    '75238':'Dallas','75240':'Dallas','75241':'Dallas','75242':'Dallas',
    '75243':'Dallas','75244':'Dallas','75246':'Dallas','75247':'Dallas',
    '75248':'Dallas','75249':'Dallas','75251':'Dallas','75252':'Dallas',
    '75253':'Dallas','75254':'Dallas','75270':'Dallas','75287':'Dallas',
    // Chicago
    '60601':'Chicago','60602':'Chicago','60603':'Chicago','60604':'Chicago',
    '60605':'Chicago','60606':'Chicago','60607':'Chicago','60608':'Chicago',
    '60610':'Chicago','60611':'Chicago','60614':'Chicago','60616':'Chicago',
    // Atlanta
    '30301':'Atlanta','30302':'Atlanta','30303':'Atlanta','30304':'Atlanta',
    '30305':'Atlanta','30306':'Atlanta','30307':'Atlanta','30308':'Atlanta',
    '30309':'Atlanta','30310':'Atlanta','30312':'Atlanta','30318':'Atlanta',
    // New York
    '10001':'New York','10002':'New York','10003':'New York','10004':'New York',
    '10005':'New York','10006':'New York','10007':'New York','10010':'New York',
    '10011':'New York','10012':'New York','10013':'New York','10014':'New York',
    // Others
    '43201':'Columbus','38101':'Memphis','85001':'Phoenix','80201':'Denver',
    '90001':'Los Angeles','90012':'Los Angeles','90015':'Los Angeles',
    '98101':'Seattle','28201':'Charlotte','02101':'Boston',
    '33101':'Miami','33132':'Miami','95101':'San Jose','94041':'Mountain View',
  };
  // Handle cases where city string contains zip e.g. 'Dallas, TX, 75207'
  function _extractZipFromCity(cityStr) {
    if(!cityStr) return null;
    const m = cityStr.match(/(\d{5})/);
    return m ? m[1] : null;
  }
  function _stripZipFromCity(cityStr) {
    return cityStr ? cityStr.replace(/,?\s*\d{5}/, '').trim() : cityStr;
  }
  const effectiveOriginZip = _extractZipFromCity(originCity) || originZip;
  const effectiveDestZip   = _extractZipFromCity(destCity)   || destZip;
  const cleanOriginCity = _stripZipFromCity(originCity) || originCity;
  const cleanDestCity   = _stripZipFromCity(destCity)   || destCity;
  const originCityName = cleanOriginCity || ZIP_CITY[effectiveOriginZip] || originZip;
  const destCityName   = cleanDestCity   || ZIP_CITY[effectiveDestZip]   || destZip;

  // Step 3: Load LTL rates — filter by origin+dest city; czarlite check is at carrier level (czCarriers)
  const oCity = originCityName.toLowerCase().split(',')[0].trim();
  const dCity = destCityName.toLowerCase().split(',')[0].trim();
  let adderRates = [];
  try {
    // Pull candidate rates for this lane. We don't pre-filter on city
    // here (beyond mode+status) because the matcher evaluates each
    // rate's match_type — a 'zip_to_zip' or 'country_to_country' rate
    // may have origin/dest strings that don't contain the shipment's
    // city. Filtering client-side (in the matcher) is fine: the
    // rates table is small (tens to hundreds of rows per carrier).
    const rr = await fetch(
      `${SUPABASE_URL}/rest/v1/rates?mode=eq.LTL&status=eq.Active&select=` +
        'carrier,origin,dest,discount,discount_flat,fsc,lane,service_level,' +
        'transit_days,' +
        // New columns from migration 021 — match_type + structured geo.
        'match_type,origin_zip,dest_zip,origin_country,dest_country,' +
        // Migration 024: trailer this rate was negotiated against.
        'equipment',
      { headers: sbHeaders(null) }
    );
    if (rr.ok) adderRates = await rr.json();
    // Only keep rates for carriers with czarlite_enabled
    const czCarrierNames = new Set(czCarriers.map(c => c.name));
    adderRates = adderRates.filter(r => czCarrierNames.has(r.carrier));
    console.log('[LTL/quote] Lane rates found:', adderRates.length, adderRates.map(r=>r.carrier+'|disc='+r.discount));
  } catch(e) { console.error('[LTL/quote] rates error:', e.message); }

  // Step 4: One quote per carrier.
  // Rate matching is delegated to api/services/ltlRateMatcher — see
  // that module for match_type semantics (city_to_city / zip_to_zip /
  // country_to_country) and the carrier-level fallback rule.
  // Pricing formula: CzarLite base × (1 - discount%) + FSC% on
  // discounted base = total.
  const quotes = [];

  const shipmentCtx = {
    originCity:    oCity,
    destCity:      dCity,
    originZip:     effectiveOriginZip,
    destZip:       effectiveDestZip,
    originCountry,
    destCountry,
  };

  // Build one LTL quote object from a (possibly null) rate row.
  // Extracted so we can call it once per matched rate when a carrier
  // has multiple service levels (Standard + Express, etc.) on the
  // same lane, AND once with `null` for the CzarLite-only fallback
  // path when no rate row matched at all.
  function buildLtlQuote(carrier, r, matchReason) {
    const discountPct  = r ? (parseFloat(r.discount)      || 0) : 0;
    const discountFlat = r ? (parseFloat(r.discount_flat) || 0) : 0;
    const discountAmt  = Math.round(baseTotal * discountPct / 100) + discountFlat;
    const discountedBase = Math.max(0, baseTotal - discountAmt);

    const fscPct    = r && r.fsc ? parseFloat((r.fsc || '0%').replace('%','')) / 100 : 0;
    const fscCharge = r && r.fsc
      ? Math.round(discountedBase * fscPct)
      : Math.round(czarBase.surchargeAmount || 0);
    const total = Math.round(discountedBase + fscCharge);

    console.log(`[LTL/quote] ${carrier.name}: base=$${baseTotal} disc=${discountPct}% amt=$${discountAmt} discBase=$${discountedBase} fsc=$${fscCharge} total=$${total} rateMatch=${r?r.lane:'NONE'} reason=${matchReason}`);
    return {
      rateId:       r ? (r.lane || r.id) : null,
      carrier:      carrier.name,
      scac:         carrier.scac,
      mode:         'LTL',
      // Migration 024/025: surface the trailer the matched rate was
      // negotiated against so the planner can snapshot it onto the
      // shipment row at execute time.
      equipment:    (r && r.equipment) || 'LTL',
      serviceLevel: (r && r.service_level) || 'Standard',
      transitDays:  (r && r.transit_days) || null,
      deliveryDate: null,
      czarBase:     Math.round(discountedBase),
      czarBaseGross:Math.round(baseTotal),
      discountPct:  discountPct,
      discountFlat: discountFlat,
      discountAmt:  Math.round(discountAmt),
      czarLinehaul: Math.round(czarBase.lineHaulGrossCharge),
      czarFuel:     Math.round(czarBase.surchargeAmount),
      billedWeight: czarBase.billedWeight,
      fscPct:       r ? (r.fsc || '0%') : '0%',
      fscCharge,
      totalCharge:  total,
      origin:       originCity || originZip,
      destination:  destCity   || destZip,
      tariff:       SMC3_TARIFF,
      class:        fc,
      weight:       wt,
    };
  }

  czCarriers.forEach(carrier => {
    const carrierRates = adderRates.filter(r => r.carrier === carrier.name);
    const match = matchAllRates(shipmentCtx, carrierRates);

    if (match.rates.length === 0) {
      // No specific rate matched but weight didn't fail either — this
      // carrier still gets a CzarLite-only quote (legacy behavior).
      quotes.push(buildLtlQuote(carrier, null, match.reason));
      return;
    }

    // One quote per matching rate so a carrier with both Standard and
    // Express tariffs on this lane shows up twice.
    match.rates.forEach(({ rate, reason }) => {
      quotes.push(buildLtlQuote(carrier, rate, reason));
    });
  });

  // Step 5: Batch CarrierConnect® XL transit — one call for all carrier SCACs
  const scacsToFetch = quotes.filter(q => q.scac).map(q => q.scac);
  console.log('[LTL/quote] SCACs for CarrierConnect:', scacsToFetch);

  if (scacsToFetch.length > 0) {
    try {
      const today = new Date();
      const pickupRaw = req.body.pickupDate;
      let pickupDate;
      if (pickupRaw && /^\d{8}$/.test(pickupRaw)) {
        pickupDate = pickupRaw.slice(0,4)+'-'+pickupRaw.slice(4,6)+'-'+pickupRaw.slice(6,8);
      } else {
        pickupDate = today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);
      }

      const ccBody = {
        carriers: scacsToFetch.map(scac => ({
          serviceCode: '', serviceMethod: 'LTL', serviceType: 'ALL_AVAILABLE', SCAC: scac
        })),
        origin:      { postalCode: originZip, countryCode: 'USA' },
        destination: { postalCode: destZip,   countryCode: 'USA' },
        pickupDate:  pickupDate
      };

      console.log('[LTL/quote] Calling CarrierConnect:', JSON.stringify(ccBody).slice(0,300));

      const ccData = await new Promise((resolve, reject) => {
        _ccxlPost(_CCXL_HOST, _CCXL_BASE + '/transit', ccBody, (err, data) => {
          if (err) reject(err); else resolve(data);
        });
      });

      const ccRows = ccData.carriers || (Array.isArray(ccData) ? ccData : []);
      console.log('[LTL/quote] CarrierConnect returned', ccRows.length, 'rows');
      console.log('[LTL/quote] CarrierConnect RAW first row:', JSON.stringify(ccRows[0]||{}));

      // Build SCAC → { transitDays, deliveryDate } map
      // Skip entries with FAIL status or zero transit days
      const transitMap = {};
      ccRows.forEach(c => {
        const csd    = c.carrierServiceDetail || {};
        const scac   = csd.SCAC || c.scac || '';
        const status = (c.messageStatus && c.messageStatus.status) || 'PASS';
        const days   = c.transitDays || c.standardTransitDays || 0;
        if (!scac || transitMap[scac]) return;  // skip duplicates
        if (status === 'FAIL' || !days) return;  // skip unlicensed/no-data
        transitMap[scac] = {
          transitDays:  days,
          deliveryDate: c.deliveryDate || c.estimatedDeliveryDate || null,
        };
      });

      console.log('[LTL/quote] Transit map:', JSON.stringify(transitMap));

      // Merge transit days into quotes:
      // - CC enabled → use CC only. If CC fails/unlicensed → no transit shown
      // - CC disabled → use rate record transit_days from TMS
      quotes.forEach(q => {
        const carrier = czCarriers.find(c => c.scac === q.scac);
        const ccEnabled = carrier && carrier.carrierconnect_enabled;
        if (ccEnabled) {
          // CC is enabled — only use CC result, no TMS fallback
          if (q.scac && transitMap[q.scac]) {
            q.transitDays  = transitMap[q.scac].transitDays;
            q.deliveryDate = transitMap[q.scac].deliveryDate;
            q._ccLive      = true;
          } else {
            // CC enabled but no data returned (unlicensed/FAIL) — show nothing
            q.transitDays  = null;
            q.deliveryDate = null;
            q._ccLive      = false;
            q._ccFailed    = true;  // flag so UI can show 'CC unlicensed'
          }
        } else {
          // CC not enabled — use rate record transit_days from TMS
          const rateRec = adderRates.find(r => r.id == q.rateId);
          if (rateRec && rateRec.transit_days) {
            q.transitDays = rateRec.transit_days;
          }
          q._ccLive = false;
        }
      });

      console.log('[LTL/quote] CarrierConnect enriched', Object.keys(transitMap).length, 'of', scacsToFetch.length, 'carriers');
    } catch (ccErr) {
      console.warn('[LTL/quote] CarrierConnect failed (non-fatal):', ccErr.message, ccErr.stack||'');
      // Flag all CC-enabled quotes so downstream knows CC API errored (not carrier-specific rejection)
      quotes.forEach(q => {
        const carrier = czCarriers.find(c => c.scac === q.scac);
        if (carrier && carrier.carrierconnect_enabled) {
          q._ccApiError = true;
        }
      });
    }
  }

  quotes.sort((a, b) => a.totalCharge - b.totalCharge);

  console.log('[LTL/quote]', quotes.length, 'quotes for', originZip, '->', destZip);
  res.json({
    originZip, destZip, weight: wt, freightClass: fc,
    czarliteBase: czarBase,
    quotes,
    generatedAt: new Date().toISOString()
  });
});


// ── GET /api/ltl/rates — All active LTL rates with czarlite flag ──────────────
app.get('/api/ltl/rates', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/rates?mode=eq.LTL&select=*&order=carrier', {
      headers: sbHeaders(null)
    });
    const data = await r.json();
    res.json({ rates: data });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// (404 catch-all moved to end of file, after all route definitions)

// ── Start ──────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════════════════════════
// SMC³ RateWareXL 2.0 + CarrierConnect XL 3.x — SECURE SERVER PROXY
// WO 465640 — LIVE as of 2026-03-18
// Credentials stored server-side only. Browser never sees password/licenseKey.
// ══════════════════════════════════════════════════════════════════════════════

const SMC3 = {
  licenseKey:     process.env.SMC3_LICENSE_KEY,
  ccxlLicenseKey: process.env.SMC3_CCXL_KEY,
  username:       process.env.SMC3_USERNAME,
  password:       process.env.SMC3_PASSWORD,
  tariff:         process.env.SMC3_TARIFF || 'DEMOLTLA',
  rateware:       'https://applications.smc3.com/RateWareXL/services/rest/v2',
  ccxl:           'https://ccxl.smc3.com/CarrierConnectXL/services/rest/v3',
};

function smc3Auth(){
  return 'Basic ' + Buffer.from(SMC3.username + ':' + SMC3.password).toString('base64');
}
function todayYMD(){
  const d = new Date();
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}
async function smc3Call(baseUrl, path, body){
  // Determine apiVersion based on whether this is CCXL or RateWare
  const isCCXL = baseUrl.includes('ccxl');
  const apiVer = isCCXL ? 'V3_0' : 'V2_0';
  const lk = isCCXL ? SMC3.ccxlLicenseKey : SMC3.licenseKey;
  const r = await fetch(baseUrl + path, {
    method:  'POST',
    headers: {
      'Authorization': smc3Auth(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'licenseKey': lk,
      'username': SMC3.username,
      'password': SMC3.password,
      'apiVersion': apiVer,
    },
    body:    JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`SMC3 ${r.status}: ${JSON.stringify(data).slice(0,200)}`);
  return data;
}

// ── POST /api/smc3/rate  ─ CzarLite LTL rate ─────────────────────────────────
app.post('/api/smc3/rate', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const { originPostalCode, destinationPostalCode, weight, freightClass,
            tariffName, shipmentDateCCYYMMDD, commodities } = req.body;

    const data = await smc3Call(SMC3.rateware, '/ltlrateshipment', {
      tariffName:            tariffName           || SMC3.tariff,
      shipmentDateCCYYMMDD:  shipmentDateCCYYMMDD || todayYMD(),
      originPostalCode,      originCountry: 'USA',
      destinationPostalCode, destinationCountry: 'USA',
      commodities: commodities ||
        [{ freightClass: String(freightClass || 85), weight: Math.round(weight || 1000) }],
    });

    const linehaul   = data.linehaulCharge    || data.baseCharge   || 0;
    const fuel       = data.fuelSurcharge     || data.fuelCharge   || 0;
    const acc        = data.accessorialCharge || data.accessorials || 0;
    const total      = data.totalCharge       || data.totalAmount  || (linehaul+fuel+acc);
    const billedWt   = data.billedWeight      || weight            || 1000;
    const ratePerCwt = billedWt > 0 ? (linehaul/(billedWt/100)).toFixed(2) : '0';

    console.log(`[SMC3/rate] ${originPostalCode}→${destinationPostalCode} class${freightClass} ${weight}lb → $${Math.round(total)}`);
    res.json({ source:'smc3', tariff:SMC3.tariff, linehaul, fuel, acc,
               total: Math.round(total), billedWeight: billedWt, ratePerCwt, raw: d, shipmentResponse: srata });
  } catch(e) {
    console.error('[SMC3/rate]', e.message);
    res.status(502).json({ error: e.message, source:'smc3' });
  }
});

// ── POST /api/smc3/transit  ─ CarrierConnect XL transit time ─────────────────
app.post('/api/smc3/transit', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const { originPostalCode, destinationPostalCode, shipmentDateCCYYMMDD, scacs } = req.body;

    const data = await smc3Call(SMC3.ccxl, '/transit', {
      originPostalCode, originCountry: 'USA',
      destinationPostalCode, destinationCountry: 'USA',
      shipmentDateCCYYMMDD: shipmentDateCCYYMMDD || todayYMD(),
      method: 'LTL',
      scacs:  scacs || [],
    });

    const rows = data.transitList || data.transit || (Array.isArray(data) ? data : []);
    const carriers = rows.map(c => ({
      scac:         c.scac        || c.carrierCode || '',
      carrierName:  c.carrierName || '',
      transitDays:  c.transitDays || c.standardTransitDays || c.days || null,
      deliveryDate: c.deliveryDate|| c.estimatedDeliveryDate || '',
    })).filter(c => c.transitDays != null);

    console.log(`[SMC3/transit] ${originPostalCode}→${destinationPostalCode} → ${carriers.length} carriers`);
    res.json({ source:'smc3', carriers, raw: d, shipmentResponse: srata });
  } catch(e) {
    console.error('[SMC3/transit]', e.message);
    res.status(502).json({ error: e.message, source:'smc3' });
  }
});

// ── POST /api/smc3/classify  ─ Freight class lookup ──────────────────────────
app.post('/api/smc3/classify', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const data = await smc3Call(SMC3.rateware, '/classifyCommodity', {
      tariffName: SMC3.tariff,
      items: [req.body],
    });
    res.json({ source:'smc3', ...data });
  } catch(e) {
    console.error('[SMC3/classify]', e.message);
    res.status(502).json({ error: e.message, source:'smc3' });
  }
});

// ── GET /api/smc3/status  ─────────────────────────────────────────────────────
app.get('/api/smc3/status', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  res.json({
    live: true, workOrder: '465640',
    licenseKey: SMC3.licenseKey, username: SMC3.username,
    hasPassword: !!SMC3.password, tariff: SMC3.tariff,
    rateware: SMC3.rateware, ccxl: SMC3.ccxl,
  });
});

// ── POST /api/smc3/test  ─ Live connection test ───────────────────────────────
app.post('/api/smc3/test', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    // ATL(30301) → DAL(75201), 1000lb, Class 70
    const data = await smc3Call(SMC3.rateware, '/ltlrateshipment', {
      tariffName: SMC3.tariff, shipmentDateCCYYMMDD: todayYMD(),
      originPostalCode: '30301', originCountry: 'USA',
      destinationPostalCode: '75201', destinationCountry: 'USA',
      commodities: [{ freightClass: '70', weight: 1000 }],
    });
    const total = data.totalCharge || data.totalAmount || 0;
    console.log('[SMC3/test] LIVE — ATL→DAL $' + total);
    res.json({ ok: true, message: 'SMC3 CzarLite LIVE ✅', testRate: Math.round(total), tariff: SMC3.tariff });
  } catch(e) {
    console.error('[SMC3/test]', e.message);
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BULK PLANNING WORKBENCH — OTM-style batch rate + execute
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /api/bulk-plan/rate — Rate all lanes in batch via CzarLite ──────────
app.post('/api/bulk-plan/rate', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const { lanes, optimizeBy, includeModes } = req.body;
    if (!lanes || !lanes.length) return res.status(400).json({ error: 'lanes[] required' });
    const ratesVersion = await getRatesVersionStamp();

    // Check if lane_preferences parameter is enabled.
    // Must include Authorization (service_role) — bare apikey runs as
    // anon and RLS on planning_parameters / lane_preferences returns []
    // silently, which made lane prefs never apply.
    let useLanePreferences = false;
    let lanePrefs = [];
    try {
      const ppRes = await fetch(`${SUPABASE_URL}/rest/v1/planning_parameters?key=eq.lane_preferences&select=enabled`, {
        headers: sbHeaders(null),
      });
      const ppData = await ppRes.json();
      if (Array.isArray(ppData) && ppData.length > 0) {
        useLanePreferences = !!ppData[0].enabled;
      }
      if (useLanePreferences) {
        const lpRes = await fetch(`${SUPABASE_URL}/rest/v1/lane_preferences?status=eq.Active&select=*`, {
          headers: sbHeaders(null),
        });
        const lpData = await lpRes.json();
        if (Array.isArray(lpData)) lanePrefs = lpData;
        console.log(`[BulkPlan/rate] Lane preferences enabled — ${lanePrefs.length} active rules loaded`);
      } else {
        console.log('[BulkPlan/rate] Lane preferences disabled — skipping');
      }
    } catch (e) { console.warn('[BulkPlan/rate] planning_parameters load error:', e.message); }

    // Load carriers table once for carrierconnect_enabled flag
    let carrierFlags = {};
    try {
      const cfRes = await fetch(`${SUPABASE_URL}/rest/v1/carriers?select=name,scac,czarlite_enabled,carrierconnect_enabled,pcmiler_enabled&limit=200`, {
        headers: { 'apikey': SERVICE_KEY },
      });
      const cfData = await cfRes.json();
      if (Array.isArray(cfData)) {
        cfData.forEach(c => {
          const key = (c.name || '').toUpperCase();
          carrierFlags[key] = { czarlite: c.czarlite_enabled, ccxl: c.carrierconnect_enabled, pcmiler: c.pcmiler_enabled, scac: c.scac };
          if (c.scac) carrierFlags[c.scac.toUpperCase()] = carrierFlags[key];
        });
      }
    } catch(e) { console.warn('[BulkPlan] carrier flags load error:', e.message); }

    // Resolve the LTL ceiling once per request from equipment_types.LTL.max_weight.
    // No hardcoded fallback — a missing/inactive LTL row is a misconfiguration
    // we want to surface, not silently mask with the legacy 15000 constant.
    let LTL_MAX;
    try {
      LTL_MAX = await getLtlMaxWeight();
    } catch (e) {
      console.error('[BulkPlan/rate] equipment_types LTL ceiling unavailable:', e.message);
      return res.status(503).json({
        error: 'Equipment limits unavailable — equipment_types.LTL.max_weight is missing or unreachable.',
        detail: e.message,
      });
    }
    console.log(`[BulkPlan/rate] LTL ceiling sourced from equipment_types: ${LTL_MAX} lb`);

    let cacheHits = 0;
    let cacheMisses = 0;
    const extractCity = (str) => (str || '')
      .replace(/\d{5}/g, '')
      .split(',')[0]
      .replace(/\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$/i, '')
      .trim()
      .toLowerCase();
    const normalizedGlobalModes = Array.isArray(includeModes)
      ? includeModes.map((m) => String(m || '').toUpperCase()).filter(Boolean)
      : null;

    const results = await Promise.allSettled(lanes.map(async (lane) => {
      const { laneKey, originZip, destZip, totalWeight, freightClass, orderIds } = lane;
      const fc = String(freightClass || 70);
      const wt = Math.round(totalWeight || 1000);
      // LTL_MAX resolved once per request above from equipment_types.LTL.max_weight.
      const loadType = wt >= 35000 ? 'Full TL' : wt >= LTL_MAX ? 'Partial TL' : 'LTL';
      const laneModes = Array.isArray(lane.includeModes)
        ? lane.includeModes.map((m) => String(m || '').toUpperCase()).filter(Boolean)
        : normalizedGlobalModes;
      const allowedModes = laneModes && laneModes.length ? laneModes : ['LTL', 'TL'];
      const wantsLtl = allowedModes.includes('LTL');
      const wantsTl = allowedModes.includes('TL');
      const laneCacheKey = {
        ratesVersion,
        optimizeBy: optimizeBy === 'transit' ? 'transit' : 'cost',
        includeModes: allowedModes.slice().sort().join(','),
        laneKey: String(laneKey || ''),
        originZip: String(originZip || ''),
        destZip: String(destZip || ''),
        freightClass: fc,
        totalWeight: wt,
        orderCount: Array.isArray(orderIds) ? orderIds.length : 0,
      };
      const cachedLane = laneQuoteCache.get(laneCacheKey);
      if (cachedLane) {
        cacheHits += 1;
        return cachedLane;
      }
      cacheMisses += 1;
      const quotes = [];

      // Always fetch LTL rates (CzarLite + CCXL) unless weight exceeds LTL max
      if (wantsLtl && wt <= LTL_MAX) {
        try {
          const ltlRes = await fetch(`http://localhost:${PORT || 3001}/api/ltl/quote`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': req.headers.authorization || '',
            },
            body: JSON.stringify({
              originZip, destZip, weight: wt, freightClass: fc,
              // Forward the lane's full origin / destination strings so
              // the downstream /api/ltl/quote can run its city_to_city
              // rate match. Without these, ctx.originCity falls back to
              // the ZIP, normCity() strips digits to '', and every
              // city_to_city rate silently misses.
              originCity:    lane.origin,
              destCity:      lane.destination,
              originCountry: lane.originCountry || 'USA',
              destCountry:   lane.destCountry   || 'USA',
            }),
          });
          const ltlData = await ltlRes.json();
          if (ltlData.quotes && Array.isArray(ltlData.quotes)) {
            ltlData.quotes.forEach((q) => {
              quotes.push({
                carrier: q.carrier || 'Unknown',
                scac: q.scac || '',
                rateId: q.rateId || null,
                totalCharge: Math.round(q.totalCharge || 0),
                czarBaseGross: Math.round(q.czarBaseGross || 0),
                discountPct: Math.round(q.discountPct || 0),
                fscCharge: Math.round(q.fscCharge || 0),
                fscPct: parseFloat(q.fscPct || 0),
                transitDays: q.transitDays || null,
                deliveryDate: q.deliveryDate || '',
                recommended: false,
                mode: 'LTL',
                serviceLevel: q.serviceLevel || '',
                // Migration 024/025: forward equipment from /api/ltl/quote.
                equipment: q.equipment || 'LTL',
              });
            });
          }
          console.log(`[BulkPlan/rate] LTL via /api/ltl/quote: ${originZip}→${destZip}, ${quotes.length} quotes`);
        } catch (ltlErr) {
          console.error('[BulkPlan/rate] LTL quote error for', laneKey, ltlErr.message);
        }
      }

      // Fetch PC*MILER mileage for this lane (if any carrier has pcmiler_enabled)
      // Include zip codes for more accurate zip-to-zip routing
      let pcmilerMiles = null;
      const anyPcMiler = Object.values(carrierFlags).some(f => f.pcmiler);
      if (anyPcMiler && lane.origin && lane.destination) {
        try {
          const pcOrigin = lane.originZip ? `${lane.origin} ${lane.originZip}` : lane.origin;
          const pcDest = lane.destZip ? `${lane.destination} ${lane.destZip}` : lane.destination;
          pcmilerMiles = await pcMilerMileage(pcOrigin, pcDest);
          console.log(`[BulkPlan/rate] PC*MILER ${pcOrigin} → ${pcDest} = ${pcmilerMiles} mi`);
        } catch (e) {
          console.warn(`[BulkPlan/rate] PC*MILER error for ${lane.origin}→${lane.destination}: ${e.message}`);
        }
      }

      // Haversine fallback — approximate road miles from zip codes
      const haversineMiles = estimateMilesByZip(lane.originZip, lane.destZip);

      // Always fetch TL rates from DB (for all weight classes).
      // REQ-31: TL matching now honors rates.match_type via the
      // shared matcher at api/services/rateMatcher.js. The same
      // matcher is used for LTL inside /api/ltl/quote, so a TL
      // zip_to_zip rate and an LTL city_to_city rate on the same
      // lane will both produce quotes and the cheapest wins in
      // the downstream sort.
      if (wantsTl) {
        try {
          const oCity = extractCity(lane.origin);
          const dCity = extractCity(lane.destination);
          // No server-side city ilike pre-filter: a zip_to_zip or
          // country_to_country rate may have an origin/dest string
          // that doesn't contain the lane's city, and pre-filtering
          // would exclude it before the matcher sees it. Rates table
          // is small enough that client-side filtering in the
          // matcher is fine.
          const tlUrl = `${SUPABASE_URL}/rest/v1/rates?mode=eq.TL&status=eq.Active&select=` +
            'carrier,origin,dest,rate,fsc,transit_days,lane,service_level,miles,' +
            // Migration 021 structured columns.
            'match_type,origin_zip,dest_zip,origin_country,dest_country,' +
            // Migration 024: trailer this rate was negotiated against.
            // Soft reference to equipment_types.name; planner uses it
            // to resolve max_weight when binning shipment groups.
            'equipment';
          const tlRes = await fetch(tlUrl, { headers: sbHeaders(null) });
          const tlRates = await tlRes.json();

          if (Array.isArray(tlRates)) {
            // Shipment context for the matcher — built once per lane.
            const tlShipmentCtx = {
              originCity:    oCity,
              destCity:      dCity,
              originZip:     lane.originZip || originZip,
              destZip:       lane.destZip   || destZip,
              originCountry: (lane.originCountry || 'USA').toUpperCase(),
              destCountry:   (lane.destCountry   || 'USA').toUpperCase(),
            };

            // Group candidate rates by carrier. matchAllRates is
            // per-carrier and returns EVERY matching rate so a carrier
            // with multiple service levels (Standard + Express, etc.)
            // on the same lane produces one quote per service level
            // instead of silently dropping all but the first.
            const tlRatesByCarrier = tlRates.reduce((acc, rt) => {
              const key = rt.carrier || '';
              (acc[key] = acc[key] || []).push(rt);
              return acc;
            }, {});

            let tlMatched = 0;
            Object.entries(tlRatesByCarrier).forEach(([carrierName, carrierTlRates]) => {
              const tlMatch = matchAllRates(tlShipmentCtx, carrierTlRates);
              if (!tlMatch.rates.length) {
                // No rate matched on geo — skip this carrier on TL.
                // LTL branch above may still quote.
                return;
              }

              tlMatch.rates.forEach(({ rate, reason }) => {
                // Parse rate string like "$2.15" → 2.15
                const rpm = parseFloat((rate.rate || '').replace(/[^0-9.]/g, '')) || 0;
                if (!rpm) return;
                // Parse FSC string like "22.5%" → 22.5
                const fscPct = parseFloat((rate.fsc || '').replace(/[^0-9.]/g, '')) || 0;
                // Miles: PC*MILER if carrier has pcmiler_enabled, else rate.miles, else haversine.
                const carrierKey = (rate.carrier || '').toUpperCase();
                const cFlags = carrierFlags[carrierKey] || {};
                const miles = (cFlags.pcmiler && pcmilerMiles) ? pcmilerMiles : (rate.miles || lane.miles || haversineMiles || 500);
                const baseCost = Math.round(rpm * miles);
                const fscCharge = Math.round(baseCost * (fscPct / 100));
                tlMatched += 1;
                quotes.push({
                  carrier: rate.carrier || carrierName || 'Unknown',
                  scac: '',
                  rateId: rate.lane || rate.id || null,
                  totalCharge: baseCost + fscCharge,
                  czarBaseGross: baseCost,
                  discountPct: 0,
                  fscCharge,
                  fscPct,
                  transitDays: rate.transit_days || null,
                  deliveryDate: '',
                  recommended: false,
                  mode: 'TL',
                  serviceLevel: rate.service_level || '',
                  // Migration 024/025: surface the trailer this rate was
                  // negotiated against so the planner can snapshot it
                  // onto the shipment row at execute time.
                  equipment: rate.equipment || null,
                  miles,
                  pcmilerMiles: (cFlags.pcmiler && pcmilerMiles) ? pcmilerMiles : null,
                  matchReason: reason,
                });
              });
            });
            console.log(`[BulkPlan/rate] TL rates for ${oCity}→${dCity}: ${tlMatched} matched from ${tlRates.length} candidates`);
          }
        } catch (tlErr) {
          console.error('[BulkPlan/rate] TL rates error:', tlErr.message);
        }
      }

      // Tag each quote with carrier flags (carrierconnect_enabled, pcmiler, feasibility)
      quotes.forEach(q => {
        const key = (q.carrier || '').toUpperCase();
        // Exact match by name or SCAC, then partial match (carrier name contains or is contained by flag key)
        let flags = carrierFlags[key] || carrierFlags[(q.scac || '').toUpperCase()] || null;
        if (!flags) {
          const match = Object.keys(carrierFlags).find(k => k.includes(key) || key.includes(k));
          flags = match ? carrierFlags[match] : {};
        }
        q.ccxlEnabled = !!flags.ccxl;
        q.pcmilerEnabled = !!flags.pcmiler;
        if (q.carrier && q.carrier.toUpperCase().includes('DOMINION')) {
          console.log(`[BulkPlan/rate] ODFL debug: carrier="${q.carrier}" scac="${q.scac}" key="${key}" flagsFound=${!!flags.ccxl} ccxlEnabled=${q.ccxlEnabled} transitDays=${q.transitDays}`);
        }
        if (!q.miles) q.miles = (flags.pcmiler && pcmilerMiles) ? pcmilerMiles : (lane.miles || haversineMiles || null);
        if (!q.pcmilerMiles && flags.pcmiler && pcmilerMiles) q.pcmilerMiles = pcmilerMiles;
        // Infeasible: only for TL carriers where CCXL is enabled but no transit data returned
        // LTL carriers are never infeasible just because transit data is missing (CzarLite doesn't always return transit)
        q.infeasible = !!(q.mode === 'TL' && flags.ccxl && !q.transitDays);
        // Over LTL weight limit
        if (q.mode === 'LTL' && wt > LTL_MAX) q.infeasible = true;
      });

      // Apply lane preference rules if enabled
      if (useLanePreferences && lanePrefs.length > 0) {
        // Find matching lane preference for this origin→dest
        const oCity = extractCity(lane.origin);
        const dCity = extractCity(lane.destination);
        const matchingPrefs = lanePrefs.filter(lp => {
          const lpO = (lp.origin || '').toLowerCase().trim();
          const lpD = (lp.dest || '').toLowerCase().trim();
          return (lpO.includes(oCity) || oCity.includes(lpO)) &&
                 (lpD.includes(dCity) || dCity.includes(lpD));
        });

        if (matchingPrefs.length > 0) {
          // Collect all excluded and preferred carriers across matching prefs
          const excluded = new Set();
          const preferred = new Set();
          // Allowed modes from prefs that name a specific mode. A pref
          // with mode 'Any' (or blank) doesn't constrain — only when at
          // least one matching pref names a real mode does mode become
          // a sort-tier signal.
          const allowedModes = new Set();
          matchingPrefs.forEach(pref => {
            (pref.excluded || []).forEach(c => excluded.add(c.toUpperCase()));
            (pref.preferred || []).forEach(c => preferred.add(c.toUpperCase()));
            const m = String(pref.mode || '').trim().toUpperCase();
            if (m && m !== 'ANY') allowedModes.add(m);
          });

          // Excluded carriers are an explicit blacklist — drop them.
          // Mode mismatches are NOT dropped: they remain visible as
          // fallback options below the preference-matching ones.
          const beforeCount = quotes.length;
          const filtered = quotes.filter(q => {
            const name = (q.carrier || '').toUpperCase();
            return !excluded.has(name);
          });
          quotes.length = 0;
          filtered.forEach(q => quotes.push(q));

          // Tag each remaining quote with sort-tier signals.
          //   q.preferred       — carrier is in the lane pref's preferred list
          //   q.matchesLanePref — quote satisfies the lane pref's mode (or
          //                        no mode constraint exists)
          quotes.forEach(q => {
            const name = (q.carrier || '').toUpperCase();
            q.preferred = preferred.has(name);
            if (allowedModes.size === 0) {
              q.matchesLanePref = true;
            } else {
              const qMode = String(q.mode || '').trim().toUpperCase();
              q.matchesLanePref = allowedModes.has(qMode);
            }
          });

          const modesTag = allowedModes.size > 0
            ? `, modes=[${[...allowedModes].join(',')}]`
            : '';
          console.log(`[BulkPlan/rate] Lane prefs applied for ${oCity}→${dCity}: ${beforeCount - quotes.length} excluded, ${quotes.filter(q=>q.preferred).length} preferred, ${quotes.filter(q=>!q.matchesLanePref).length} below-line${modesTag}`);
        }
      }

      // Log all quotes before sorting (include CC flag for debugging)
      console.log(`[BulkPlan/rate] ${laneKey}: ${quotes.length} total quotes:`, quotes.map(q => `${q.carrier} ${q.mode||'?'} $${q.totalCharge} ${q.transitDays||'?'}d cc=${q.ccxlEnabled} ${q.infeasible?'INFEASIBLE':''}`).join(', '));

      // Sort tiers (top → bottom):
      //   1. Feasible (infeasible always last).
      //   2. Lane-pref-matching (mode/carrier satisfies the lane pref).
      //      Quotes that violate the lane pref's mode constraint stay
      //      visible as fallback options but rank below the matches.
      //   3. Preferred carriers boosted within each pref-match tier.
      //   4. Cheapest (or fastest, when optimizeBy=transit).
      const sortBy = optimizeBy === 'transit' ? 'transitDays' : 'totalCharge';
      quotes.sort((a, b) => {
        if (a.infeasible && !b.infeasible) return 1;
        if (!a.infeasible && b.infeasible) return -1;
        const aMatch = a.matchesLanePref !== false; // undefined → matches
        const bMatch = b.matchesLanePref !== false;
        if (aMatch && !bMatch) return -1;
        if (!aMatch && bMatch) return 1;
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;
        return (a[sortBy] || 99999) - (b[sortBy] || 99999);
      });
      // Only use transit from real sources: CarrierConnect or rates table transit_days.
      // No estimation — if transit is missing, the quote has no transit.
      const validQuotes = quotes.filter(q => q.transitDays > 0);
      if (validQuotes.length > 0) validQuotes[0].recommended = true;

      const laneResult = {
        laneKey,
        loadType,
        quotes,
        bestQuote: validQuotes[0] || null,
      };
      laneQuoteCache.set(laneCacheKey, laneResult);
      return laneResult;
    }));

    const finalResults = results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      return { laneKey: 'unknown', loadType: 'LTL', quotes: [], bestQuote: null, error: r.reason?.message };
    });

    console.log(`[BulkPlan/rate] Rated ${finalResults.length} lanes | cache hit=${cacheHits} miss=${cacheMisses} | ratesVersion=${ratesVersion}`);
    res.json({
      results: finalResults,
      meta: {
        cache: {
          hits: cacheHits,
          misses: cacheMisses,
          ratesVersion,
          ...laneQuoteCache.stats(),
        },
      },
    });

  } catch (e) {
    console.error('[BulkPlan/rate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/bulk-plan/execute — Create shipments + update orders ───────────
app.post('/api/bulk-plan/execute', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  // REQ-04: only admin + planner can execute bulk planning.
  const roleB = getUserRole(user);
  if (!['admin', 'planner'].includes(roleB)) {
    return res.status(403).json({ error: `Role '${roleB}' cannot execute bulk plans. Required: admin, planner.` });
  }
  try {
    const { plans } = req.body;
    if (!plans || !plans.length) return res.status(400).json({ error: 'plans[] required' });
    const { shipments, ordersUpdated, errors } = await executeBulkPlans(plans, {
      SUPABASE_URL,
      SERVICE_KEY,
      dbSelect,
      fetchImpl: fetch,
    });

    // REQ-02: record 'plan' events, one per order assigned to a shipment,
    // plus a 'create' event per new shipment. Batched for efficiency.
    try {
      const rows = [];
      for (const ship of shipments || []) {
        rows.push(history.buildRow({
          entityType: 'shipment',
          entityId:   ship.id,
          action:     'create',
          after:      { status: ship.status, carrier: ship.carrier, total_cost: ship.total_cost },
          user,
          metadata:   { mode: ship.mode, orderIds: ship.order_ids || [], totalCost: ship.total_cost },
        }));
        for (const oid of ship.order_ids || []) {
          rows.push(history.buildRow({
            entityType: 'order',
            entityId:   oid,
            action:     'plan',
            after:      { status: 'Planned', shipment_id: ship.id },
            user,
            metadata:   { shipmentId: ship.id, carrier: ship.carrier, mode: ship.mode },
          }));
        }
      }
      if (rows.length) await history.recordChangeBatch(rows);
    } catch (auditErr) {
      console.error('[BulkPlan/execute] history write failed:', auditErr.message);
    }

    res.json({ shipments, ordersUpdated, errors });

  } catch (e) {
    console.error('[BulkPlan/execute]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/reconcile-status — Repair inconsistent order status/shipment links ──
app.post('/api/orders/reconcile-status', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  if (getUserRole(user) !== 'admin') return res.status(403).json({ error: 'Admin role required' });
  try {
    const staleUnplanned = await dbSelect(
      'orders',
      'select=id,status,shipment_id&status=eq.Unplanned&shipment_id=not.is.null&limit=10000',
      null
    );
    let fixedToPlanned = 0;
    for (const row of (staleUnplanned || [])) {
      await dbUpdate('orders', row.id, { status: 'Planned' }, null);
      fixedToPlanned++;
    }

    const stalePlanned = await dbSelect(
      'orders',
      'select=id,status,shipment_id&status=eq.Planned&shipment_id=is.null&limit=10000',
      null
    );
    let fixedToUnplanned = 0;
    for (const row of (stalePlanned || [])) {
      await dbUpdate('orders', row.id, { status: 'Unplanned' }, null);
      fixedToUnplanned++;
    }

    res.json({
      repaired: fixedToPlanned + fixedToUnplanned,
      fixedToPlanned,
      fixedToUnplanned,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/bulk-plan/import — Bulk create orders from CSV/Excel ───────────
app.post('/api/bulk-plan/import', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const { orders: importOrders } = req.body;
    if (!importOrders || !importOrders.length) return res.status(400).json({ error: 'orders[] required' });

    const created = [];
    const errors = [];

    for (let i = 0; i < importOrders.length; i++) {
      const o = importOrders[i];
      // Validate
      if (!o.customer) { errors.push({ row: i + 1, message: 'Customer required' }); continue; }
      if (!o.origin) { errors.push({ row: i + 1, message: 'Origin required' }); continue; }
      if (!o.destination) { errors.push({ row: i + 1, message: 'Destination required' }); continue; }

      const orderId = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
      const row = {
        id: orderId,
        customer: o.customer,
        origin: o.origin,
        dest: o.destination,
        weight: parseFloat(o.weight) || 0,
        pieces: parseInt(o.pieces) || 0,
        commodity: o.commodity || 'General',
        ready: o.readyDate || null,
        due: o.dueDate || null,
        status: 'Unplanned',
      };

      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?on_conflict=id`, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(row),
        });
        const data = await r.json();
        created.push(Array.isArray(data) ? data[0] : data);
      } catch (insertErr) {
        errors.push({ row: i + 1, message: insertErr.message });
      }
    }

    console.log(`[BulkPlan/import] Created ${created.length} orders, ${errors.length} errors`);
    res.json({ created: created.length, orders: created, errors });

  } catch (e) {
    console.error('[BulkPlan/import]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
app.post('/api/auth/refresh', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token)
      return res.status(401).json({ error: data.error_description || 'Refresh failed' });
    res.json({
      token:        data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn:    data.expires_in || 3600,
      expiresAt:    Date.now() + ((data.expires_in || 3600) * 1000),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Haversine approximate mileage (fallback when PC*MILER & rate.miles unavailable) ──
function haversine(lat1, lng1, lat2, lng2) {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Zip-prefix (3-digit) → approximate centroid lat/lng for haversine fallback.
// Covers major US zip prefixes; unknown zips return null.
const ZIP3_COORDS = {
  '006':{ lat:18.40, lng:-66.06 },'100':{ lat:40.75, lng:-73.99 },'101':{ lat:40.75, lng:-73.99 },
  '021':{ lat:42.36, lng:-71.06 },'191':{ lat:39.95, lng:-75.16 },'200':{ lat:38.90, lng:-77.04 },
  '206':{ lat:38.90, lng:-77.04 },'212':{ lat:39.29, lng:-76.61 },'232':{ lat:37.54, lng:-77.43 },
  '282':{ lat:35.23, lng:-80.84 },'290':{ lat:34.00, lng:-81.03 },'303':{ lat:33.75, lng:-84.39 },
  '305':{ lat:33.75, lng:-84.39 },'320':{ lat:30.33, lng:-81.66 },'331':{ lat:25.76, lng:-80.19 },
  '332':{ lat:25.76, lng:-80.19 },'333':{ lat:26.12, lng:-80.14 },'334':{ lat:26.72, lng:-80.05 },
  '336':{ lat:27.95, lng:-82.46 },'337':{ lat:28.54, lng:-81.38 },'381':{ lat:35.15, lng:-90.05 },
  '372':{ lat:36.17, lng:-86.78 },'402':{ lat:38.25, lng:-85.76 },'432':{ lat:39.96, lng:-82.99 },
  '433':{ lat:39.96, lng:-82.99 },'441':{ lat:41.50, lng:-81.69 },'461':{ lat:39.77, lng:-86.16 },
  '462':{ lat:39.77, lng:-86.16 },'480':{ lat:42.33, lng:-83.05 },'481':{ lat:42.33, lng:-83.05 },
  '530':{ lat:43.04, lng:-87.91 },'532':{ lat:43.04, lng:-87.91 },'550':{ lat:44.98, lng:-93.27 },
  '551':{ lat:44.98, lng:-93.27 },'601':{ lat:41.88, lng:-87.63 },'604':{ lat:41.88, lng:-87.63 },
  '606':{ lat:41.88, lng:-87.63 },'630':{ lat:38.63, lng:-90.20 },'631':{ lat:38.63, lng:-90.20 },
  '640':{ lat:39.10, lng:-94.58 },'641':{ lat:39.10, lng:-94.58 },'680':{ lat:41.26, lng:-95.94 },
  '700':{ lat:29.95, lng:-90.07 },'701':{ lat:29.95, lng:-90.07 },'730':{ lat:35.47, lng:-97.52 },
  '731':{ lat:35.47, lng:-97.52 },'750':{ lat:32.78, lng:-96.80 },'751':{ lat:32.78, lng:-96.80 },
  '752':{ lat:32.78, lng:-96.80 },'770':{ lat:29.76, lng:-95.37 },'771':{ lat:29.76, lng:-95.37 },
  '773':{ lat:29.76, lng:-95.37 },'782':{ lat:29.42, lng:-98.49 },'786':{ lat:30.27, lng:-97.74 },
  '790':{ lat:31.76, lng:-106.44},'793':{ lat:33.45, lng:-101.85},
  '800':{ lat:39.74, lng:-104.99},'801':{ lat:39.74, lng:-104.99},'802':{ lat:39.74, lng:-104.99 },
  '840':{ lat:40.76, lng:-111.89},'850':{ lat:33.45, lng:-112.07},'851':{ lat:33.45, lng:-112.07 },
  '852':{ lat:33.45, lng:-112.07},'870':{ lat:35.08, lng:-106.65},'871':{ lat:35.08, lng:-106.65 },
  '890':{ lat:36.17, lng:-115.14},'891':{ lat:36.17, lng:-115.14},
  '900':{ lat:34.05, lng:-118.24},'901':{ lat:34.05, lng:-118.24},'902':{ lat:33.77, lng:-118.19 },
  '906':{ lat:34.14, lng:-118.26},'910':{ lat:34.18, lng:-118.31},'917':{ lat:34.01, lng:-118.49 },
  '920':{ lat:32.72, lng:-117.16},'921':{ lat:32.72, lng:-117.16},
  '940':{ lat:37.78, lng:-122.42},'941':{ lat:37.78, lng:-122.42},'943':{ lat:37.34, lng:-121.89 },
  '945':{ lat:37.80, lng:-122.27},'950':{ lat:37.34, lng:-121.89},'951':{ lat:37.34, lng:-121.89 },
  '958':{ lat:38.58, lng:-121.49},'970':{ lat:45.52, lng:-122.68},'971':{ lat:45.52, lng:-122.68 },
  '980':{ lat:47.61, lng:-122.33},'981':{ lat:47.61, lng:-122.33},'984':{ lat:47.25, lng:-122.44 },
};

function zipToCoords(zip) {
  if (!zip || zip.length < 3) return null;
  const z3 = zip.substring(0, 3);
  return ZIP3_COORDS[z3] || null;
}

/**
 * Estimate road miles between two zip codes using haversine × 1.3 road factor.
 * Returns null if either zip can't be resolved.
 */
function estimateMilesByZip(originZip, destZip) {
  const o = zipToCoords(originZip);
  const d = zipToCoords(destZip);
  if (!o || !d) return null;
  const straightLine = haversine(o.lat, o.lng, d.lat, d.lng);
  return Math.round(straightLine * 1.2);
}

// ── PC*MILER Mileage ─────────────────────────────────────────────────────────
const PC_MILER_API_KEY = process.env.PC_MILER_API_KEY || '';
const mileageCache = {};                                    // "ORIGIN|DEST" → { miles, ts }
const MILEAGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;         // 7 days

async function pcMilerMileage(origin, dest) {
  const key = `${origin.toUpperCase().trim()}|${dest.toUpperCase().trim()}`;
  const cached = mileageCache[key];
  if (cached && Date.now() - cached.ts < MILEAGE_CACHE_TTL) return cached.miles;

  if (!PC_MILER_API_KEY) throw new Error('PC_MILER_API_KEY not configured');

  // Parse address into City, State, Zip for PC*MILER
  function parseStop(addr) {
    const city = (addr.split(',')[0] || '').trim();
    const stateRaw = (addr.split(',')[1] || '').trim();
    const zipMatch = stateRaw.match(/\b(\d{5}(-\d{4})?)\b/);
    const zip = zipMatch ? zipMatch[1] : '';
    const state = stateRaw.replace(/\s*\d{5}(-\d{4})?\s*/g, '').trim() || city;
    const address = { City: city, State: state };
    if (zip) address.Zip = zip;
    return { Address: address };
  }
  const stops = [parseStop(origin), parseStop(dest)];

  const url = 'https://pcmiler.alk.com/apis/rest/v1.0/Service.svc/route/routeReports';
  const body = {
    ReportRoutes: [{
      RouteId: 'mileage',
      Stops: stops,
      ReportTypes: [{ __type: 'MileageReportType:http://pcmiler.alk.com/APIs/v1.0' }],
    }],
  };

  const resp = await fetch(`${url}?authToken=${encodeURIComponent(PC_MILER_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`PC*MILER API error (${resp.status}): ${errText}`);
  }

  const data = await resp.json();
  const report = data?.[0]?.ReportLines;
  if (!report || !report.length) throw new Error('PC*MILER returned no mileage data');

  // The last ReportLine contains the total — parse the miles value
  const totalLine = report[report.length - 1];
  const milesStr = totalLine?.TMiles || totalLine?.Miles || totalLine?.LMiles || '';
  const rawMiles = parseFloat(String(milesStr).replace(/,/g, ''));
  if (isNaN(rawMiles)) throw new Error('Could not parse mileage from PC*MILER response');
  const miles = Math.round(rawMiles);

  console.log(`[PC*MILER] ${origin} → ${dest} = ${miles} mi`);
  mileageCache[key] = { miles, ts: Date.now() };
  return miles;
}

app.get('/api/mileage', async (req, res) => {
  try {
    const { origin, dest } = req.query;
    if (!origin || !dest) return res.status(400).json({ error: 'origin and dest query params required' });

    const miles = await pcMilerMileage(origin, dest);
    res.json({ origin, dest, miles });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Haversine-estimated mileage (no PC*MILER key needed)
app.get('/api/mileage/estimate', (req, res) => {
  const { originZip, destZip } = req.query;
  if (!originZip || !destZip) return res.status(400).json({ error: 'originZip and destZip required' });
  const miles = estimateMilesByZip(originZip, destZip);
  if (!miles) return res.status(422).json({ error: 'Could not resolve zip coordinates', originZip, destZip });
  res.json({ originZip, destZip, miles, method: 'haversine' });
});

// ── Geocode + Haversine distance by city names (Nominatim) ──────────────────
const geocodeCache = {}; // "city, st" → { lat, lng, ts }
const GEOCODE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

async function geocodeCity(cityState) {
  const key = (cityState || '').trim().toLowerCase();
  if (!key) return null;
  const cached = geocodeCache[key];
  if (cached && Date.now() - cached.ts < GEOCODE_CACHE_TTL) return { lat: cached.lat, lng: cached.lng };

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityState + ', USA')}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ZoreeTMS/1.0 (route-optimizer)' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.length) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    geocodeCache[key] = { lat, lng, ts: Date.now() };
    console.log(`[Geocode] ${cityState} → ${lat}, ${lng}`);
    return { lat, lng };
  } catch (e) {
    console.warn(`[Geocode] Failed for "${cityState}":`, e.message);
    return null;
  }
}

app.get('/api/mileage/city', async (req, res) => {
  const { origin, dest } = req.query;
  if (!origin || !dest) return res.status(400).json({ error: 'origin and dest query params required (City, ST)' });

  const oCoords = await geocodeCity(origin);
  const dCoords = await geocodeCity(dest);
  if (!oCoords || !dCoords) {
    return res.status(422).json({
      error: 'Could not geocode one or both locations',
      origin: oCoords ? 'resolved' : 'failed',
      dest: dCoords ? 'resolved' : 'failed',
    });
  }

  const straightLine = haversine(oCoords.lat, oCoords.lng, dCoords.lat, dCoords.lng);
  const miles = Math.round(straightLine * 1.2); // Road factor
  res.json({
    origin, dest, miles, method: 'geocode-haversine',
    originCoords: oCoords, destCoords: dCoords,
  });
});

// Bulk mileage — accepts array of { origin, dest } pairs
app.post('/api/mileage/bulk', async (req, res) => {
  try {
    const pairs = req.body.pairs;
    if (!Array.isArray(pairs)) return res.status(400).json({ error: 'pairs array required' });

    const results = await Promise.allSettled(
      pairs.map(p => pcMilerMileage(p.origin, p.dest).then(miles => ({ origin: p.origin, dest: p.dest, miles })))
    );

    res.json({
      results: results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { origin: pairs[i].origin, dest: pairs[i].dest, miles: null, error: r.reason?.message }
      ),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════════════
// WebSocket Server — real-time notifications to TMS frontend
// ══════════════════════════════════════════════════════════════════
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const wsClients = new Set();
wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log(`[WS] Client connected (${wsClients.size} total)`);
  ws.on('close', () => {
    wsClients.delete(ws);
    console.log(`[WS] Client disconnected (${wsClients.size} total)`);
  });
});

/** Broadcast an event to all connected TMS clients */
function wsBroadcast(event, data) {
  const msg = JSON.stringify({ event, data, ts: new Date().toISOString() });
  wsClients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// Bridge: any service that emits SHIPMENT_UPDATED on the in-process bus
// (ship-confirm, POD, manual timeline events) is fan-ed out to every
// connected browser via the existing WS channel. App.jsx listens on WS
// and triggers refreshData() on any message, so the Shipments list +
// open detail modal refresh without a page reload.
bus.on(EVENTS.SHIPMENT_UPDATED, (payload) => {
  try { wsBroadcast(EVENTS.SHIPMENT_UPDATED, payload || {}); }
  catch (err) { console.error('[WS] shipment broadcast failed:', err.message); }
});

// Mobile-bug 57: same fan-out for shipment deletes so connected mobile
// + web clients refresh the orders list (orders cascade to Unplanned
// when a shipment is deleted).
bus.on(EVENTS.SHIPMENT_DELETED, (payload) => {
  try { wsBroadcast(EVENTS.SHIPMENT_DELETED, payload || {}); }
  catch (err) { console.error('[WS] shipment delete broadcast failed:', err.message); }
});

// POST /api/notify — called by Middleware after pushing data to TMS
app.post('/api/notify', (req, res) => {
  const { event, data } = req.body || {};
  if (!event) return res.status(400).json({ error: 'event required' });
  wsBroadcast(event, data || {});
  console.log(`[WS] Broadcast: ${event}`, data ? JSON.stringify(data).slice(0, 100) : '');
  res.json({ ok: true, clients: wsClients.size });
});

// ── 404 catch-all (must be AFTER all route definitions) ──────────────────────
app.use((req, res) => res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => { console.error('[Error]', err.message); res.status(500).json({ error: err.message }); });

// ══════════════════════════════════════════════════════════════════
// Start Server
// ══════════════════════════════════════════════════════════════════
server.listen(PORT, () => {
  console.log(`\n🚛 ZoreeTMS API — Tier 2 running on http://localhost:${PORT}`);
  console.log(`   ✅ Supabase credentials: SERVER-SIDE ONLY`);
  console.log(`   ✅ Browser never touches Supabase directly`);
  console.log(`   ✅ 3-Tier Architecture active`);
  console.log(`   ✅ WebSocket server active on ws://localhost:${PORT}`);
  console.log(`   ℹ️  Tender email check: GET http://localhost:${PORT}/health → tenderEmail`);
  verifySmtpOnStartup().catch(function(err) {
    console.error('   📧 Tender email: verify error:', err && err.message ? err.message : err);
  });

  // REQ-31: backend MW queue worker. Defaults ON so OMS→TMS sync
  // doesn't depend on a browser tab being open. Disable per-env with
  // MW_QUEUE_AUTO_START=false (e.g. for tests or while debugging the
  // browser MW). Interval is configurable via MW_QUEUE_INTERVAL_MS.
  if (String(process.env.MW_QUEUE_AUTO_START || 'true').toLowerCase() !== 'false') {
    const intervalMs = Number(process.env.MW_QUEUE_INTERVAL_MS) || undefined;
    mwQueueWorker.start(intervalMs ? { intervalMs } : {});
    console.log(`   ✅ MW queue worker started (mwQueueWorker)`);
  } else {
    console.log(`   ℹ️  MW queue worker NOT auto-started (MW_QUEUE_AUTO_START=false). Use POST /api/mw-queue/start.`);
  }

  // Fusion (TMS → OIC) outbound publisher. No-op unless OIC_PUBLISH_ENABLED=true.
  // See api/services/fusionPublisher/index.js and docs/integrations/oic/flows/F3-tms-to-fusion-status.md.
  fusionPublisher.start();
  console.log('');
});

module.exports = app;
