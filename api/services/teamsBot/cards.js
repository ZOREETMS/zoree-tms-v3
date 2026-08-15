// ═══════════════════════════════════════════════════════════════════
// Adaptive Card builders for the Teams bot.
//
// Pure functions: data in → card JSON out. No fetches, no state.
// Buttons use Action.Submit with a { cmd, id, carrier } payload that
// Teams echoes back as activity.value (messageBack), dispatched in
// handlers.js. Keep version 1.4 — highest Teams reliably renders.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { webLink } = require('../teamsConfig');

const CARD_BASE = {
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
};

function submitAction(title, data, style) {
  return {
    type: 'Action.Submit',
    title,
    style,
    data: { msteams: { type: 'messageBack', text: '' }, ...data },
  };
}

function openInZoree(screen, id) {
  return {
    type: 'Action.OpenUrl',
    title: 'Open in Zoree TMS',
    url: webLink(screen, id),
  };
}

function title(text, color) {
  return { type: 'TextBlock', text, weight: 'Bolder', size: 'Medium', color: color || 'Default', wrap: true };
}

function line(text, subtle) {
  return { type: 'TextBlock', text, wrap: true, isSubtle: !!subtle, spacing: 'Small' };
}

// ── help ───────────────────────────────────────────────────────────
function helpCard() {
  return {
    ...CARD_BASE,
    body: [
      title('🚛 Zoree TMS bot — commands'),
      line('**today** — everything at a glance'),
      line('**orders** / **shipments** — unplanned orders · recent shipments'),
      line('**order** `<id>` / **shipment** `<id>` — full detail'),
      line('**rate** `<orderId>` — carrier quotes before you commit'),
      line('**plan** `<orderId>` `[carrier]` — create a shipment'),
      line('**unplan** `<orderId | shipmentId>` — undo a plan (order back to Unplanned)'),
      line('**tender** / **accept** / **reject** / **withdraw** `<shipmentId>`'),
      line('**intransit** / **delivered** `<shipmentId>` — move it along'),
      line('**clear** — remove the bot’s messages from this chat'),
      line('Plain phrasing works: "plan order ORD-140346 with XPO".', true),
      line('Every action runs as the bot TMS user and is written to change history.', true),
    ],
    actions: [
      submitAction('📊 Today', { cmd: 'today' }),
      submitAction('📋 Orders', { cmd: 'orders' }),
      submitAction('🚚 Shipments', { cmd: 'shipments' }),
      openInZoree(),
    ],
  };
}

// ── today: one-glance summary ──────────────────────────────────────
function todayCard({ unplanned, tendered, inTransit, deliveredToday, exceptions, planned }) {
  const stat = (label, value) => ({
    type: 'Column', width: 'stretch',
    items: [
      { type: 'TextBlock', text: String(value), size: 'ExtraLarge', weight: 'Bolder', horizontalAlignment: 'Center', spacing: 'None' },
      { type: 'TextBlock', text: label, size: 'Small', isSubtle: true, horizontalAlignment: 'Center', wrap: true, spacing: 'None' },
    ],
  });
  return {
    ...CARD_BASE,
    body: [
      title('📊 Today at a glance'),
      { type: 'ColumnSet', columns: [stat('Unplanned', unplanned), stat('Planned', planned), stat('Tendered', tendered)] },
      { type: 'ColumnSet', columns: [stat('In transit', inTransit), stat('Delivered', deliveredToday), stat('Exceptions', exceptions)] },
      line(tendered > 0 ? `${tendered} tender${tendered === 1 ? '' : 's'} awaiting carrier response.` : 'No tenders awaiting response.', true),
    ],
    actions: [
      submitAction('📋 Unplanned orders', { cmd: 'orders' }),
      submitAction('🚚 Shipments', { cmd: 'shipments' }),
      openInZoree('shipments'),
    ],
  };
}

// ── detail cards ───────────────────────────────────────────────────
function fact(t, v) { return { title: t, value: v == null || v === '' ? '—' : String(v) }; }

function orderDetailCard(order, linkedShipment) {
  const actions = [];
  if (!order.shipment_id) {
    actions.push(submitAction('💲 Rate it', { cmd: 'rate', id: order.id }));
    actions.push(submitAction('📝 Plan it', { cmd: 'plan', id: order.id }, 'positive'));
  } else {
    actions.push(submitAction(`🚚 Shipment ${order.shipment_id}`, { cmd: 'shipment', id: order.shipment_id }));
  }
  actions.push(openInZoree('orders', order.id));
  return {
    ...CARD_BASE,
    body: [
      title(`📦 ${order.id}`),
      { type: 'FactSet', facts: [
        fact('Status', order.status),
        fact('Customer', order.customer),
        // Orders from /api/orders carry `destination` (dbToOrderApi maps
        // DB dest → destination, no alias); shipments keep raw `dest`.
        fact('Lane', order.origin && (order.destination || order.dest) ? `${order.origin} → ${order.destination || order.dest}` : null),
        fact('Weight', order.weight ? `${order.weight} lb` : null),
        fact('Pieces', order.pieces),
        fact('Ready', order.ready_date),
        fact('Due', order.due_date),
        fact('Shipment', order.shipment_id),
        fact('Carrier', linkedShipment && linkedShipment.carrier),
      ] },
    ],
    actions,
  };
}

