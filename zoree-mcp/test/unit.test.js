const test = require('node:test');
const assert = require('node:assert/strict');
const { createSealedBox } = require('../src/services/sealedBox');
const { authHeaderFor } = require('../src/services/zoreeApiClient');
const { compact, pick, matchesText } = require('../src/tools/format');
const { loadConfig } = require('../src/config');

const SECRET = 'x'.repeat(40);

test('sealedBox round-trips and rejects tampering', () => {
  const box = createSealedBox(SECRET, 'a');
  const sealed = box.seal({ hello: 'world' }, 60);
  assert.equal(box.open(sealed).hello, 'world');
  const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
  assert.equal(box.open(flipped), null);
  assert.equal(box.open('garbage'), null);
});

test('sealedBox keys are separated by purpose', () => {
  const a = createSealedBox(SECRET, 'oauth-client');
  const b = createSealedBox(SECRET, 'oauth-code');
  assert.equal(b.open(a.seal({ x: 1 })), null);
});

test('sealedBox rejects expired payloads', () => {
  const box = createSealedBox(SECRET, 'a');
  const sealed = box.seal({ x: 1, exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal(box.open(sealed), null);
});

test('authHeaderFor picks Bearer for JWTs and ApiKey otherwise', () => {
  assert.equal(authHeaderFor('a.b.c'), 'Bearer a.b.c');
  assert.equal(authHeaderFor('abcdef'), 'ApiKey abcdef');
});

test('compact drops empties and private keys, truncates long strings', () => {
  const out = compact({ a: 1, b: null, c: '', d: [], e: {}, _f: 2, g: 'x'.repeat(600), h: false, i: 0 });
  assert.deepEqual(Object.keys(out), ['a', 'g', 'h', 'i']);
  assert.ok(out.g.length < 520);
});

test('pick keeps listed fields only', () => {
  assert.deepEqual(pick({ a: 1, b: 2, c: null }, ['a', 'c', 'z']), { a: 1 });
});

test('matchesText is case-insensitive across fields', () => {
  assert.ok(matchesText({ a: 'Dallas, TX' }, 'dallas', ['a']));
  assert.ok(!matchesText({ a: 'Dallas, TX' }, 'denver', ['a']));
  assert.ok(matchesText({}, '', ['a']));
});

test('calcDates matches the Plan modal rule (latest pickup that still meets due, business days)', () => {
  const { calcDates } = require('../src/services/planDates');
  // Due Mon 2027-02-01, 3 business days → pickup Wed 2027-01-27 (skips the weekend).
  assert.deepEqual(calcDates({ transitDays: 3, readyDate: '2027-01-20', dueDate: '2027-02-01', today: '2026-10-17' }),
    { pickup: '2027-01-27', delivery: '2027-02-01', meetsDueDate: true });
  // Ready too late for the due date → pickup = ready, flagged late.
  assert.deepEqual(calcDates({ transitDays: 5, readyDate: '2027-01-29', dueDate: '2027-02-01', today: '2026-10-17' }),
    { pickup: '2027-01-29', delivery: '2027-02-05', meetsDueDate: false });
  assert.equal(calcDates({ transitDays: null, readyDate: '2027-01-20' }).pickup, null);
});

test('loadConfig requires a strong MCP_SECRET', () => {
  assert.throws(() => loadConfig({ MCP_SECRET: 'short' }), /MCP_SECRET/);
  const cfg = loadConfig({ MCP_SECRET: SECRET, ZOREE_API_URL: 'https://api.zoree.io/', PUBLIC_URL: 'https://mcp.zoree.io/' });
  assert.equal(cfg.apiUrl, 'https://api.zoree.io');
  assert.equal(cfg.publicUrl, 'https://mcp.zoree.io');
});

test('dockSlots: config, durations and booked windows', () => {
  const d = require('../src/services/dockSlots');
  const cfg = d.dockConfigFor([{ warehouse: 'DALLAS, TX', num_doors: 2, start_hour: 7, end_hour: 15, max_per_door: 3 }], 'Dallas, TX');
  assert.deepEqual(cfg, { configured: true, doors: ['Door 1', 'Door 2'], startHour: 7, endHour: 15, maxPerDoor: 3 });
  assert.equal(d.dockConfigFor([], 'X').doors.length, 6, 'defaults to Door 1-6');
  assert.equal(d.loadDurationFor([{ mode: 'LTL', duration_minutes: 75 }], 'ltl'), 75);
  assert.equal(d.loadDurationFor([{ mode: 'TL', duration_minutes: 30, enabled: false }], 'TL'), 120, 'disabled row ignored');
  assert.deepEqual(d.bookedWindow({ dock_time: '09:15-10:00' }), { start: 555, end: 600 });
  assert.deepEqual(d.bookedWindow({ loading_start: '2027-01-27 06:00' }), { start: 360, end: 450 }, '90-min default');
  assert.equal(d.normDoor(' door 4 '), 'Door 4');
});

test('dockSlots: findSlot uses real gaps between bookings', () => {
  const d = require('../src/services/dockSlots');
  const config = { doors: ['Door 1', 'Door 2'], startHour: 6, endHour: 12, maxPerDoor: null };
  const bookings = d.bookingsByDoor([
    { id: 'A', origin: 'X', pickup_date: '2027-01-27', dock_door: 'Door 1', dock_time: '06:00–07:00' },
    { id: 'B', origin: 'X', pickup_date: '2027-01-27', dock_door: 'Door 1', dock_time: '09:00–12:00' },
    { id: 'C', origin: 'X', pickup_date: '2027-01-27', dock_door: 'Door 2', dock_time: '06:00–11:00' },
    { id: 'D', origin: 'Y', pickup_date: '2027-01-27', dock_door: 'Door 2', dock_time: '11:00–12:00' },
  ], { pickupDate: '2027-01-27', origin: 'x' });
  // 07:00–09:00 gap on Door 1 fits a 120-minute load; the web app's packed-minutes model would say 10:00.
  assert.deepEqual(d.findSlot({ config, bookings, duration: 120 }), { ok: true, door: 'Door 1', start: 420, end: 540 });
  assert.equal(d.findSlot({ config, bookings, duration: 180 }).ok, false, 'no 3-hour gap anywhere');
  assert.equal(d.findSlot({ config, bookings, duration: 60, door: 2 }).start, 660, 'other origins ignored');
  assert.deepEqual(d.buildDockFields({ door: 'Door 1', start: 420, end: 540, pickupDate: '2027-01-27' }),
    { dockDoor: 'Door 1', dockTime: '07:00–09:00', loadingStart: '2027-01-27 07:00', loadingEnd: '2027-01-27 09:00' });
  const full = { ...config, maxPerDoor: 2 };
  assert.match(d.findSlot({ config: full, bookings, duration: 30, door: 1 }).reason, /limit/);
});
