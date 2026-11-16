// ════════════════════════════════════════════════════════════════════
// dockSlots.js — find or validate a dock-door window for one shipment.
//
// Pure logic, no I/O. Uses the same inputs as the web app's Dock
// Scheduling board and Plan modal (frontend/src/services/dockService.js,
// dockScheduleService.js, constants/docks.js):
//   • doors + operating hours  ← warehouse_dock_config row for the
//                                shipment's origin (key = origin, upper-
//                                cased), else Door 1–6, 06:00–20:00
//   • loading duration         ← dock_loading_durations row for the
//                                mode, else TL 120 / LTL 90 / Parcel 90 /
//                                Air 60 minutes
//   • existing bookings        ← shipments with the same pickup_date +
//                                origin + dock_door, not Cancelled
//   • written fields           ← dockDoor, dockTime ("06:00–08:00"),
//                                loadingStart/End ("2027-01-27 06:00")
//
// One deliberate difference: the web app counts booked minutes per door
// and assumes they are packed from 06:00. Here each booking's real
// loading window is read and checked for overlap, so a gap between two
// appointments can be used and a booking at 14:00 doesn't block 06:00.
// ════════════════════════════════════════════════════════════════════

const DEFAULT_DOOR_COUNT = 6;
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 20;
const LOAD_DURATION_BY_MODE = { TL: 120, LTL: 90, PARCEL: 90, AIR: 60 };
const FALLBACK_DURATION = 120;
const SLOT_STEP_MIN = 15;

function toMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function fromMin(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

/** "2027-01-27 06:00" → "06:00"; "06:00" → "06:00". */
function extractTime(v) {
  if (!v) return null;
  const s = String(v).trim();
  const t = s.includes(' ') ? s.split(' ').pop() : (s.includes('T') ? s.split('T').pop() : s);
  return t.slice(0, 5);
}

function normOrigin(o) {
  return String(o || '').trim().toLowerCase();
}

/** "3", 3, "door 3", "Door 3" → "Door 3". Anything else is returned trimmed. */
function normDoor(door) {
  const s = String(door == null ? '' : door).trim();
  const m = /^(?:door\s*)?(\d+)$/i.exec(s);
  return m ? `Door ${Number(m[1])}` : s;
}

/** Doors and hours for a warehouse, from warehouse_dock_config rows. */
function dockConfigFor(configs, origin) {
  const key = String(origin || '').trim().toUpperCase();
  const row = (configs || []).find((c) => String(c.warehouse || '').trim().toUpperCase() === key);
  const n = (row && Number(row.num_doors)) || DEFAULT_DOOR_COUNT;
  const maxPerDoor = row && Number(row.max_per_door) > 0 ? Number(row.max_per_door) : null;
  return {
    configured: !!row,
    doors: Array.from({ length: n }, (_, i) => `Door ${i + 1}`),
    startHour: row && row.start_hour != null ? Number(row.start_hour) : DEFAULT_START_HOUR,
    endHour: row && row.end_hour != null ? Number(row.end_hour) : DEFAULT_END_HOUR,
    maxPerDoor,
  };
}

/** Loading minutes for a mode, from dock_loading_durations rows. */
function loadDurationFor(rows, mode) {
  const key = String(mode || 'TL').trim().toUpperCase();
  const row = (rows || []).find((r) => String(r.mode || '').trim().toUpperCase() === key);
  if (row && row.enabled !== false && Number(row.duration_minutes) > 0) return Number(row.duration_minutes);
  return LOAD_DURATION_BY_MODE[key] || LOAD_DURATION_BY_MODE.TL || FALLBACK_DURATION;
}

/** A shipment's booked window in minutes, or null when it has no usable time. */
function bookedWindow(s) {
  let start = toMin(extractTime(s.loading_start));
  let end = toMin(extractTime(s.loading_end));
  if (start == null && s.dock_time) {
    const [a, b] = String(s.dock_time).split(/\s*[–-]\s*/);
    start = toMin(a);
    end = toMin(b);
  }
  if (start == null) return null;
  if (end == null || end <= start) end = start + 90; // web app's default window
  return { start, end };
}

/**
 * Bookings per door at one origin on one pickup date.
 * @returns {{ [door: string]: { shipment_id, start, end, untimed? }[] }} sorted by start
 */
function bookingsByDoor(shipments, { pickupDate, origin, excludeId }) {
  const out = {};
  const o = normOrigin(origin);
  for (const s of shipments || []) {
    if (!s || !s.dock_door || s.id === excludeId) continue;
    if (String(s.status || '') === 'Cancelled') continue;
    if (String(s.pickup_date || '').slice(0, 10) !== pickupDate) continue;
    if (normOrigin(s.origin) !== o) continue;
    const door = normDoor(s.dock_door);
    const w = bookedWindow(s);
    (out[door] = out[door] || []).push(w
      ? { shipment_id: s.id, start: w.start, end: w.end }
      : { shipment_id: s.id, untimed: true });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (a.start ?? -1) - (b.start ?? -1));
  return out;
}

function overlaps(list, start, end) {
  return (list || []).find((b) => !b.untimed && start < b.end && b.start < end) || null;
}

/** Earliest start ≥ from on this door that fits `duration` before closing, or null. */
function earliestFree(list, { from, duration, close }) {
  for (let t = from; t + duration <= close; t += SLOT_STEP_MIN) {
    const hit = overlaps(list, t, t + duration);
    if (!hit) return t;
    // Jump straight past the blocking booking (rounded up to the step).
    const next = Math.ceil(hit.end / SLOT_STEP_MIN) * SLOT_STEP_MIN;
    if (next > t) t = next - SLOT_STEP_MIN;
  }
  return null;
}

function doorFull(config, list) {
  return config.maxPerDoor != null && (list || []).length >= config.maxPerDoor;
}

/**
 * Pick or validate a window.
 *   door + startTime → that exact window, refused if it overlaps or is outside hours
 *   door only        → earliest free window on that door
 *   neither          → earliest free window on any door (ties → lowest door)
 * @returns {{ ok: true, door, start, end } | { ok: false, reason }}
 */
function findSlot({ config, bookings, duration, door, startTime }) {
  const open = config.startHour * 60;
  const close = config.endHour * 60;
  const hours = `${fromMin(open)}–${fromMin(close)}`;

  if (door) {
    const d = normDoor(door);
    if (!config.doors.includes(d)) {
      return { ok: false, reason: `${d} doesn't exist at this warehouse (doors: ${config.doors.join(', ')})` };
    }
    const list = bookings[d] || [];
    if (doorFull(config, list)) {
      return { ok: false, reason: `${d} already has ${list.length} appointments, the limit for this warehouse` };
    }
    if (startTime) {
      const s = toMin(startTime);
      if (s == null) return { ok: false, reason: `start_time '${startTime}' is not HH:mm` };
      if (s < open || s + duration > close) {
        return { ok: false, reason: `${fromMin(s)}–${fromMin(s + duration)} is outside dock hours ${hours}` };
      }
      const hit = overlaps(list, s, s + duration);
      if (hit) {
        const next = earliestFree(list, { from: s, duration, close });
        return {
          ok: false,
          reason: `${d} is booked ${fromMin(hit.start)}–${fromMin(hit.end)} by ${hit.shipment_id}, which overlaps `
            + `${fromMin(s)}–${fromMin(s + duration)}.`
            + (next != null ? ` Next free start on ${d}: ${fromMin(next)}.` : ` ${d} has no later window that day.`),
        };
      }
      return { ok: true, door: d, start: s, end: s + duration };
    }
    const t = earliestFree(list, { from: open, duration, close });
    if (t == null) return { ok: false, reason: `${d} has no free ${duration}-minute window within ${hours}` };
    return { ok: true, door: d, start: t, end: t + duration };
  }

  const from = startTime ? toMin(startTime) : open;
  if (startTime && from == null) return { ok: false, reason: `start_time '${startTime}' is not HH:mm` };
  let best = null;
  for (const d of config.doors) {
    const list = bookings[d] || [];
    if (doorFull(config, list)) continue;
    const t = earliestFree(list, { from: Math.max(from, open), duration, close });
    if (t != null && (!best || t < best.start)) best = { ok: true, door: d, start: t, end: t + duration };
  }
  return best || { ok: false, reason: `No dock capacity: every door is full for a ${duration}-minute window within ${hours}` };
}

/** Same field shape as dockService.buildDockFields in the web app. */
function buildDockFields({ door, start, end, pickupDate }) {
  const s = fromMin(start);
  const e = fromMin(end);
  return {
    dockDoor: door,
    dockTime: `${s}–${e}`,
    loadingStart: `${pickupDate} ${s}`,
    loadingEnd: `${pickupDate} ${e}`,
  };
}

module.exports = {
  LOAD_DURATION_BY_MODE,
  toMin,
  fromMin,
  extractTime,
  normDoor,
  dockConfigFor,
  loadDurationFor,
  bookedWindow,
  bookingsByDoor,
  findSlot,
  buildDockFields,
};
