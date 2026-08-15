// ═══════════════════════════════════════════════════════════════════
// Teams bot command handlers.
//
// One entry point: handleActivity(activity) → reply activity (card).
// Commands come from typed text ("plan ORD-123 XPO") or from card
// button Action.Submit payloads (activity.value = { cmd, id, … }).
//
// Every mutation goes through tmsClient — i.e. the bot's own
// authenticated TMS session hitting the same endpoints the web app
// uses, so role gates, guards (post-tender date freeze), audit rows,
// and cascades all apply unchanged.
//
// Accept is deliberately server-side-complete: PATCH status → OMS push
// → /api/notify broadcast, mirroring the client-side
// propagateTenderAcceptance() so an accept from Teams behaves exactly
// like one from the web UI (see docs/CLAUDE_RULES + agentic plan:
// "accept cascade must move server-side" — this is that shape).
// ═══════════════════════════════════════════════════════════════════

'use strict';

const tms = require('./tmsClient');
const cards = require('./cards');
const { cardActivity, textActivity } = require('./connector');
// Bug #64 (Teams flavor): web plans get a dock door + loading window
// from frontend dockService.assignDockToPlan; bot plans went straight
// to /bulk-plan/execute with no dock fields, so Shipment Details
// showed Dock Door / Loading Start / Loading End as "—". The shared
// server-side port fills the same four fields the same way.
const { assignDockToPlan } = require('../dockAssign');

const LIST_LIMIT = 8;

// ── helpers ────────────────────────────────────────────────────────
function stripMentions(text) {
  // Teams wraps @mentions in <at>…</at>
  return String(text || '').replace(/<at>.*?<\/at>/g, '').trim();
}

// People type "plan order ORD-123", "tender the shipment SHP-9", "accept
// SHP-9 please" — not just bare ids. Drop filler words and pick the first
// token that actually looks like an id (has a digit), so natural phrasing
// works without teaching anyone a command syntax.
const FILLER = new Set(['order', 'orders', 'shipment', 'shipments', 'the', 'a', 'my', 'this', 'please', 'for', 'to', 'id', 'no', 'number', '#']);

function looksLikeId(token) {
  return /\d/.test(token);
}

// Every word the dispatch switch understands (all case labels below).
// Used to find the command verb ANYWHERE in the sentence — people ask
// "can you plan ORD-123" / "please unplan the order ORD-456", not
// "plan ORD-123". Left-to-right scan, first known word wins: in
// "can you plan the order ORD-1", `plan` is hit before the filler
// word `order` can be mistaken for the order-detail command.
const COMMAND_WORDS = new Set([
  'today', 'summary', 'orders', 'shipments', 'order', 'shipment', 'track',
  'rate', 'quote', 'plan', 'unplan', 'unassign', 'tender', 'accept',
  'reject', 'withdraw', 'intransit', 'transit', 'pickup', 'delivered',
  'deliver', 'help', 'clear', 'reset',
]);

