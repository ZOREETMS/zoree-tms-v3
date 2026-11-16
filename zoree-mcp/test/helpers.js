// Test helpers: a fake ZoreeTMS API and a running MCP app on random ports.
const express = require('express');
const { createApp } = require('../src/app');

function fakeJwt(expInSeconds = 3600) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'HS256' })}.${enc({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + expInSeconds })}.sig`;
}

const API_KEY = 'zk_test_key_1234567890abcdefghijklmnopqrstuv';

function startFakeApi() {
  const jwt = fakeJwt();
  const refreshed = fakeJwt(7200);
  const seen = [];
  const app = express();
  app.use(express.json());

  const validAuth = new Set([`Bearer ${jwt}`, `Bearer ${refreshed}`, `ApiKey ${API_KEY}`]);
  app.use((req, res, next) => {
    seen.push({ method: req.method, path: req.path, auth: req.headers.authorization });
    if (req.path.startsWith('/api/auth/login') || req.path.startsWith('/api/auth/refresh')) return next();
    if (!validAuth.has(req.headers.authorization)) return res.status(401).json({ error: 'Invalid or expired token' });
    next();
  });

  app.post('/api/auth/login', (req, res) => {
    if (req.body.email === 'sridhar@zoree.io' && req.body.password === 'pw') {
      return res.json({ token: jwt, refresh_token: 'rt-1', expires_in: 3600, user: { id: 'u1', disabled: false } });
    }
    res.status(401).json({ error: 'Invalid email or password' });
  });
  app.post('/api/auth/refresh', (req, res) => {
    if (req.body.refresh_token !== 'rt-1') return res.status(401).json({ error: 'Refresh failed' });
    res.json({ access_token: refreshed, refresh_token: 'rt-2', expires_in: 7200 });
  });
  app.get('/api/auth/me', (_req, res) => res.json({ user: { id: 'u1', email: 'sridhar@zoree.io', activeRole: 'admin' } }));

  const orders = [
    { id: 'ORD-1', customer: 'PA Logistics', status: 'Unplanned', ship_mode: 'LTL', origin: 'Dallas, TX', destination: 'Chicago, IL', shipmentId: null, shipMode: 'LTL', notes: '' },
    { id: 'ORD-2', customer: 'Acme', status: 'Planned', ship_mode: 'TL', origin: 'Austin, TX', destination: 'Denver, CO', shipmentId: 'SHP-9' },
    // Unplanning fixtures — kept off Dallas and off the Ashcamp dock day so earlier tests are unaffected.
    { id: 'ORD-3', status: 'Planned', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-U1' },
    { id: 'ORD-4', status: 'Planned', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-U2' },
    { id: 'ORD-5', status: 'Planned', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-U2' },
    { id: 'ORD-6', status: 'Tendered', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-T1' },
    { id: 'ORD-7', status: 'Tender Accepted', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-ACC' },
    { id: 'ORD-8', status: 'Planned', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-C1' },
    { id: 'ORD-9', status: 'Planned', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-X1' },
    { id: 'ORD-10', status: 'Planned', customer: 'Acme', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-TN1' },
    { id: 'ORD-11', status: 'Tendered', origin: 'Memphis, TN', destination: 'Reno, NV', shipment_id: 'SHP-RJ' },
  ];
  app.get('/api/orders', (_req, res) => res.json({ orders, total: orders.length }));
  app.get('/api/orders/count', (req, res) => res.json({ total: req.query.status === 'Planned' ? 1 : 2 }));
  app.get('/api/orders/:id/full', (req, res) => {
    const o = orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json({ ...o, dest: o.destination, origin_zip: '75201', dest_zip: '60601', weight: 6000,
      ready: '2027-01-20', due: '2027-02-01',
      lines: [{ line_num: 1, item_name: 'Pallet', weight: 900, freight_class: 70, junk: null },
        { line_num: 2, item_name: 'Crate', weight: 100, freight_class: 85 }] });
  });
  app.get('/api/orders/:id/history', (req, res) => res.json({ rows: [
    { created_at: '2026-10-01T00:00:00Z', action: 'update', field: 'status', old_value: 'Unplanned', new_value: 'Planned', username: 'sridhar', id: 'h1' },
  ] }));
  const ASH = 'ASHCAMP, KY 41512';
  const shipments = [
    { id: 'SHP-9', status: 'Tendered', carrier: 'Estes', mode: 'TL', dest: 'Denver, CO', _carrier: { x: 1 } },
    { id: 'SHP-DOCK', status: 'Planned', carrier: 'KLLM TRANSPORT', mode: 'TL', origin: ASH, pickup_date: '2027-01-27' },
    { id: 'SHP-D1', status: 'Planned', mode: 'TL', origin: ASH, pickup_date: '2027-01-27', dock_door: 'Door 1',
      dock_time: '06:00–08:00', loading_start: '2027-01-27 06:00', loading_end: '2027-01-27 08:00' },
    { id: 'SHP-D2', status: 'Planned', mode: 'LTL', origin: 'ashcamp, ky 41512 ', pickup_date: '2027-01-27',
      dock_door: 'Door 2', dock_time: '06:00–07:30' },
    { id: 'SHP-GONE', status: 'Cancelled', mode: 'TL', origin: ASH, pickup_date: '2027-01-27', dock_door: 'Door 3',
      dock_time: '06:00–08:00' },
    { id: 'SHP-DONE', status: 'Delivered', mode: 'TL', origin: ASH, pickup_date: '2027-01-27' },
    { id: 'SHP-U1', status: 'Planned', carrier: 'KLLM', mode: 'TL', origin: 'MEMPHIS, TN', pickup_date: '2027-02-10',
      order_ids: ['ORD-3'], dock_door: 'Door 4', dock_time: '06:00–08:00' },
    { id: 'SHP-U2', status: 'Planned', carrier: 'XPO', mode: 'LTL', origin: 'MEMPHIS, TN', pickup_date: '2027-02-10',
      order_ids: ['ORD-4', 'ORD-5'], dock_door: 'Door 5', dock_time: '08:00–09:30' },
    { id: 'SHP-T1', status: 'Tendered', carrier: 'Swift', mode: 'TL', origin: 'MEMPHIS, TN', pickup_date: '2027-02-10', order_ids: ['ORD-6'] },
    { id: 'SHP-ACC', status: 'Tender Accepted', carrier: 'Swift', mode: 'TL', origin: 'MEMPHIS, TN', order_ids: ['ORD-7'] },
    { id: 'SHP-M1', status: 'Planned', bol_type: 'MBOL', mode: 'LTL', origin: 'MEMPHIS, TN', order_ids: [] },
    { id: 'SHP-C1', status: 'Planned', bol_type: 'CBOL', master_shipment_id: 'SHP-M1', mode: 'LTL', origin: 'MEMPHIS, TN', order_ids: ['ORD-8'] },
    { id: 'SHP-X1', status: 'Planned', bol_type: 'CBOL', master_shipment_id: 'SHP-M2', mode: 'LTL', origin: 'MEMPHIS, TN', order_ids: ['ORD-9'] },
    { id: 'SHP-M2', status: 'Planned', bol_type: 'MBOL', mode: 'LTL', origin: 'MEMPHIS, TN', order_ids: [] },
    { id: 'SHP-TN1', status: 'Planned', carrier: 'SWIFT TRANSPORTATION', mode: 'TL', origin: 'MEMPHIS, TN', dest: 'RENO, NV',
      pickup_date: '2027-02-10', delivery_date: '2027-02-13', total_cost: 2309, order_ids: ['ORD-10'] },
    { id: 'SHP-TN2', status: 'Planned', carrier: 'NoMail Freight', mode: 'TL', origin: 'MEMPHIS, TN', order_ids: [] },
    { id: 'SHP-RJ', status: 'Tender Rejected', carrier: 'Swift', mode: 'TL', origin: 'MEMPHIS, TN', order_ids: ['ORD-11'] },
  ];
  app.post('/api/tender/email', (req, res) => {
    seen.push({ path: 'tender-email', body: req.body });
    res.status(202).json({ sent: true, queued: true, to: req.body.to });
  });
  const shipOf = (o) => o.shipment_id || o.shipmentId || null;
  const removeShipment = (id) => { const i = shipments.findIndex((x) => x.id === id); if (i >= 0) shipments.splice(i, 1); };
  // PATCH /api/orders/:id — same server-side effects as api/server.js: orphan shipment
  // deleted (and its MBOL when it was the last CBOL), otherwise order_ids recalculated.
  app.patch('/api/orders/:id', (req, res) => {
    const o = orders.find((x) => x.id === req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    seen.push({ path: 'order-patch', id: o.id, body: req.body });
    const prev = shipOf(o);
    if ('status' in req.body) o.status = req.body.status;
    if ('shipmentId' in req.body) { o.shipment_id = req.body.shipmentId; o.shipmentId = req.body.shipmentId; }
    if (prev && !shipOf(o)) {
      const sh = shipments.find((x) => x.id === prev);
      if (sh) {
        sh.order_ids = (sh.order_ids || []).filter((id) => id !== o.id);
        if (!sh.order_ids.length) {
          removeShipment(sh.id);
          if (sh.master_shipment_id && !shipments.some((x) => x.master_shipment_id === sh.master_shipment_id)) {
            removeShipment(sh.master_shipment_id);
          }
        }
      }
    }
    res.json({ id: o.id, status: o.status, shipmentId: shipOf(o) });
  });
  app.delete('/api/shipments/:id', (req, res) => {
    const sh = shipments.find((x) => x.id === req.params.id);
    if (!sh) return res.status(404).json({ error: 'Shipment not found' });
    seen.push({ path: 'shipment-delete', id: sh.id });
    const linked = orders.filter((o) => shipOf(o) === sh.id);
    for (const o of linked) Object.assign(o, { status: 'Unplanned', shipment_id: null, shipmentId: null });
    removeShipment(sh.id);
    res.json({ deleted: true, id: sh.id, unassignedOrders: linked.length });
  });
  app.get('/api/shipments', (req, res) => {
    res.json({ shipments: req.query.id ? shipments.filter((s) => s.id === req.query.id) : shipments });
  });
  app.patch('/api/shipments/:id', (req, res) => {
    const s = shipments.find((x) => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Shipment not found' });
    seen.push({ path: 'shipment-patch', id: s.id, body: req.body });
    const map = { dockDoor: 'dock_door', dockTime: 'dock_time', loadingStart: 'loading_start', loadingEnd: 'loading_end', status: 'status', carrier: 'carrier' };
    for (const [k, col] of Object.entries(map)) if (k in req.body) s[col] = req.body[k];
    res.json({ id: s.id, status: s.status, dockDoor: s.dock_door, dockTime: s.dock_time, loadingStart: s.loading_start, loadingEnd: s.loading_end });
  });
  app.get('/api/db/warehouse_dock_config', (req, res) => {
    seen.push({ path: 'db-config', q: req.query.q });
    res.json([{ warehouse: ASH, num_doors: 3, start_hour: 6, end_hour: 18 }]);
  });
  app.get('/api/db/dock_loading_durations', (_req, res) => res.json([
    { mode: 'TL', duration_minutes: 120, enabled: true }, { mode: 'LTL', duration_minutes: 90, enabled: true },
  ]));
  app.get('/api/carriers', (_req, res) => res.json({ carriers: [
    { id: 'c1', name: 'Estes Express', scac: 'EXLA', mode: 'LTL', status: 'Active' },
    { id: 'c2', name: 'Swift', scac: 'SWFT', mode: 'TL', status: 'Active', email: 'Dispatch@Swift.example', contact: 'Dana' },
  ] }));
  app.post('/api/ltl/quote', (req, res) => res.json({
    originZip: req.body.originZip, destZip: req.body.destZip, weight: req.body.weight, freightClass: req.body.freightClass || 70,
    quotes: [{ carrier: 'Estes Express', scac: 'EXLA', totalCharge: 312, fscPct: '31.2%', transitDays: 2, czarLinehaul: 900 }],
    generatedAt: '2026-10-17T00:00:00Z',
  }));
  app.post('/api/bulk-plan/rate', (req, res) => {
    const lane = req.body.lanes[0];
    seen.push({ path: 'bulk-plan-body', body: req.body });
    res.json({ results: [{ laneKey: lane.laneKey, loadType: 'LTL', quotes: [
      { carrier: 'XPO LOGISTICS', scac: 'XPOL', mode: 'LTL', totalCharge: 1067, czarBaseGross: 871, fscCharge: 196, fscPct: 22.5, transitDays: 3, miles: 500, recommended: true },
      { carrier: 'SWIFT TRANSPORTATION', mode: 'TL', totalCharge: 2309, czarBaseGross: 1885, fscCharge: 424, transitDays: 1, miles: 500 },
      { carrier: 'NOTRANSIT CO', mode: 'TL', totalCharge: 3000 },
    ] }] });
  });
  app.post('/api/bulk-plan/execute', (req, res) => {
    const p = req.body.plans[0];
    seen.push({ path: 'execute-body', body: req.body });
    res.json({ shipments: [{ id: 'SHP-TEST-1', status: 'Planned', carrier: p.carrier, mode: p.mode,
      total_cost: p.totalCost, pickup_date: p.pickupDate, delivery_date: p.deliveryDate, order_ids: p.orderIds }],
    ordersUpdated: 1, errors: [] });
  });
  app.get('/api/fsc/eia/current', (_req, res) => res.json({ eia: { price: 3.71, priceDate: '2026-10-13' } }));
  app.get('/api/mileage/estimate', (req, res) => res.json({ originZip: req.query.originZip, destZip: req.query.destZip, miles: 968 }));

  return listen(app).then((srv) => ({ ...srv, jwt, refreshed, seen }));
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

async function startStack() {
  const api = await startFakeApi();
  // Reserve a port first so PUBLIC_URL (the OAuth issuer) is known up front.
  const probe = await listen(express());
  const port = probe.port;
  await probe.close();
  const config = {
    port, apiUrl: api.url, publicUrl: `http://localhost:${port}`,
    secret: 'test-secret-test-secret-test-secret-xx', mcpPath: '/mcp', scopes: ['tms:read'],
  };
  const app = createApp(config);
  const mcp = await new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => resolve({ server, close: () => new Promise((r) => server.close(r)) }));
  });
  return { api, mcp, mcpUrl: `http://localhost:${port}`, close: async () => { await mcp.close(); await api.close(); } };
}

module.exports = { startStack, fakeJwt, API_KEY };