// extras (optional, built live by cmdShipmentDetail from change_history):
//   { tenderStatus, tenderTime, timeline, latest } — tender state line,
//   lifecycle breadcrumb ("Planned → Tendered → Tender Accepted"), and
//   the newest audit entry. All optional so every older call site and
//   any history-fetch failure degrades to the plain card.
function shipmentDetailCard(shipment, extras) {
  const x = extras || {};
  const s = shipment.status || '';
  const actions = [];
  if (s === 'Planned') actions.push(submitAction('📤 Tender', { cmd: 'tender', id: shipment.id }));
  if (s === 'Tendered') {
    // No Accept/Reject buttons: the CARRIER accepts or rejects a tender,
    // not the Teams user — surfacing one-click buttons here made it too
    // easy to record a response the carrier never gave. The typed
    // `accept <id>` / `reject <id>` commands still work for manually
    // recording a carrier's emailed/phoned response.
    actions.push(submitAction('↩ Withdraw', { cmd: 'withdraw', id: shipment.id }));
  }
  if (s === 'Tender Accepted' || s === 'Confirmed') actions.push(submitAction('🚛 In transit', { cmd: 'intransit', id: shipment.id }));
  if (s === 'In Transit') actions.push(submitAction('📦 Delivered', { cmd: 'delivered', id: shipment.id }, 'positive'));
  actions.push(openInZoree('shipments', shipment.id));

  return {
    ...CARD_BASE,
    body: [
      title(`${STATUS_ICON[s] || '•'} ${shipment.id}`),
      { type: 'FactSet', facts: [
        fact('Status', s),
        fact('Tender', x.tenderStatus ? (x.tenderStatus + (x.tenderTime ? ` · ${x.tenderTime}` : '')) : null),
        fact('Carrier', shipment.carrier),
        fact('Mode', shipment.mode),
        fact('Lane', shipment.origin && shipment.dest ? `${shipment.origin} → ${shipment.dest}` : null),
        fact('Weight', shipment.weight ? `${shipment.weight} lb` : null),
        fact('Cost', shipment.total_cost ? `$${Number(shipment.total_cost).toLocaleString()}` : null),
        fact('Pickup', shipment.pickup_date),
        fact('Delivery', shipment.delivery_date),
        fact('Dock', shipment.dock_door),
        fact('Orders', (shipment.order_ids || []).join(', ')),
      ] },
      ...(x.timeline ? [line(`🧭 ${x.timeline}`, true)] : []),
      ...(x.latest ? [line(`Latest event: ${x.latest}`, true)] : []),
    ],
    actions,
  };
}

// ── rate quotes ────────────────────────────────────────────────────
function ratesCard(orderId, quotes, loadType) {
  if (!quotes.length) {
    return {
      ...CARD_BASE,
      body: [title(`💲 No quotes for ${orderId}`, 'Attention'), line('No carrier rates matched this lane. Check rates and lane preferences in the TMS.')],
      actions: [openInZoree('orders', orderId)],
    };
  }
  const body = [title(`💲 Quotes for ${orderId}`), line(`${loadType || 'LTL'} · ${quotes.length} carrier${quotes.length === 1 ? '' : 's'}`, true)];
  const actions = [];
  // Show EVERY carrier the rating engine returned (users compare the
  // full list before committing), each with total cost, transit, and
  // the pickup → delivery window that carrier's plan would get (dates
  // enriched by cmdRate; missing transit days → no window to show).
  quotes.forEach((q, i) => {
    const price = q.totalCharge ? `$${Number(q.totalCharge).toLocaleString()}` : 'n/a';
    // "≈" marks a distance-estimated transit (no live CarrierConnect
    // data and no rates-table transit) — see api/services/transitEstimate.js.
    const transit = q.transitDays ? `${q.transitEstimated ? '≈' : ''}${q.transitDays}d` : '—';
    const window = q.dates && q.dates.pickup
      ? ` · ${q.dates.pickup} → ${q.dates.delivery}`
      : '';
    const flag = i === 0 ? ' ⭐' : '';
    const mode = q.mode ? ` · ${q.mode}` : '';
    body.push(line(`**${q.carrier}** ${price}${mode} · ${transit}${window}${flag}`));
    if (actions.length < 4) {
      actions.push(submitAction(`Plan with ${q.carrier}`, { cmd: 'plan', id: orderId, carrier: q.carrier }, i === 0 ? 'positive' : undefined));
    }
  });
  actions.push(openInZoree('orders', orderId));
  return { ...CARD_BASE, body, actions };
}

