// ════════════════════════════════════════════════════════════════════
// docks.js — dock-door scheduling for a shipment's pickup.
//
//   get_dock_availability  (read-only)
//   reserve_dock           (WRITE — sets the shipment's dock window)
//
// Reads (all through the Express API, as the web app does):
//   GET /api/shipments?id=<id>                 the shipment
//   GET /api/shipments                         bookings (latest 500)
//   GET /api/db/warehouse_dock_config          doors + hours per origin
//   GET /api/db/dock_loading_durations         minutes per mode
// Write:
//   PATCH /api/shipments/:id  { dockDoor, dockTime, loadingStart, loadingEnd }
//   — the same audited route the Dock Scheduling board uses
//   (dockScheduleService.persistShipmentDockAssignment): role check via
//   the access matrix, one change_history row per dock field, and the
//   OMS dock mirror (syncDockToOms). Order ready/due dates are never
//   touched.
// Slot logic lives in services/dockSlots.js.
// ════════════════════════════════════════════════════════════════════

const { z } = require('zod');
const { compact, safeHandler } = require('./format');
const { READ_ONLY } = require('./orders');
const { ZoreeApiError } = require('../services/zoreeApiClient');
const slots = require('../services/dockSlots');

const NO_DOCK_STATUSES = ['Cancelled', 'In Transit', 'Delivered'];
const CONFIG_QUERY = 'select=*&order=warehouse.asc&limit=200';
const DURATION_QUERY = 'select=*&order=mode.asc&limit=50';

async function loadShipment(api, shipmentId) {
  const data = await api.get('/api/shipments', { id: shipmentId });
  const row = data && Array.isArray(data.shipments) ? data.shipments[0] : null;
  if (!row) throw new ZoreeApiError(404, `Shipment ${shipmentId} not found`);
  return row;
}

/** Everything needed to schedule one shipment's pickup at its origin dock. */
async function loadDockContext(api, shipmentId, durationOverride) {
  const shipment = await loadShipment(api, shipmentId);
  const pickupDate = String(shipment.pickup_date || '').slice(0, 10);
  if (!pickupDate) throw new ZoreeApiError(422, `Shipment ${shipmentId} has no pickup date, so there is no dock day to book`);
  if (!shipment.origin) throw new ZoreeApiError(422, `Shipment ${shipmentId} has no origin, so the warehouse is unknown`);

  const [configs, durations, list] = await Promise.all([
    api.get('/api/db/warehouse_dock_config', { q: CONFIG_QUERY }),
    api.get('/api/db/dock_loading_durations', { q: DURATION_QUERY }),
    api.get('/api/shipments'),
  ]);
  const others = (list && list.shipments) || [];
  const config = slots.dockConfigFor(Array.isArray(configs) ? configs : [], shipment.origin);
  const duration = durationOverride || slots.loadDurationFor(Array.isArray(durations) ? durations : [], shipment.mode);
  const bookings = slots.bookingsByDoor(others, { pickupDate, origin: shipment.origin, excludeId: shipment.id });
  return {
    shipment, pickupDate, config, duration, bookings,
    scanned: others.length,
  };
}

function currentDock(s) {
  return compact({
    door: s.dock_door,
    window: s.dock_time,
    loading_start: s.loading_start,
    loading_end: s.loading_end,
  });
}

function warehouseSummary(ctx) {
  return {
    origin: ctx.shipment.origin,
    pickup_date: ctx.pickupDate,
    doors: ctx.config.doors.length,
    hours: `${slots.fromMin(ctx.config.startHour * 60)}–${slots.fromMin(ctx.config.endHour * 60)}`,
    max_per_door: ctx.config.maxPerDoor || undefined,
    config_source: ctx.config.configured ? 'warehouse_dock_config' : 'default (no config for this origin)',
    load_minutes: ctx.duration,
    mode: ctx.shipment.mode,
  };
}

function scanNote(ctx) {
  return ctx.scanned >= 500
    ? 'Bookings were read from the 500 most recent shipments; older shipments on this day may not be counted.'
    : undefined;
}