function normToken(t) {
  return String(t || '').toLowerCase().replace(/[,.:!?#]/g, '');
}

// Commands that CHANGE data. A question must never trigger one of these —
// "what are the carrier options available to plan ORD-1" contains `plan`
// but is asking for rates, not asking to create a shipment (real incident
// 2026-08-09: the verb scan planned an order the user was only asking
// about). Questions fall through to a read-only interpretation instead.
const MUTATING_WORDS = new Set([
  'plan', 'unplan', 'unassign', 'tender', 'accept', 'reject', 'withdraw',
  'intransit', 'transit', 'pickup', 'delivered', 'deliver',
  // deletes bot messages — "what does clear do?" must not wipe the chat
  'clear', 'reset',
]);

// Sentence openers that mark an information question. "can/could you…"
// is deliberately NOT here — that's a polite imperative and should act.
const QUESTION_STARTERS = new Set([
  'what', 'whats', "what's", 'which', 'how', 'why', 'who', 'whos',
  'where', 'when', 'is', 'are', 'was', 'were', 'do', 'does', 'did',
]);

// Words that signal the user wants carrier quotes / pricing.
const RATE_HINTS = new Set([
  'carrier', 'carriers', 'rate', 'rates', 'rating', 'quote', 'quotes',
  'cost', 'costs', 'price', 'prices', 'pricing', 'option', 'options',
]);

function parseArgs(parts) {
  const meaningful = parts.filter((p) => !FILLER.has(p.toLowerCase().replace(/[,.:#]/g, '')));
  const idIndex = meaningful.findIndex(looksLikeId);
  if (idIndex === -1) return { id: meaningful[0] || '', rest: meaningful.slice(1).join(' ') };
  return {
    id: meaningful[idIndex].replace(/[,.]$/, ''),
    rest: meaningful.slice(idIndex + 1).join(' '),
  };
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.orders)) return data.orders;
  if (data && Array.isArray(data.shipments)) return data.shipments;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

const PLANNED_OR_LATER = new Set([
  'Planned', 'Shipped', 'In Transit', 'Delivered', 'Cancelled', 'Confirmed',
]);

// ── command implementations ────────────────────────────────────────
async function cmdOrders() {
  const data = await tms.get('/orders');
  const unplanned = rowsOf(data)
    // shipment link is camelCase `shipmentId` in /api/orders responses
    // (see cmdUnplan) — check both casings so the filter isn't dead code.
    .filter((o) => o && o.id && !PLANNED_OR_LATER.has(o.status) && !(o.shipmentId || o.shipment_id))
    .slice(0, LIST_LIMIT);
  return cardActivity(cards.ordersCard(unplanned), 'Unplanned orders');
}

async function cmdShipments() {
  const data = await tms.get('/shipments');
  const recent = rowsOf(data).slice(0, LIST_LIMIT);
  return cardActivity(cards.shipmentsCard(recent), 'Recent shipments');
}

async function fetchShipment(id) {
  const data = await tms.get(`/shipments?id=${encodeURIComponent(id)}`);
  const rows = rowsOf(data);
  const ship = rows.find((s) => s && s.id === id) || rows[0];
  if (!ship) {
    const err = new Error(`Shipment ${id} not found`);
    err.status = 404;
    throw err;
  }
  return ship;
}

// ── plan-time date math ────────────────────────────────────────────
// Tiny mirror of frontend bulkPlanService.calcDates/addBusinessDays.
// The bot runs dep-free on the server and can't import the frontend
// service, so keep this in sync with bulkPlanService.js if the web
// planner's date semantics ever change.
function addBusinessDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  const step = days >= 0 ? 1 : -1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

function calcDates(transit, dueDate, readyDate) {
  if (!transit) return null;
  const today = new Date().toISOString().slice(0, 10);
  const minPickup = today > (readyDate || '') ? today : (readyDate || today);
  let pickup = minPickup;
  if (dueDate) {
    const idealPickup = addBusinessDays(dueDate, -transit);
    if (idealPickup >= minPickup) pickup = idealPickup;
  }
  return { pickup, delivery: addBusinessDays(pickup, transit), transit };
}

// One lane shape shared by `rates` and `plan` so the two commands can
// never drift apart on what they send the rating engine.
function laneOf(order) {
  return {
    laneKey:       order.id,
    // origin/destination address strings are REQUIRED for TL rating and
    // city_to_city LTL rates: /bulk-plan/rate runs extractCity(lane.origin)
    // to match rates-table rows, and /api/ltl/quote does the same for
    // city_to_city matches. Without them the bot's rate/plan commands
    // only ever saw zip-matched LTL rates — no TL quotes, no city-lane
    // rates, no PC*MILER miles (found 2026-08-09 via "where are the TL
    // rates?"). Mirrors frontend laneUtils.buildSingleOrderLane.
    // dbToOrderApi maps DB `dest` → `destination` (NO `dest` alias —
    // third casing bite after shipmentId and the mapper aliases; check
    // the mapper, not your assumptions, for every field read off
    // /api/orders). order.dest is undefined → empty dCity → the TL
    // matcher matched 0 city_to_city rates while the web (which sends
    // full strings) matched 8. Read both, destination first.
    origin:        order.origin || '',
    destination:   order.destination || order.dest || '',
    originZip:     order.origin_zip || '',
    destZip:       order.dest_zip || '',
    totalWeight:   Number(order.weight) || 1000,
    freightClass:  order.freight_class || 70,
    orderIds:      [order.id],
    originCountry: order.origin_country || 'USA',
    destCountry:   order.dest_country || 'USA',
  };
}

async function cmdPlan(orderId, carrier) {
  // Ops phrasing tolerance (2026-08-11): "plan ORD-123 with the cheapest
  // option" / "use the best rate" — those trailing words land in the
  // carrier slot and would previously be treated as a carrier named
  // "the cheapest option" (no quote match → planned UNRATED). They mean
  // "no carrier preference": let the engine's bestQuote pick.
  if (carrier && /^(?:with\s+|use\s+)?(?:the\s+)?(cheapest|best|lowest|recommended)(\s+(option|rate|carrier|quote|one))?$/i.test(carrier.trim())) {
    carrier = '';
  }
  const data = await tms.get(`/orders`);
  const order = rowsOf(data).find((o) => o && o.id === orderId);
  if (!order) return cardActivity(cards.errorCard(`Order ${orderId} not found.`));
  if (PLANNED_OR_LATER.has(order.status)) {
    return cardActivity(cards.errorCard(`Order ${orderId} is already ${order.status}.`));
  }

  // Rate the lane first — same call the web Bulk Plan page makes — so the
  // shipment lands with real cost / equipment / dates instead of zeros
  // (the old flow posted totalCost:0, rate:0 and nothing else, leaving
  // the Shipment Details modal half-empty). If rating is down or returns
  // nothing, fall through to an unrated plan like before.
  let quote = null;
  try {
    const rated = await tms.post('/bulk-plan/rate', { lanes: [laneOf(order)] });
    const lane = (rated && rated.results && rated.results[0])
      || (Array.isArray(rated) ? rated[0] : null);
    const quotes = ((lane && lane.quotes) || []).filter((q) => q && !q.infeasible);
    if (carrier) {
      // The user named a carrier — honor it. Use its quote when one came
      // back; when it didn't, keep the carrier and plan unrated rather
      // than silently switching them to the engine's pick.
      const want = carrier.toLowerCase();
      quote = quotes.find((q) => (q.carrier || '').toLowerCase().includes(want)) || null;
    } else {
      quote = (lane && lane.bestQuote) || quotes[0] || null;
    }
  } catch { /* rating unavailable → unrated plan below */ }

  // Casing bite #4: /api/orders (dbToOrderApi) exposes camelCase
  // `dueDate` / `readyDate` — NOT `due_date` / `due`. cmdRate already
  // reads dueDate first; this call didn't, so calcDates got dueDate=''
  // and silently fell back to forward planning (pickup = ready/today)
  // instead of just-in-time backward planning from the due date
  // (found 2026-08-11 via SHP-2026-713662: picked up 08-09 with due 08-28).
  const dates = quote
    ? calcDates(
        quote.transitDays,
        order.dueDate || order.due_date || order.due || '',
        order.readyDate || order.ready_date || order.ready || '',
      )
    : null;

  const plan = {
    orderIds: [order.id],
    carrier: carrier || (quote && quote.carrier) || order.preferred_carrier || '',
    mode: (quote && quote.mode) || order.mode || 'LTL',
    origin: order.origin || '',
    // Same dbToOrderApi mapping gotcha as laneOf: the field is
    // `destination`, not `dest`. Bot-planned shipments were being
    // created with an empty destination string because of this.
    destination: order.destination || order.dest || '',
    originZip: order.origin_zip || null,
    destZip: order.dest_zip || null,
    shipFromName: order.ship_from_name || null,
    shipToName: order.ship_to_name || null,
    originCountry: order.origin_country || 'USA',
    destCountry: order.dest_country || 'USA',
    totalWeight: Number(order.weight) || 0,
    totalPieces: Number(order.pieces) || 0,
    // Quote → plan field mapping mirrors bulkPlanService.buildPlan so a
    // Teams-planned shipment carries the same cost detail as a web one.
    totalCost:     (quote && quote.totalCharge) || 0,
    rate:          (quote && (quote.czarBaseGross || quote.czarBase)) || 0,
    fuelSurcharge: (quote && quote.fscCharge) || 0,
    accessorials:  (quote && quote.accessorialCharge) || 0,
    pickupDate:    (dates && dates.pickup) || null,
    deliveryDate:  (dates && dates.delivery) || null,
    transitDays:   (dates && dates.transit) || null,
    serviceLevel:  (quote && quote.serviceLevel) || null,
    miles:         (quote && (quote.pcmilerMiles || quote.miles)) || null,
    czarliteRate:  !!(quote && quote.mode === 'LTL'),
    rateId:        (quote && quote.rateId) || null,
    equipment:     (quote && quote.equipment) || null,
  };
  // Auto-assign a dock door + loading window (least-occupied door for
  // this pickup date + origin), mirroring the web planner. Best-effort:
  // if any lookup fails the plan still executes — the dock can be set
  // later from the Dock Scheduling page — matching the web fallback in
  // bulkPlanService.planOrdersAsSingleShipment.
  try {
    const [shipData, dockConfigs, durations] = await Promise.all([
      tms.get('/shipments').catch(() => null),
      tms.get('/db/warehouse_dock_config?q=select=*%26order=warehouse.asc%26limit=200').catch(() => []),
      tms.get('/db/dock_loading_durations?q=select=*%26order=mode.asc%26limit=50').catch(() => []),
    ]);
    assignDockToPlan(plan, {
      existingShipments: rowsOf(shipData),
      dockConfigs: Array.isArray(dockConfigs) ? dockConfigs : [],
      durations: Array.isArray(durations) ? durations : [],
    });
  } catch (dockErr) {
    console.warn('[teamsBot] dock assignment failed (planning without dock):', dockErr.message);
  }

  const result = await tms.post('/bulk-plan/execute', { plans: [plan] });
  const shipment = (result && result.shipments && result.shipments[0]) || null;
  const note = quote
    ? null
    : (carrier
      ? `No rate found for "${carrier}" on this lane — planned without cost/dates. Run \`rates ${orderId}\` to see quotes.`
      : `Rating returned no quotes — planned without cost/dates. Run \`rates ${orderId}\` or set costs in the TMS.`);
  return cardActivity(cards.planResultCard({ shipment, orderId, errors: result && result.errors, note }));
}

async function cmdTender(shipmentId) {
  // Guards first (2026-08-11): the old command blind-PATCHed to
  // 'Tendered', so tendering a nonexistent id produced a raw server
  // error, re-tendering was silently "fine", and a carrier-less
  // shipment went out with nobody to answer it.
  const before = await fetchShipment(shipmentId); // throws 404 → errorCard
  if (before.status === 'Tendered') {
    return cardActivity(cards.tenderStatusCard({
      shipment: before,
      headline: `📤 Already tendered — ${shipmentId}`,
      color: 'Warning',
      note: 'This shipment is already out with the carrier — pending their response. ' +
        'No duplicate tender was sent. To pull it back, type `withdraw ' + shipmentId + '`.',
    }));
  }
  if (before.status !== 'Planned') {
    return cardActivity(cards.errorCard(
      `Shipment ${shipmentId} is '${before.status}' — only a Planned shipment can be tendered.`
    ));
  }
  if (!before.carrier) {
    return cardActivity(cards.errorCard(
      `Shipment ${shipmentId} has no carrier — plan it with a carrier first (\`rates <orderId>\` → Plan with …).`
    ));
  }

  // 1. Status transition through the real seam: PATCH /shipments/:id/status
  //    → shipService.updateShipment → change_history row + linked orders
  //    cascade to 'Tendered' (SHIPMENT_STATUS_TO_ORDER_STATUS) + teamsNotify.
  const ship = await tms.patch(`/shipments/${encodeURIComponent(shipmentId)}/status`, { status: 'Tendered' });

  // 2. Tender record: POST /tendering/out writes the SHIPMENT_TENDER row
  //    in message_log (the messaging-hub ledger) and mints the
  //    correlation id the carrier's accept/decline will reference.
  //    Best-effort — the status transition above is the load-bearing part.
  let tenderRef = null;
  try {
    const out = await tms.post('/tendering/out', {
      shipmentId,
      carrierId: before.carrier || null,
      payload: {
        shipmentId,
        carrier:      before.carrier || null,
        mode:         before.mode || null,
        origin:       before.origin || null,
        destination:  before.dest || before.destination || null,
        totalCost:    before.total_cost || before.cost || null,
        pickupDate:   before.pickup_date || before.pickupDate || null,
        deliveryDate: before.delivery_date || before.deliveryDate || null,
        via:          'teams-bot',
      },
    });
    tenderRef = out && out.correlationId ? out.correlationId : null;
  } catch (e) {
    console.warn('[teamsBot] tender record failed:', e.message);
  }

  const sentAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return cardActivity(cards.tenderStatusCard({
    shipment: ship && ship.id ? ship : { ...before, id: shipmentId, status: 'Tendered' },
    headline: `📤 Tender sent — ${shipmentId}`,
    color: 'Accent',
    note: `Tender status: **Sent — pending carrier acceptance** · ${sentAt}` +
      (tenderRef ? `\n\nTender ref: \`${tenderRef}\` — the carrier's system answers with this id.` : '') +
      '\n\nThe carrier accepts or declines on their side. If their response arrives by phone/email instead, ' +
      'record it with `accept ' + shipmentId + '` or `reject ' + shipmentId + '`.',
  }));
}

async function cmdAccept(shipmentId) {
  const before = await fetchShipment(shipmentId);
  const ship = await tms.patch(`/shipments/${encodeURIComponent(shipmentId)}/status`, { status: 'Tender Accepted' });
  const merged = { ...before, ...(ship && ship.id ? ship : {}) };

  // Server-side mirror of frontend propagateTenderAcceptance():
  // OMS push + WS broadcast, both best-effort, never blocking the reply.
  const sideEffects = [];
  try {
    await tms.post('/oms/push', {
      shipmentId,
      carrier: merged.carrier || '',
      mode: merged.mode || '',
      serviceLevel: merged.service_level || merged.serviceLevel || '',
      pickupDate: merged.pickup_date || merged.pickupDate || '',
      deliveryDate: merged.delivery_date || merged.deliveryDate || '',
    });
    sideEffects.push('OMS updated');
  } catch (e) {
    sideEffects.push(`OMS push failed: ${e.message}`);
  }
  try {
    await tms.post('/notify', {
      event: 'tender_accepted',
      data: { shipmentId, carrier: merged.carrier || '', via: 'teams-bot' },
    });
    sideEffects.push('clients notified');
  } catch (e) {
    sideEffects.push(`broadcast failed: ${e.message}`);
  }

  return cardActivity(cards.tenderStatusCard({
    shipment: merged,
    headline: `✅ Tender accepted — ${shipmentId}`,
    color: 'Good',
    note: sideEffects.join(' · '),
  }));
}

// ── today: one-glance summary ──────────────────────────────────────
async function cmdToday() {
  const [orderData, shipData] = await Promise.all([
    tms.get('/orders'),
    tms.get('/shipments'),
  ]);
  const orders = rowsOf(orderData);
  const shipments = rowsOf(shipData);
  const todayStr = new Date().toISOString().slice(0, 10);
  const isToday = (v) => typeof v === 'string' && v.slice(0, 10) === todayStr;

  return cardActivity(cards.todayCard({
    unplanned:      orders.filter((o) => o && !PLANNED_OR_LATER.has(o.status) && !(o.shipmentId || o.shipment_id)).length,
    planned:        shipments.filter((s) => s && s.status === 'Planned').length,
    tendered:       shipments.filter((s) => s && s.status === 'Tendered').length,
    inTransit:      shipments.filter((s) => s && s.status === 'In Transit').length,
    deliveredToday: shipments.filter((s) => s && s.status === 'Delivered'
                      && (isToday(s.delivery_date) || isToday(s.updated_at))).length,
    exceptions:     shipments.filter((s) => s && (s.status === 'Exception' || s.status === 'Tender Rejected')).length,
  }), 'Today at a glance');
}

// ── detail lookups ─────────────────────────────────────────────────
async function cmdOrderDetail(orderId) {
  // Symmetric with cmdShipmentDetail: an SHP id here means "the order's
  // shipment" phrasing landed on the order command — show the shipment.
  if (/^SHP/i.test(orderId)) return cmdShipmentDetail(orderId);
  const order = rowsOf(await tms.get('/orders')).find((o) => o && o.id === orderId);
  if (!order) return cardActivity(cards.errorCard(`Order ${orderId} not found.`));
  let linked = null;
  // camelCase gotcha: /api/orders exposes shipmentId (no snake alias) —
  // the old order.shipment_id check was permanently false, so the
  // linked-shipment section never rendered on any order card.
  const linkedId = (order.shipmentId || order.shipment_id) || null;
  if (linkedId) {
    linked = await fetchShipment(linkedId).catch(() => null);
  }
  return cardActivity(cards.orderDetailCard(order, linked), `Order ${orderId}`);
}

async function cmdShipmentDetail(shipmentId) {
  // People ask for "the shipment for order ORD-…" — resolve an order id
  // to its linked shipment instead of failing "Shipment ORD-… not found".
  if (/^ORD/i.test(shipmentId)) {
    const order = rowsOf(await tms.get('/orders')).find((o) => o && o.id === shipmentId);
    if (!order) return cardActivity(cards.errorCard(`Order ${shipmentId} not found.`));
    const linkedId = (order.shipmentId || order.shipment_id) || null;
    if (!linkedId) {
      return cardActivity(cards.errorCard(
        `Order ${shipmentId} has no shipment yet (status: ${order.status || 'Unplanned'}). Plan it with \`plan ${shipmentId}\`.`
      ));
    }
    shipmentId = linkedId;
  }
  const ship = await fetchShipment(shipmentId);

  // Tender status + lifecycle timeline (2026-08-11): pulled LIVE from
  // change_history via GET /shipments/:id/history — never from anything
  // cached in the conversation — so the card always reflects what the
  // database says right now. Best-effort: a history hiccup only costs
  // the timeline, never the status card itself.
  let extras = null;
  try {
    const hist = await tms.get(`/shipments/${encodeURIComponent(ship.id)}/history?limit=25`);
    const rows = (hist && Array.isArray(hist.rows)) ? hist.rows : [];
    // Status milestones, oldest → newest, deduped consecutive repeats.
    const statusRows = rows
      .filter((r) => r && (r.action === 'status' || r.action === 'create' || r.action === 'plan'))
      .reverse();
    const steps = [];
    for (const r of statusRows) {
      const label = r.action === 'create' || r.action === 'plan'
        ? 'Planned'
        : (r.new_value || '');
      if (label && steps[steps.length - 1] !== label) steps.push(label);
    }
    if (!steps.length && ship.status) steps.push(ship.status);

    const tsOf = (pred) => {
      const row = rows.find(pred); // rows are newest-first
      return row && row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : null;
    };
    const tenderStatus =
      ship.status === 'Tendered'        ? 'Sent — pending carrier acceptance' :
      ship.status === 'Tender Accepted' ? 'Accepted by carrier' :
      ship.status === 'Tender Rejected' ? 'Rejected by carrier' :
      ['Confirmed', 'In Transit', 'Delivered'].includes(ship.status) ? 'Accepted' : null;
    const tenderTime =
      ship.status === 'Tendered'
        ? tsOf((r) => r.action === 'status' && r.new_value === 'Tendered')
        : tsOf((r) => r.action === 'status' && (r.new_value === 'Tender Accepted' || r.new_value === 'Tender Rejected'));
    const latest = rows[0]
      ? `${(rows[0].new_value || rows[0].action || '').toString()} · ${String(rows[0].created_at || '').replace('T', ' ').slice(0, 16)}`
        + (rows[0].metadata && rows[0].metadata.via ? ` · via ${rows[0].metadata.via}` : '')
      : null;
    extras = { tenderStatus, tenderTime, timeline: steps.join(' → '), latest };
  } catch (histErr) {
    console.warn('[teamsBot] history fetch failed:', histErr.message);
  }

  return cardActivity(cards.shipmentDetailCard(ship, extras), `Shipment ${shipmentId}`);
}

// ── rating ─────────────────────────────────────────────────────────
async function cmdRate(orderId) {
  const order = rowsOf(await tms.get('/orders')).find((o) => o && o.id === orderId);
  if (!order) return cardActivity(cards.errorCard(`Order ${orderId} not found.`));

  const result = await tms.post('/bulk-plan/rate', { lanes: [laneOf(order)] });

  const lane = (result && result.results && result.results[0])
    || (Array.isArray(result) ? result[0] : null);
  if (!lane) return cardActivity(cards.errorCard(`Rating returned nothing for ${orderId}.`));
  if (lane.error) return cardActivity(cards.errorCard(`Rating failed for ${orderId}: ${lane.error}`));

  // Quotes come back pre-sorted (preferred first, then cheapest/fastest),
  // with the first feasible one flagged `recommended` by the rate engine.
  // Sridhar 2026-08-09: hide carriers with no transit days — without
  // transit there's no pickup/delivery window to offer, so the row is
  // useless for a planning decision. Fall back to the unfiltered list
  // only if NO quote has transit (else the card would claim "no rates"
  // when the engine did return prices).
  const feasible = (lane.quotes || []).filter((q) => q && !q.infeasible);
  const withTransit = feasible.filter((q) => q.transitDays);
  // Enrich each quote with the pickup/delivery dates a plan with that
  // carrier would get — same calcDates the plan command uses — so the
  // card can show cost AND the shipment window per carrier.
  const quotes = (withTransit.length ? withTransit : feasible).map((q) => ({
    ...q,
    dates: calcDates(
      q.transitDays,
      order.dueDate || order.due_date || order.due || '',
      order.readyDate || order.ready_date || order.ready || '',
    ),
  }));
  return cardActivity(cards.ratesCard(orderId, quotes, lane.loadType), `Quotes for ${orderId}`);
}

// ── unplan ─────────────────────────────────────────────────────────
// Mirrors the web Unplan action (orderWriteService.unassignOrderFromShipment):
// PATCH /api/orders/:id { status:'Unplanned', shipmentId:null }. The server
// owns the cascade — it clears the link, deletes the shipment when its last
// order is removed, recalcs totals otherwise, and writes change_history.
// Accepts either an order id or a shipment id ("unplan SHP-…" unassigns
// every order on that shipment, same loop the web runs for shipment removal).
async function cmdUnplan(id) {
  const isShipment = /^SHP/i.test(id);
  const data = await tms.get('/orders');
  const orders = rowsOf(data);
  // GET /api/orders maps rows through dbToOrderApi, which exposes
  // shipment_id ONLY as camelCase `shipmentId` (unlike ship_mode /
  // service_level, which get dual-casing aliases). Read both casings so
  // this survives if the mapper ever gains the snake alias.
  const shipIdOf = (o) => (o && (o.shipmentId || o.shipment_id)) || null;

  let targets;
  if (isShipment) {
    targets = orders.filter((o) => shipIdOf(o) === id);
    if (!targets.length) {
      return cardActivity(cards.errorCard(`No orders found on shipment ${id} — is the id right? Run \`shipments\` to check.`));
    }
  } else {
    const order = orders.find((o) => o && o.id === id);
    if (!order) return cardActivity(cards.errorCard(`Order ${id} not found.`));
    if (!shipIdOf(order)) {
      return cardActivity(cards.errorCard(`Order ${id} is not on a shipment (status: ${order.status || 'Unplanned'}) — nothing to unplan.`));
    }
    targets = [order];
  }

  const shipmentId = shipIdOf(targets[0]);
  for (const o of targets) {
    await tms.patch(`/orders/${encodeURIComponent(o.id)}`, { status: 'Unplanned', shipmentId: null });
  }
  const ids = targets.map((o) => o.id).join(', ');
  return textActivity(
    `↩ Unplanned ${ids} (was on ${shipmentId}). ` +
    `The shipment is deleted automatically once its last order is removed. ` +
    `Re-plan with \`plan ${targets[0].id}\` — it will get a dock door + loading window this time.`
  );
}

// ── generic status transition (delivered / in transit / withdraw) ───
async function cmdSetStatus(shipmentId, status, headline, color, note) {
  const ship = await tms.patch(`/shipments/${encodeURIComponent(shipmentId)}/status`, { status });
  return cardActivity(cards.tenderStatusCard({
    shipment: ship && ship.id ? ship : { id: shipmentId, status },
    headline,
    color,
    note,
  }));
}

async function cmdReject(shipmentId) {
  const ship = await tms.patch(`/shipments/${encodeURIComponent(shipmentId)}/status`, { status: 'Tender Rejected' });
  return cardActivity(cards.tenderStatusCard({
    shipment: ship && ship.id ? ship : { id: shipmentId, status: 'Tender Rejected' },
    headline: `❌ Tender rejected — ${shipmentId}`,
    color: 'Attention',
    note: 'Re-plan the load with another carrier from the Shipments page, or run `shipments` here.',
  }));
}

// ── dispatch ───────────────────────────────────────────────────────
async function handleActivity(activity) {
  if (!activity || activity.type !== 'message') {
    // conversationUpdate (bot added), etc. — greet once
    if (activity && activity.type === 'conversationUpdate' &&
        Array.isArray(activity.membersAdded) &&
        activity.membersAdded.some((m) => m.id === (activity.recipient && activity.recipient.id))) {
      return cardActivity(cards.helpCard(), 'Zoree TMS bot');
    }
    return null; // ignore typing indicators etc.
  }

  // Button click → activity.value; typed text → activity.text
  const v = activity.value || {};
  let cmd = v.cmd || '';
  let arg1 = v.id || '';
  let arg2 = v.carrier || '';

  if (!cmd) {
    const parts = stripMentions(activity.text).split(/\s+/).filter(Boolean);
    const norm = parts.map(normToken);
    // Natural-language tolerance: find the first known command word in
    // the sentence instead of requiring it at position 0, so "can you
    // plan ORD-123" works the same as "plan ORD-123".
    const verbIdx = norm.findIndex((p) => COMMAND_WORDS.has(p));
    const isQuestion = QUESTION_STARTERS.has(norm[0]) || /\?\s*$/.test(parts[parts.length - 1] || '');

    if (verbIdx !== -1 && !(isQuestion && MUTATING_WORDS.has(norm[verbIdx]))) {
      cmd = norm[verbIdx];
      const parsed = parseArgs(parts.slice(verbIdx + 1));
      arg1 = parsed.id;
      arg2 = parsed.rest;
    } else {
      // Question (or no verb): NEVER mutate. Pick the read-only command
      // that best matches what they're asking about:
      //   rate-ish words + order id → rate (carrier options + costs)
      //   SHP id → shipment detail · ORD id → order detail
      //   otherwise → help card via the switch default.
      const parsed = parseArgs(parts);
      const hasRateHint = norm.some((p) => RATE_HINTS.has(p));
      if (hasRateHint && /^ORD/i.test(parsed.id)) {
        cmd = 'rate'; arg1 = parsed.id;
      } else if (/^SHP/i.test(parsed.id)) {
        cmd = 'shipment'; arg1 = parsed.id;
      } else if (/^ORD/i.test(parsed.id)) {
        cmd = 'order'; arg1 = parsed.id;
      } else {
        cmd = norm[0] || '';
      }
    }
  }

  try {
    switch (cmd) {
      case 'today':
      case 'summary':   return await cmdToday();
      case 'orders':    return await cmdOrders();
      case 'shipments': return await cmdShipments();
      case 'order':
        if (!arg1) return textActivity('Usage: `order <orderId>`');
        return await cmdOrderDetail(arg1);
      case 'shipment':
      case 'track':
        if (!arg1) return textActivity('Usage: `shipment <shipmentId>`');
        return await cmdShipmentDetail(arg1);
      case 'rate':
      case 'quote':
        if (!arg1) return textActivity('Usage: `rate <orderId>`');
        return await cmdRate(arg1);
      case 'plan':
        if (!arg1) return textActivity('Usage: `plan <orderId> [carrier]`');
        return await cmdPlan(arg1, arg2);
      case 'unplan':
      case 'unassign':
        if (!arg1) return textActivity('Usage: `unplan <orderId | shipmentId>`');
        return await cmdUnplan(arg1);
      case 'tender':
        if (!arg1) return textActivity('Usage: `tender <shipmentId>`');
        return await cmdTender(arg1);
      case 'accept':
        if (!arg1) return textActivity('Usage: `accept <shipmentId>`');
        return await cmdAccept(arg1);
      case 'reject':
        if (!arg1) return textActivity('Usage: `reject <shipmentId>`');
        return await cmdReject(arg1);
      case 'withdraw':
        if (!arg1) return textActivity('Usage: `withdraw <shipmentId>`');
        return await cmdSetStatus(arg1, 'Planned', `↩ Tender withdrawn — ${arg1}`, 'Warning',
          'Back to Planned. Re-tender when you have a carrier.');
      case 'intransit':
      case 'transit':
      case 'pickup':
        if (!arg1) return textActivity('Usage: `intransit <shipmentId>`');
        return await cmdSetStatus(arg1, 'In Transit', `🚛 In transit — ${arg1}`, 'Accent',
          'Picked up. Linked orders follow the shipment status.');
      case 'delivered':
      case 'deliver':
        if (!arg1) return textActivity('Usage: `delivered <shipmentId>`');
        return await cmdSetStatus(arg1, 'Delivered', `📦 Delivered — ${arg1}`, 'Good',
          'Delivery recorded. POD and invoicing continue in the TMS.');
      case 'clear':
      case 'reset':
        // Sentinel — actual deletion happens in routes/teamsBot.js where
        // the SDK TurnContext (deleteActivity) lives. See sentLog.js.
        return { type: 'clearConversation' };
      case 'help':
      case 'hi':
      case 'hello':
      default:
        return cardActivity(cards.helpCard(), 'Zoree TMS bot');
    }
  } catch (err) {
    console.error(`[teamsBot] command '${cmd}' failed:`, err.message);
    return cardActivity(cards.errorCard(err.message || 'Unknown error'));
  }
}

module.exports = { handleActivity };