// ── orders list ────────────────────────────────────────────────────
function ordersCard(orders) {
  if (!orders.length) {
    return {
      ...CARD_BASE,
      body: [title('📋 Orders'), line('No unplanned orders right now — all caught up.')],
      actions: [openInZoree('orders')],
    };
  }
  const body = [title(`📋 Unplanned orders (${orders.length} shown)`)];
  const actions = [];
  orders.forEach((o) => {
    const lane = o.origin && (o.destination || o.dest) ? ` — ${o.origin} → ${o.destination || o.dest}` : '';
    const wt = o.weight ? ` · ${o.weight} lb` : '';
    body.push(line(`**${o.id}** ${o.customer || ''}${lane}${wt}`));
    if (actions.length < 5) {
      actions.push(submitAction(`Plan ${o.id}`, { cmd: 'plan', id: o.id }));
    }
  });
  actions.push(openInZoree('orders'));
  return { ...CARD_BASE, body, actions };
}

// ── shipments list ─────────────────────────────────────────────────
const STATUS_ICON = {
  Planned: '📝', Tendered: '📤', 'Tender Accepted': '✅', 'Tender Rejected': '❌',
  Confirmed: '👍', 'In Transit': '🚛', Delivered: '📦', Cancelled: '🚫', Exception: '⚠️',
};

function shipmentsCard(shipments) {
  if (!shipments.length) {
    return {
      ...CARD_BASE,
      body: [title('🚚 Shipments'), line('No shipments found.')],
      actions: [openInZoree('shipments')],
    };
  }
  const body = [title(`🚚 Recent shipments (${shipments.length} shown)`)];
  const actions = [];
  shipments.forEach((s) => {
    const icon = STATUS_ICON[s.status] || '•';
    const lane = s.origin && s.dest ? ` — ${s.origin} → ${s.dest}` : '';
    body.push(line(`${icon} **${s.id}** ${s.status || ''} · ${s.carrier || 'no carrier'}${lane}`));
    if (actions.length < 4) {
      if (s.status === 'Planned') {
        actions.push(submitAction(`Tender ${s.id}`, { cmd: 'tender', id: s.id }));
      }
      // Tendered rows get no Accept/Reject buttons — carriers own that
      // decision (see shipmentDetailCard). Type `accept <id>` / `reject
      // <id>` to record a carrier response manually.
    }
  });
  actions.push(openInZoree('shipments'));
  return { ...CARD_BASE, body, actions };
}

// ── action results ─────────────────────────────────────────────────
function planResultCard({ shipment, orderId, errors, note }) {
  if (!shipment) {
    return errorCard(`Planning ${orderId} produced no shipment${errors && errors.length ? `: ${errors.join('; ')}` : '.'}`);
  }
  const body = [
    title(`📝 Planned — ${shipment.id}`, 'Good'),
    line(`Order **${orderId}** → shipment **${shipment.id}**`),
    line(`Carrier: ${shipment.carrier || '(none — set before tendering)'} · Mode: ${shipment.mode || 'LTL'}`),
  ];
  if (Number(shipment.total_cost) > 0) {
    body.push(line(`Cost: $${Number(shipment.total_cost).toFixed(2)}`
      + (shipment.equipment ? ` · Equipment: ${shipment.equipment}` : '')
      + (shipment.pickup_date ? ` · Pickup: ${shipment.pickup_date}` : '')
      + (shipment.delivery_date ? ` · Delivery: ${shipment.delivery_date}` : '')));
  }
  if (note) body.push(line(note, true));
  return {
    ...CARD_BASE,
    body,
    actions: [
      submitAction(`📤 Tender ${shipment.id}`, { cmd: 'tender', id: shipment.id }),
      openInZoree('shipments', shipment.id),
    ],
  };
}

// No Accept/Reject buttons on tender cards: the carrier makes that call,
// not the Teams user (the old offerAcceptReject flag invited misclicks).
// Typed `accept <id>` / `reject <id>` remain for recording a carrier's
// out-of-band response.
function tenderStatusCard({ shipment, headline, color, note }) {
  const actions = [openInZoree('shipments', shipment.id)];
  const body = [
    title(headline, color),
    line(`**${shipment.id}** · ${shipment.carrier || 'no carrier'} · ${shipment.status || ''}`),
  ];
  if (note) body.push(line(note, true));
  return { ...CARD_BASE, body, actions };
}

function errorCard(message) {
  return {
    ...CARD_BASE,
    body: [title('⚠️ Something went wrong', 'Attention'), line(message)],
    actions: [openInZoree()],
  };
}

module.exports = {
  helpCard,
  todayCard,
  ordersCard,
  shipmentsCard,
  orderDetailCard,
  shipmentDetailCard,
  ratesCard,
  planResultCard,
  tenderStatusCard,
  errorCard,
};
