// ═══════════════════════════════════════════════════════════════════
// ZoreeTMS API — Tier 2 (Business Logic) — Complete Single File
// No external route files needed — everything is here.
// Supabase credentials stay server-side — never reach the browser.
// ═══════════════════════════════════════════════════════════════════

require('dotenv').config();
const http    = require('http');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const WebSocket = require('ws');
const nodemailer = require('nodemailer');


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
    return user;
  } catch (e) {
    res.status(401).json({ error: 'Token verification failed' });
    return null;
  }
}

// Allowed tables — security whitelist
const ALLOWED = [
  // Core TMS
  'orders','shipments','carriers','rates','items','drivers','locations',
  'order_lines','lane_preferences','order_history','route_templates',
  'equipment_types','planning_parameters','documents','vehicles',
  // Dock & scheduling
  'dock_appointments','dock_schedules','crossdock_hubs','warehouse_dock_config',
  // Events & messaging
  'shipment_events','tms_messages','system_config','tenant_config',
  // OMS
  'oms_orders','oms_order_lines','oms_customers','oms_locations',
  'oms_inventory','oms_inv_transactions','oms_dock_schedule','oms_stage_log',
  // Middleware
  'mw_requests','mw_event_log',
  // Marketing
  'trial_signups',
];

// ══════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════

