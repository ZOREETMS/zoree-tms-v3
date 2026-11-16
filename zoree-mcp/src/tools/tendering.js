// ════════════════════════════════════════════════════════════════════
// tendering.js — tender a planned shipment to its carrier.
//
//   tender_shipment  (WRITE — status → Tendered, emails the carrier)
//
// Same two steps as "Tender" on the Shipments page (ShipmentsPage
// .tenderShipment) and ZoreeAI TENDER_SHIPMENT:
//   1. PATCH /api/shipments/:id { status:'Tendered', carrier }
//      — audited; the server's shipment→order status sync moves every
//      linked order to Tendered. An MBOL's CBOLs are tendered with it.
//   2. POST /api/tender/email — the load tender / rate confirmation to
//      the carrier's email from the carriers table (role-gated to admin
//      / planner server-side; honours TENDER_EMAIL_OVERRIDE). Best-
//      effort: a failed email never rolls the status back, as in the
//      web app. Skipped when the carrier has no email on file.
//
// Deliberate differences from the web app:
//   • Only the shipment's own carrier — tendering to a different carrier
//     would send a rate confirmation for a cost that was rated for
//     someone else. Change the carrier first.
//   • The email carries the real dock door/window, or none. The web app
//     fills "Door 1 / 06:00–08:00" when no dock is booked.
//   • dry_run returns exactly what would happen (recipient included)
//     without writing or sending, so the user can confirm first.
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { compact, safeHandler } = require('./format');
const { ZoreeApiError } = require('../services/zoreeApiClient');

const TENDERABLE = ['Planned', 'Tender Rejected'];
const enc = encodeURIComponent;
const norm = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Same fuzzy match as tenderService.findCarrierRecord in the web app. */
function findCarrier(carriers, name) {
  const t = norm(name);
  if (!t) return null;
  return (carriers || []).find((c) => {
    const n = norm(c.name || c.carrier_name || c.carrierName);
    return n && (n === t || n.includes(t) || t.includes(n));
  }) || null;
}

function carrierEmail(c) {
  return String((c && (c.email || c.contact_email || c.contactEmail)) || '').trim().toLowerCase();
}

async function loadShipment(api, id) {
  const data = await api.get('/api/shipments', { id });
  const s = data && Array.isArray(data.shipments) ? data.shipments[0] : null;
  if (!s) throw new ZoreeApiError(404, `Shipment ${id} not found`);
  return s;
}

async function orderDetails(api, orderIds) {
  const rows = await Promise.all(orderIds.map((oid) => api.get(`/api/orders/${enc(oid)}/full`).catch(() => null)));
  const found = rows.filter(Boolean);
  return {
    orderNumbers: orderIds,
    customerName: [...new Set(found.map((o) => o.customer).filter(Boolean))].join(', '),
    lineItems: found.flatMap((o) => (o.lines || []).map((l) => ({
      orderId: l.order_id || o.id || '',
      itemId: l.item_id || '',
      description: l.description || '',
      qty: l.qty_ordered || l.quantity || 0,
      unitWeight: l.unit_weight || l.unit_value || 0,
    }))),
  };
}