async function getDockAvailability(api, { shipment_id, duration_minutes }) {
  const ctx = await loadDockContext(api, shipment_id, duration_minutes);
  const doors = ctx.config.doors.map((d) => {
    const list = ctx.bookings[d] || [];
    const first = slots.findSlot({ config: ctx.config, bookings: ctx.bookings, duration: ctx.duration, door: d });
    return compact({
      door: d,
      booked: list.map((b) => (b.untimed ? `${b.shipment_id} (no time set)` : `${slots.fromMin(b.start)}–${slots.fromMin(b.end)} ${b.shipment_id}`)),
      earliest_free: first.ok ? slots.fromMin(first.start) : 'none',
    });
  });
  const suggestion = slots.findSlot({ config: ctx.config, bookings: ctx.bookings, duration: ctx.duration });
  return compact({
    shipment_id: ctx.shipment.id,
    current_dock: currentDock(ctx.shipment),
    warehouse: compact(warehouseSummary(ctx)),
    suggested: suggestion.ok
      ? { door: suggestion.door, window: `${slots.fromMin(suggestion.start)}–${slots.fromMin(suggestion.end)}` }
      : suggestion.reason,
    doors,
    note: scanNote(ctx),
  });
}

async function reserveDock(api, { shipment_id, door, start_time, duration_minutes, replace = false }) {
  const ctx = await loadDockContext(api, shipment_id, duration_minutes);
  const s = ctx.shipment;
  if (NO_DOCK_STATUSES.includes(String(s.status || ''))) {
    throw new ZoreeApiError(409, `Shipment ${s.id} is '${s.status}'; a dock door can't be reserved for it`);
  }
  if (s.dock_door && !replace) {
    throw new ZoreeApiError(409, `Shipment ${s.id} already has ${s.dock_door} ${s.dock_time || ''}`.trim()
      + '. Pass replace: true to move it.');
  }

  const slot = slots.findSlot({
    config: ctx.config, bookings: ctx.bookings, duration: ctx.duration, door, startTime: start_time,
  });
  if (!slot.ok) throw new ZoreeApiError(409, slot.reason);

  const fields = slots.buildDockFields({ ...slot, pickupDate: ctx.pickupDate });
  const updated = await api.patch(`/api/shipments/${encodeURIComponent(s.id)}`, fields);
  const u = updated || {};

  return compact({
    reserved: true,
    shipment_id: s.id,
    dock: {
      door: u.dockDoor || u.dock_door || fields.dockDoor,
      window: u.dockTime || u.dock_time || fields.dockTime,
      loading_start: u.loadingStart || u.loading_start || fields.loadingStart,
      loading_end: u.loadingEnd || u.loading_end || fields.loadingEnd,
    },
    previous_dock: replace ? currentDock(s) : undefined,
    warehouse: compact(warehouseSummary(ctx)),
    note: scanNote(ctx),
  });
}

function registerDockTools(server, api) {
  server.registerTool('get_dock_availability', {
    title: 'Dock availability for a shipment',
    description: 'Dock doors at a shipment\'s origin on its pickup date: each door\'s booked windows, its earliest '
      + 'free start, and a suggested door/window for this shipment\'s load time (from Planning Parameters by mode). '
      + 'Read-only — use before reserve_dock to show the user the options.',
    inputSchema: {
      shipment_id: z.string().min(1).describe('Shipment id, e.g. SHP-2026-100996'),
      duration_minutes: z.number().int().min(15).max(720).optional()
        .describe('Override the loading window length (default: the mode\'s dock loading duration)'),
    },
    annotations: { title: 'Dock availability', ...READ_ONLY },
  }, safeHandler((args) => getDockAvailability(api, args)));

  server.registerTool('reserve_dock', {
    title: 'Reserve dock door',
    description: 'Book a dock door and loading window for a shipment\'s pickup at its origin, the same way the Dock '
      + 'Scheduling board does (audited, mirrored to OMS). With no door/time it takes the earliest free window on any '
      + 'door; with a door it takes that door\'s earliest window; with door + start_time it books exactly that and '
      + 'refuses on overlap, naming the next free start. Refuses Cancelled/In Transit/Delivered shipments and shipments '
      + 'that already have a door unless replace is true. Tell the user the door and window and get their go-ahead first.',
    inputSchema: {
      shipment_id: z.string().min(1).describe('Shipment id, e.g. SHP-2026-100996'),
      door: z.union([z.string(), z.number()]).optional().describe('Door, e.g. "Door 3" or 3 (default: best free door)'),
      start_time: z.string().regex(/^\d{1,2}:\d{2}$/).optional().describe('Loading start, HH:mm 24-hour'),
      duration_minutes: z.number().int().min(15).max(720).optional()
        .describe('Loading window length (default: the mode\'s dock loading duration)'),
      replace: z.boolean().optional().describe('Move an existing dock reservation'),
    },
    annotations: {
      title: 'Reserve dock door', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    },
  }, safeHandler((args) => reserveDock(api, args)));
}

module.exports = { registerDockTools, getDockAvailability, reserveDock };