// ── Dev: accept new index.html push ────────────────────────────────
const fs = require('fs');
const path = require('path');
app.post('/dev/push-html', express.raw({type:'text/html',limit:'5mb'}), (req,res)=>{
  const dest = path.join(__dirname,'..','index.html');
  fs.writeFile(dest, req.body, (err)=>{
    if(err){ console.error('[dev] write failed:',err.message); return res.status(500).json({error:err.message}); }
    console.log('[dev] index.html updated →',dest);
    res.json({ok:true,dest});
  });
});

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
    res.json({
      token:         data.access_token,
      refresh_token: data.refresh_token,
      expires_at:    data.expires_at,
      expires_in:    data.expires_in,
      user: {
        id:       user.id,
        email:    user.email,
        name:     (user.user_metadata && user.user_metadata.full_name) || email.split('@')[0],
        role:     (user.user_metadata && user.user_metadata.role) || 'admin',
        tenantId: 'zoree-default',
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

// ── GET /api/auth/me ───────────────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  const user = await verifyToken(req, res);
  if (!user) return;
  res.json({ user: { id: user.id, email: user.email, role: 'admin' } });
});

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
    res.json({
      sent: true,
      messageId: info.messageId || null,
      to: actualTo,
      originalTo: override ? toRaw : undefined,
    });
  } catch (e) {
    console.error('[tender/email] SEND FAILED:', e.message);
    res.status(502).json({ error: 'Failed to send email: ' + e.message });
  }
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

  // Check if OMS endpoint is configured
  const omsUrl = process.env.OMS_API_URL || '';
  const omsApiKey = process.env.OMS_API_KEY || '';

  if (!omsUrl) {
    console.log('[OMS Push] No OMS_API_URL configured. Payload logged:');
    console.log(JSON.stringify(payload, null, 2));
    return res.json({
      sent: false,
      skipped: 'no_oms_url',
      message: 'OMS_API_URL not configured. Set OMS_API_URL and OMS_API_KEY env vars to enable OMS integration.',
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
      res.json({ sent: true, status: omsRes.status, payload });
    } else {
      res.status(502).json({ sent: false, error: `OMS returned ${omsRes.status}`, detail: omsText.slice(0, 500), payload });
    }
  } catch (err) {
    console.error('[OMS Push] FAILED:', err.message);
    res.status(502).json({ sent: false, error: err.message, payload });
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
  try {
    // Use service role for all allowed tables (RLS blocks writes with user JWT)
    const row = await dbUpsert(req.params.table, req.body, null);
    res.status(201).json(row || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/:table/:id  — update by id
// PATCH /api/db/rates — update by lane query string (for supaSaveRate)
app.patch('/api/db/rates', async (req, res) => {
  const user = await verifyTokenSoft(req);
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
    res.json(data);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/db/:table/:id', async (req, res) => {
  const user = await verifyTokenSoft(req);
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  try {
    // Use service role for all allowed tables (RLS blocks writes with user JWT)
    const row = await dbUpdate(req.params.table, req.params.id, req.body, null);
    res.json(row || {});
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/db/:table/:id  — delete by id
app.delete('/api/db/:table/:id', async (req, res) => {
  const user = await verifyTokenSoft(req);
  if (!ALLOWED.includes(req.params.table))
    return res.status(403).json({ error: 'Table not permitted: ' + req.params.table });
  try {
    await dbDelete(req.params.table, req.params.id, null);
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

    // Step 1: Delete all existing lines for this order (service role to bypass RLS)
    await fetch(`${SUPABASE_URL}/rest/v1/order_lines?order_id=eq.${encodeURIComponent(orderId)}`, {
      method: 'DELETE', headers: sbHeaders(null)
    });

    // Step 2: Insert new lines
    let results = [];
    if (lines.length > 0) {
      const rows = lines.map((line, i) => ({
        id:           `${orderId}-L${(line.line_num || i + 1).toString().padStart(3,'0')}`,
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
      console.log('[Lines] Inserting rows:', JSON.stringify(rows));
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/order_lines`, {
        method: 'POST',
        headers: { ...sbHeaders(null), 'Prefer': 'return=representation' },
        body: JSON.stringify(rows)
      });
      const insText = await insRes.text();
      console.log('[Lines] Insert status:', insRes.status, '| response:', insText.slice(0,300));
      if (insRes.ok) results = JSON.parse(insText);
      else console.error('[Lines] Insert FAILED:', insRes.status, insText);
    }

    // Step 3: Update weight, pieces and line_count on parent order
    const totalWeight = lines.reduce((s, l) => s + (parseFloat(l.total_weight ?? l.totalWt) || 0), 0);
    const totalPieces = lines.reduce((s, l) => s + (parseInt(l.qty_ordered ?? l.qty) || 0), 0);
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: sbHeaders(null),
      body: JSON.stringify({ line_count: lines.length, weight: totalWeight, pieces: totalPieces })
    });
    if (!patchRes.ok) {
      const patchErr = await patchRes.text();
      console.error('[Lines] Order PATCH failed:', patchRes.status, patchErr);
    }

    console.log(`[Lines] Order ${orderId}: replaced ${lines.length} lines, weight=${totalWeight}lbs, pieces=${totalPieces}`);
    res.status(201).json({ lines: results, line_count: lines.length, weight: totalWeight, pieces: totalPieces });
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
app.get('/api/shipments', async (req, res) => { const u = await verifyToken(req,res); if(!u) return; try { const rows = await dbSelect('shipments','select=*&order=created_at.desc&limit=500',u._token); res.json({ shipments: rows, total: rows.length }); } catch(e){ res.status(500).json({error:e.message}); } });
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

  const { originZip, destZip, weight, freightClass, originCity, destCity } = req.body;
  if (!originZip || !destZip) return res.status(400).json({ error: 'originZip + destZip required' });

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
    const rr = await fetch(
      `${SUPABASE_URL}/rest/v1/rates?mode=eq.LTL&status=eq.Active&origin=ilike.*${encodeURIComponent(oCity)}*&dest=ilike.*${encodeURIComponent(dCity)}*&select=carrier,origin,dest,discount,discount_flat,fsc,lane,service_level,czarlite_min_wt,czarlite_max_wt,transit_days`,
      { headers: sbHeaders(null) }
    );
    if (rr.ok) adderRates = await rr.json();
    // Only keep rates for carriers with czarlite_enabled
    const czCarrierNames = new Set(czCarriers.map(c => c.name));
    adderRates = adderRates.filter(r => czCarrierNames.has(r.carrier));
    console.log('[LTL/quote] Lane rates found:', adderRates.length, adderRates.map(r=>r.carrier+'|disc='+r.discount));
  } catch(e) { console.error('[LTL/quote] rates error:', e.message); }

  // Step 4: One quote per carrier
  // Match rate record: lane-specific first, then carrier-only (blank origin/dest)
  // Formula: CzarLite base × (1 - discount%) + FSC% on discounted base = Total
  const quotes = [];

  czCarriers.forEach(carrier => {
    const carrierRates = adderRates.filter(r => r.carrier === carrier.name);

    // 1. Lane-specific match
    let r = carrierRates.find(rt => {
      const ro = (rt.origin || '').toLowerCase();
      const rd = (rt.dest   || '').toLowerCase();
      return ro && rd && ro.includes(oCity) && rd.includes(dCity);
    });
    // 2. Carrier-level fallback (blank origin+dest = all lanes)
    if (!r) r = carrierRates.find(rt => !rt.origin && !rt.dest) || null;

    // Enforce weight limits from rate record
    if (r) {
      const minWt = r.czarlite_min_wt || 0;
      const maxWt = r.czarlite_max_wt || Infinity;
      if (wt < minWt || wt > maxWt) {
        console.log(`[LTL/quote] ${carrier.name}: SKIPPED — weight ${wt}lbs outside range ${minWt}–${maxWt}lbs`);
        return; // skip this carrier
      }
    }

    const discountPct  = r ? (parseFloat(r.discount)      || 0) : 0;
    const discountFlat = r ? (parseFloat(r.discount_flat) || 0) : 0;
    const discountAmt  = Math.round(baseTotal * discountPct / 100) + discountFlat;
    const discountedBase = Math.max(0, baseTotal - discountAmt);

    const fscPct    = r && r.fsc ? parseFloat((r.fsc || '0%').replace('%','')) / 100 : 0;
    const fscCharge = r && r.fsc
      ? Math.round(discountedBase * fscPct)
      : Math.round(czarBase.surchargeAmount || 0);
    const total = Math.round(discountedBase + fscCharge);

    console.log(`[LTL/quote] ${carrier.name}: base=$${baseTotal} disc=${discountPct}% amt=$${discountAmt} discBase=$${discountedBase} fsc=$${fscCharge} total=$${total} rateMatch=${r?r.lane:'NONE'}`);
    quotes.push({
      rateId:       r ? (r.lane || r.id) : null,
      carrier:      carrier.name,
      scac:         carrier.scac,
      mode:         'LTL',
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
    const { lanes, optimizeBy } = req.body;
    if (!lanes || !lanes.length) return res.status(400).json({ error: 'lanes[] required' });

    // Check if lane_preferences parameter is enabled
    let useLanePreferences = false;
    let lanePrefs = [];
    try {
      const ppRes = await fetch(`${SUPABASE_URL}/rest/v1/planning_parameters?key=eq.lane_preferences&select=enabled`, {
        headers: { 'apikey': SERVICE_KEY },
      });
      const ppData = await ppRes.json();
      if (Array.isArray(ppData) && ppData.length > 0) {
        useLanePreferences = !!ppData[0].enabled;
      }
      if (useLanePreferences) {
        const lpRes = await fetch(`${SUPABASE_URL}/rest/v1/lane_preferences?status=eq.Active&select=*`, {
          headers: { 'apikey': SERVICE_KEY },
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

    const results = await Promise.allSettled(lanes.map(async (lane) => {
      const { laneKey, originZip, destZip, totalWeight, freightClass, orderIds } = lane;
      const fc = String(freightClass || 70);
      const wt = Math.round(totalWeight || 1000);
      const LTL_MAX = 15000;
      const loadType = wt >= 35000 ? 'Full TL' : wt >= LTL_MAX ? 'Partial TL' : 'LTL';
      const quotes = [];

      // Always fetch LTL rates (CzarLite + CCXL) unless weight exceeds LTL max
      if (wt <= LTL_MAX) {
        try {
          const ltlRes = await fetch(`http://localhost:${PORT || 3001}/api/ltl/quote`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': req.headers.authorization || '',
            },
            body: JSON.stringify({
              originZip, destZip, weight: wt, freightClass: fc,
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

      // Always fetch TL rates from DB (for all weight classes)
      {
        try {
          const tlUrl = `${SUPABASE_URL}/rest/v1/rates?mode=eq.TL&status=eq.Active&select=carrier,origin,dest,rate,fsc,transit_days,lane,service_level,miles`;
          const tlRes = await fetch(tlUrl, {
            headers: { 'apikey': SERVICE_KEY, 'Content-Type': 'application/json' },
          });
          const tlRates = await tlRes.json();

          // Extract city name: strip ZIP codes, state codes, commas
          function extractCity(str) {
            return (str || '').replace(/\d{5}/g, '').split(',')[0].replace(/\s+(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\s*$/i, '').trim().toLowerCase();
          }
          const oCity = extractCity(lane.origin);
          const dCity = extractCity(lane.destination);

          if (Array.isArray(tlRates)) {
            tlRates.forEach((rate) => {
              // Filter: only rates matching this lane's origin and dest (city name)
              const rateO = extractCity(rate.origin);
              const rateD = extractCity(rate.dest);
              if (!rateO.includes(oCity) && !oCity.includes(rateO)) return;
              if (!rateD.includes(dCity) && !dCity.includes(rateD)) return;

              // Parse rate string like "$2.15" → 2.15
              const rpm = parseFloat((rate.rate || '').replace(/[^0-9.]/g, '')) || 0;
              if (!rpm) return;
              // Parse FSC string like "22.5%" → 22.5
              const fscPct = parseFloat((rate.fsc || '').replace(/[^0-9.]/g, '')) || 0;
              // Use PC*MILER miles if carrier has pcmiler_enabled, else rate.miles from DB, else fallback
              const carrierKey = (rate.carrier || '').toUpperCase();
              const cFlags = carrierFlags[carrierKey] || {};
              const miles = (cFlags.pcmiler && pcmilerMiles) ? pcmilerMiles : (rate.miles || lane.miles || haversineMiles || 500);
              const baseCost = Math.round(rpm * miles);
              const fscCharge = Math.round(baseCost * (fscPct / 100));
              quotes.push({
                carrier: rate.carrier || 'Unknown',
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
                miles,
                pcmilerMiles: (cFlags.pcmiler && pcmilerMiles) ? pcmilerMiles : null,
              });
            });
          }
          console.log(`[BulkPlan/rate] TL rates for ${oCity}→${dCity}: ${quotes.filter(q=>q.mode==='TL').length} matched from ${Array.isArray(tlRates)?tlRates.length:0} total`);
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
          matchingPrefs.forEach(pref => {
            (pref.excluded || []).forEach(c => excluded.add(c.toUpperCase()));
            (pref.preferred || []).forEach(c => preferred.add(c.toUpperCase()));
          });

          // Remove excluded carriers
          const beforeCount = quotes.length;
          const filtered = quotes.filter(q => {
            const name = (q.carrier || '').toUpperCase();
            return !excluded.has(name);
          });
          quotes.length = 0;
          filtered.forEach(q => quotes.push(q));

          // Mark preferred carriers
          quotes.forEach(q => {
            const name = (q.carrier || '').toUpperCase();
            q.preferred = preferred.has(name);
          });

          console.log(`[BulkPlan/rate] Lane prefs applied for ${oCity}→${dCity}: ${beforeCount - quotes.length} excluded, ${quotes.filter(q=>q.preferred).length} preferred`);
        }
      }

      // Log all quotes before sorting (include CC flag for debugging)
      console.log(`[BulkPlan/rate] ${laneKey}: ${quotes.length} total quotes:`, quotes.map(q => `${q.carrier} ${q.mode||'?'} $${q.totalCharge} ${q.transitDays||'?'}d cc=${q.ccxlEnabled} ${q.infeasible?'INFEASIBLE':''}`).join(', '));

      // Sort: feasible first, preferred carriers boosted, then by cost/transit
      const sortBy = optimizeBy === 'transit' ? 'transitDays' : 'totalCharge';
      quotes.sort((a, b) => {
        // Infeasible always last
        if (a.infeasible && !b.infeasible) return 1;
        if (!a.infeasible && b.infeasible) return -1;
        // Preferred carriers first (when lane prefs enabled)
        if (a.preferred && !b.preferred) return -1;
        if (!a.preferred && b.preferred) return 1;
        return (a[sortBy] || 99999) - (b[sortBy] || 99999);
      });
      // Only use transit from real sources: CarrierConnect or rates table transit_days.
      // No estimation — if transit is missing, the quote has no transit.
      const validQuotes = quotes.filter(q => q.transitDays > 0);
      if (validQuotes.length > 0) validQuotes[0].recommended = true;

      return {
        laneKey,
        loadType,
        quotes,
        bestQuote: validQuotes[0] || null,
      };
    }));

    const finalResults = results.map((r) => {
      if (r.status === 'fulfilled') return r.value;
      return { laneKey: 'unknown', loadType: 'LTL', quotes: [], bestQuote: null, error: r.reason?.message };
    });

    console.log(`[BulkPlan/rate] Rated ${finalResults.length} lanes`);
    res.json({ results: finalResults });

  } catch (e) {
    console.error('[BulkPlan/rate]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/bulk-plan/execute — Create shipments + update orders ───────────
app.post('/api/bulk-plan/execute', async (req, res) => {
  const user = await verifyToken(req, res); if (!user) return;
  try {
    const { plans } = req.body;
    if (!plans || !plans.length) return res.status(400).json({ error: 'plans[] required' });

    const shipments = [];
    const errors = [];
    let ordersUpdated = 0;

    for (const plan of plans) {
      try {
        const year = new Date().getFullYear();
        const shipId = `SHP-${year}-${Math.floor(1000 + Math.random() * 9000)}`;

        const shipRow = {
          id: shipId,
          carrier: plan.carrier || '',
          mode: plan.mode || 'LTL',
          origin: plan.origin,
          dest: plan.destination,
          weight: plan.totalWeight || 0,
          pieces: plan.totalPieces || 0,
          status: 'Planned',
          total_cost: plan.totalCost || 0,
          rate: plan.rate || 0,
          fuel_surcharge: plan.fuelSurcharge || 0,
          accessorials: plan.accessorials || 0,
          order_ids: plan.orderIds || [],
          pickup_date: plan.pickupDate || null,
          delivery_date: plan.deliveryDate || null,
          czarlite_rate: !!plan.czarliteRate || (plan.mode || '').toUpperCase() === 'LTL',
          service_level: plan.serviceLevel || null,
          miles: plan.miles || null,
          rate_id: plan.rateId || null,
        };

        // Add dock fields if available
        if (plan.dockDoor) shipRow.dock_door = plan.dockDoor;
        if (plan.dockTime) shipRow.dock_time = plan.dockTime;
        if (plan.loadingStart) shipRow.loading_start = plan.loadingStart;
        if (plan.loadingEnd) shipRow.loading_end = plan.loadingEnd;
        if (plan.dockIssue) shipRow.dock_issue = plan.dockIssue;

        // Create shipment
        console.log(`[BulkPlan/execute] INSERT payload:`, JSON.stringify(shipRow));
        let shipRes = await fetch(`${SUPABASE_URL}/rest/v1/shipments?on_conflict=id`, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(shipRow),
        });
        let shipData = await shipRes.json();

        // Fail loudly if dock columns are missing — run migrations before deploying
        if (!shipRes.ok && shipData?.message?.includes('dock_door')) {
          console.error(`[BulkPlan/execute] MIGRATION REQUIRED: dock columns (dock_door, dock_time, loading_start, loading_end) not found in shipments table. Run migrations 20260324120000_shipments_loading_times.sql and 20260406_shipments_dock_fields.sql.`);
          errors.push({ shipId, error: 'Dock columns missing in DB — run pending migrations' });
          continue;
        }

        if (!shipRes.ok) {
          console.error(`[BulkPlan/execute] Supabase INSERT FAILED:`, shipRes.status, JSON.stringify(shipData));
          errors.push({ shipId, error: shipData.message || 'DB insert failed' });
          continue;
        }
        const created = Array.isArray(shipData) ? shipData[0] : shipData;
        shipments.push(created);

        // Auto-generate BOL document for the new shipment (with line items + incoterms)
        try {
          const bolId = `BOL-${shipId}`;
          const today = new Date().toISOString().split('T')[0];
          const oIds = shipRow.order_ids || [];

          // Fetch line items for all linked orders
          let allLines = [];
          let linkedOrders = [];
          for (const oid of oIds) {
            try {
              const lines = await dbSelect('order_lines', `select=*&order_id=eq.${encodeURIComponent(oid)}&order=line_num.asc`, null);
              if (Array.isArray(lines)) allLines.push(...lines);
            } catch { /* skip */ }
            try {
              const ords = await dbSelect('orders', `select=*&id=eq.${encodeURIComponent(oid)}`, null);
              if (Array.isArray(ords) && ords.length) linkedOrders.push(ords[0]);
            } catch { /* skip */ }
          }
          const incoterms = linkedOrders.map((o) => o.incoterms).find(Boolean) || null;

          const bolRow = {
            id: bolId,
            type: 'BOL',
            status: 'Pending',
            ship: shipId,
            carrier: shipRow.carrier,
            generated: today,
            origin: shipRow.origin,
            dest: shipRow.dest,
            weight: shipRow.weight,
            pieces: shipRow.pieces,
            mode: shipRow.mode,
            pickup_date: shipRow.pickup_date,
            delivery_date: shipRow.delivery_date,
            order_ids: oIds,
            orders: linkedOrders,
            line_items: allLines,
            incoterms,
          };
          await fetch(`${SUPABASE_URL}/rest/v1/documents?on_conflict=id`, {
            method: 'POST',
            headers: {
              'apikey': SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'resolution=merge-duplicates,return=minimal',
            },
            body: JSON.stringify(bolRow),
          });
          // Update shipment with bol_number so it shows in shipment details
          await fetch(`${SUPABASE_URL}/rest/v1/shipments?id=eq.${encodeURIComponent(shipId)}`, {
            method: 'PATCH',
            headers: { 'apikey': SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ bol_number: bolId }),
          });
          console.log(`[BulkPlan/execute] Auto-generated BOL ${bolId} for ${shipId} (${allLines.length} lines, incoterms: ${incoterms})`);
        } catch (bolErr) {
          console.error(`[BulkPlan/execute] BOL auto-gen failed for ${shipId}:`, bolErr.message);
        }

        // Update each order
        for (const orderId of (plan.orderIds || [])) {
          const ordPatchRes = await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
            method: 'PATCH',
            headers: {
              'apikey': SERVICE_KEY,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ status: 'Planned', shipment_id: shipId }),
          });
          if (ordPatchRes.ok) {
            ordersUpdated++;
          } else {
            console.error(`[BulkPlan/execute] Order PATCH failed for ${orderId}:`, ordPatchRes.status, await ordPatchRes.text().catch(() => ''));
          }
        }

        console.log(`[BulkPlan/execute] ${shipId}: ${plan.origin} → ${plan.destination} | ${plan.carrier} | $${plan.totalCost} | ${(plan.orderIds || []).length} orders`);

      } catch (planErr) {
        errors.push({ lane: plan.laneKey, error: planErr.message });
        console.error('[BulkPlan/execute] Error:', planErr.message);
      }
    }

    console.log(`[BulkPlan/execute] Created ${shipments.length} shipments, updated ${ordersUpdated} orders`);
    res.json({ shipments, ordersUpdated, errors });

  } catch (e) {
    console.error('[BulkPlan/execute]', e.message);
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

// Temporary deploy endpoint — writes new index.html to the static directory
app.post('/api/deploy-index', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    // Write to the directory that serves static files (parent of api/)
    const targetPath = path.join(__dirname, '..', 'index.html');
    const { content } = req.body;
    if(!content) return res.status(400).json({error:'No content'});
    fs.writeFileSync(targetPath, content, 'utf8');
    res.json({ok:true, path:targetPath, bytes:content.length});
  } catch(e) { res.status(500).json({error:e.message}); }
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
  console.log('');
});

module.exports = app;