async function tenderShipment(api, { shipment_id, send_email = true, dry_run = false }) {
  const ship = await loadShipment(api, shipment_id);
  if (!TENDERABLE.includes(String(ship.status))) {
    throw new ZoreeApiError(409, `Shipment ${ship.id} is '${ship.status}' — only Planned or Tender Rejected shipments can be tendered`);
  }
  if (ship.bol_type === 'CBOL' && ship.master_shipment_id) {
    throw new ZoreeApiError(409, `${ship.id} is a CBOL of ${ship.master_shipment_id}; tender the master BOL instead`);
  }
  const carrierName = String(ship.carrier || '').trim();
  if (!carrierName) throw new ZoreeApiError(422, `Shipment ${ship.id} has no carrier — plan it with a carrier first`);

  const children = ship.bol_type === 'MBOL'
    ? ((await api.get('/api/shipments')).shipments || [])
      .filter((s) => s.master_shipment_id === ship.id && s.bol_type === 'CBOL')
      .sort((a, b) => (a.stop_to || 0) - (b.stop_to || 0))
    : [];
  const orderIds = [ship, ...children].flatMap((s) => s.order_ids || []);

  let carrier = null;
  if (send_email) {
    const list = await api.get('/api/carriers');
    carrier = findCarrier((list && list.carriers) || [], carrierName);
  }
  const to = carrierEmail(carrier);
  const emailPlan = !send_email ? 'not requested'
    : (to ? `to ${to}` : `skipped — no email on file for ${carrierName}`);
  const summary = compact({
    shipment_id: ship.id,
    carrier: carrierName,
    mode: ship.mode,
    lane: `${ship.origin || '?'} → ${ship.dest || '?'}`,
    pickup_date: ship.pickup_date,
    delivery_date: ship.delivery_date,
    total_cost: ship.total_cost,
    dock: ship.dock_door ? `${ship.dock_door} ${ship.dock_time || ''}`.trim() : 'none reserved',
    orders: orderIds,
    cbols: children.map((c) => c.id),
  });

  if (dry_run) {
    return { dry_run: true, would_tender: summary, email: emailPlan, nothing_written: true };
  }

  await api.patch(`/api/shipments/${enc(ship.id)}`, { status: 'Tendered', carrier: carrierName });
  for (const c of children) await api.patch(`/api/shipments/${enc(c.id)}`, { status: 'Tendered', carrier: carrierName });

  let email = emailPlan;
  let refNum;
  if (send_email && to) {
    refNum = `TND-${String(ship.id).replace(/^SHP-/i, '')}-${Math.floor(Math.random() * 9000 + 1000)}`;
    const route = children.length
      ? [ship.origin, ...children.map((c) => String(c.dest || '').split(',')[0].trim()).filter(Boolean)].join(' → ')
      : `${ship.origin || ''} → ${ship.dest || ''}`;
    try {
      const details = await orderDetails(api, orderIds);
      const res = await api.post('/api/tender/email', {
        shipmentId: ship.id,
        refNum,
        subject: `Load Tender: ${ship.id} — ${route}`,
        origin: ship.origin || '',
        dest: ship.dest || '',
        pickup: ship.pickup_date || '',
        delivery: ship.delivery_date || ship.shipment_end_date || '',
        mode: ship.mode || '',
        cost: ship.total_cost ?? '',
        weight: ship.weight ?? '',
        pieces: ship.pieces || '',
        commodity: ship.commodity || '',
        specialInstructions: ship.special_instructions || '',
        dockDoor: ship.dock_door || '',
        dockTime: ship.dock_time || '',
        ...details,
        childShipments: children.map((c, i) => ({
          id: c.id, stop: i + 1, origin: c.origin || '', dest: c.dest || '',
          delivery: c.delivery_date || c.shipment_end_date || '', weight: c.weight || '', pieces: c.pieces || '',
        })),
        to,
        carrierName,
        contactEmail: to,
        ...(carrier.contact || carrier.contact_name ? { contactName: carrier.contact || carrier.contact_name } : {}),
        ...(carrier.phone || carrier.contact_phone ? { contactPhone: carrier.phone || carrier.contact_phone } : {}),
      });
      email = res && res.sent
        ? `queued to ${res.to || to}${res.originalTo ? ` (override; carrier address ${res.originalTo})` : ''}`
        : `not sent — ${(res && (res.message || res.skipped)) || 'server did not send'}`;
    } catch (err) {
      email = `failed — ${err.message}. The shipment is still Tendered; resend from the Shipments page.`;
    }
  }

  return compact({
    tendered: true,
    ...summary,
    status: 'Tendered',
    tender_ref: refNum,
    email,
    note: ship.dock_door ? undefined : 'No dock door is reserved; the tender went out without one (reserve_dock can add it).',
  });
}

function registerTenderingTools(server, api) {
  server.registerTool('tender_shipment', {
    title: 'Tender shipment to carrier',
    description: 'Tender a Planned (or Tender Rejected) shipment to its own carrier, like "Tender" on the Shipments '
      + 'page: status → Tendered (audited; linked orders follow, an MBOL\'s CBOLs too) and the load tender / rate '
      + 'confirmation is emailed to the carrier\'s address on file. The email goes to a real carrier, so ALWAYS call '
      + 'with dry_run: true first, show the user the carrier, cost, dates, dock and recipient, and only call again '
      + 'without dry_run after they say yes. Undo with withdraw_tender.',
    inputSchema: {
      shipment_id: z.string().min(1).describe('Shipment id, e.g. SHP-2026-100996'),
      send_email: z.boolean().optional().describe('Email the carrier (default true)'),
      dry_run: z.boolean().optional().describe('Preview only — no status change, no email'),
    },
    annotations: {
      title: 'Tender shipment', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    },
  }, safeHandler((args) => tenderShipment(api, args)));
}

module.exports = { registerTenderingTools, tenderShipment, findCarrier };
