// End-to-end: real MCP client ↔ zoree-mcp ↔ fake ZoreeTMS API.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { startStack, API_KEY } = require('./helpers');

let stack;
test.before(async () => { stack = await startStack(); });
test.after(async () => { await stack.close(); });

async function connect(token) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${stack.mcpUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

const parse = (r) => JSON.parse(r.content[0].text);

test('unauthenticated /mcp returns 401 with resource metadata pointer', async () => {
  const res = await fetch(`${stack.mcpUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate') || '', /resource_metadata=.*oauth-protected-resource/);
});

test('OAuth discovery metadata is served', async () => {
  const pr = await (await fetch(`${stack.mcpUrl}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(pr.resource, `${stack.mcpUrl}/mcp`);
  const as = await (await fetch(`${stack.mcpUrl}/.well-known/oauth-authorization-server`)).json();
  assert.ok(as.registration_endpoint && as.authorization_endpoint && as.token_endpoint);
  assert.ok(as.code_challenge_methods_supported.includes('S256'));
});

test('API key: lists 19 tools (12 read-only + 7 write) and runs them', async () => {
  const client = await connect(API_KEY);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['cancel_shipment', 'count_orders', 'estimate_miles', 'get_diesel_price', 'get_dock_availability',
    'get_history', 'get_order', 'get_shipment', 'list_carriers', 'plan_order', 'quote_ltl', 'rate_order', 'release_dock',
    'reserve_dock', 'search_orders', 'search_shipments', 'tender_shipment', 'unplan_order', 'withdraw_tender']);
  const writeTools = tools.filter((t) => !t.annotations || t.annotations.readOnlyHint !== true).map((t) => t.name).sort();
  assert.deepEqual(writeTools, ['cancel_shipment', 'plan_order', 'release_dock', 'reserve_dock', 'tender_shipment',
    'unplan_order', 'withdraw_tender'], 'exactly the seven write tools');
  for (const w of writeTools) {
    assert.equal(tools.find((t) => t.name === w).annotations.destructiveHint, true, `Claude asks before ${w}`);
  }

  const s = parse(await client.callTool({ name: 'search_orders', arguments: { query: 'dallas' } }));
  assert.equal(s.total_matched, 1);
  assert.equal(s.orders[0].id, 'ORD-1');
  assert.equal(s.orders[0].shipMode, undefined, 'camelCase duplicates are projected away');

  const o = parse(await client.callTool({ name: 'get_order', arguments: { order_id: 'ORD-1' } }));
  assert.equal(o.lines[0].item_name, 'Pallet');
  assert.equal(o.order.notes, undefined, 'empty fields dropped');

  const c = parse(await client.callTool({ name: 'count_orders', arguments: { status: 'Planned' } }));
  assert.equal(c.total, 1);

  const sh = parse(await client.callTool({ name: 'get_shipment', arguments: { shipment_id: 'SHP-9' } }));
  assert.equal(sh.shipment.carrier, 'Estes');
  assert.equal(sh.shipment._carrier, undefined);

  const h = parse(await client.callTool({ name: 'get_history', arguments: { entity: 'order', id: 'ORD-1' } }));
  assert.equal(h.changes[0].new_value, 'Planned');

  const cr = parse(await client.callTool({ name: 'list_carriers', arguments: { mode: 'LTL' } }));
  assert.equal(cr.carriers.length, 1);

  const q = parse(await client.callTool({ name: 'quote_ltl', arguments: { origin_zip: '75201', dest_zip: '60601', weight: 900 } }));
  assert.equal(q.cheapest.scac, 'EXLA');
  assert.equal(q.cheapest.czarLinehaul, undefined);

  const d = parse(await client.callTool({ name: 'get_diesel_price', arguments: {} }));
  assert.equal(d.eia_diesel.price, 3.71);

  const m = parse(await client.callTool({ name: 'estimate_miles', arguments: { origin_zip: '75201', dest_zip: '60601' } }));
  assert.equal(m.miles, 968);

  const r = parse(await client.callTool({ name: 'rate_order', arguments: { order_id: 'ORD-1' } }));
  assert.equal(r.option_count, 3);
  assert.equal(r.freight_class, 85, 'highest class on the order lines');
  assert.equal(r.options[0].fuel, 196);
  assert.equal(r.options[0].transit_days, 3);
  assert.equal(r.options[0].pickup, '2027-01-27');
  assert.equal(r.options[0].delivery, '2027-02-01');
  assert.equal(r.options[0].meets_due_date, true);
  assert.equal(r.options[2].transit_days, undefined, 'no transit → no dates');
  const body = stack.api.seen.find((s) => s.path === 'bulk-plan-body').body;
  assert.equal(body.lanes[0].originZip, '75201');
  assert.equal(body.lanes[0].totalWeight, 6000);

  const planned = parse(await client.callTool({ name: 'plan_order', arguments: { order_id: 'ORD-1', carrier: 'swift', mode: 'TL' } }));
  assert.equal(planned.shipment.id, 'SHP-TEST-1');
  assert.equal(planned.shipment.carrier, 'SWIFT TRANSPORTATION');
  const plan = stack.api.seen.find((s) => s.path === 'execute-body').body.plans[0];
  assert.deepEqual([plan.mode, plan.totalCost, plan.rate, plan.fuelSurcharge, plan.pickupDate, plan.deliveryDate, plan.pickupTime],
    ['TL', 2309, 1885, 424, '2027-01-29', '2027-02-01', '06:00']);
  assert.deepEqual(plan.orderIds, ['ORD-1']);

  const notUnplanned = await client.callTool({ name: 'plan_order', arguments: { order_id: 'ORD-2', carrier: 'swift' } });
  assert.equal(notUnplanned.isError, true);
  assert.match(notUnplanned.content[0].text, /not Unplanned/);
  const noQuote = await client.callTool({ name: 'plan_order', arguments: { order_id: 'ORD-1', carrier: 'werner' } });
  assert.match(noQuote.content[0].text, /No quote from 'werner'.*Available/);
  const noTransit = await client.callTool({ name: 'plan_order', arguments: { order_id: 'ORD-1', carrier: 'notransit' } });
  assert.match(noTransit.content[0].text, /no transit time/);
  assert.equal(stack.api.seen.filter((s) => s.path === 'execute-body').length, 1, 'refused plans never reach execute');

  const missing = await client.callTool({ name: 'get_order', arguments: { order_id: 'NOPE' } });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /404/);

  // Every API call carried the caller's key in ApiKey form.
  assert.ok(stack.api.seen.filter((s) => s.path.startsWith('/api/orders')).every((s) => s.auth === `ApiKey ${API_KEY}`));
  await client.close();
});

test('dock tools: availability, auto reserve, explicit door/time, overlap and status refusals', async () => {
  const client = await connect(API_KEY);

  const av = parse(await client.callTool({ name: 'get_dock_availability', arguments: { shipment_id: 'SHP-DOCK' } }));
  assert.equal(av.warehouse.doors, 3, 'warehouse_dock_config row for the origin');
  assert.equal(av.warehouse.hours, '06:00–18:00');
  assert.equal(av.warehouse.load_minutes, 120, 'TL duration from dock_loading_durations');
  assert.deepEqual(av.doors.map((d) => d.earliest_free), ['08:00', '07:30', '06:00'], 'cancelled booking frees Door 3');
  assert.deepEqual(av.suggested, { door: 'Door 3', window: '06:00–08:00' });
  assert.ok(stack.api.seen.some((s) => s.path === 'db-config' && s.q.startsWith('select=*')));

  const clash = await client.callTool({ name: 'reserve_dock',
    arguments: { shipment_id: 'SHP-DOCK', door: 1, start_time: '07:00' } });
  assert.equal(clash.isError, true);
  assert.match(clash.content[0].text, /Door 1 is booked 06:00–08:00 by SHP-D1.*Next free start on Door 1: 08:00/);
  const closed = await client.callTool({ name: 'reserve_dock',
    arguments: { shipment_id: 'SHP-DOCK', door: 'Door 2', start_time: '17:00' } });
  assert.match(closed.content[0].text, /outside dock hours 06:00–18:00/);
  const noDoor = await client.callTool({ name: 'reserve_dock', arguments: { shipment_id: 'SHP-DOCK', door: 'Door 9' } });
  assert.match(noDoor.content[0].text, /Door 9 doesn't exist/);
  const done = await client.callTool({ name: 'reserve_dock', arguments: { shipment_id: 'SHP-DONE' } });
  assert.match(done.content[0].text, /'Delivered'/);
  assert.equal(stack.api.seen.filter((s) => s.path === 'shipment-patch').length, 0, 'refusals never write');

  const r = parse(await client.callTool({ name: 'reserve_dock', arguments: { shipment_id: 'SHP-DOCK' } }));
  assert.equal(r.reserved, true);
  assert.deepEqual(r.dock, { door: 'Door 3', window: '06:00–08:00',
    loading_start: '2027-01-27 06:00', loading_end: '2027-01-27 08:00' });
  const patch = stack.api.seen.find((s) => s.path === 'shipment-patch');
  assert.deepEqual(Object.keys(patch.body).sort(), ['dockDoor', 'dockTime', 'loadingEnd', 'loadingStart'],
    'only dock fields are sent — order dates untouched');

  const again = await client.callTool({ name: 'reserve_dock', arguments: { shipment_id: 'SHP-DOCK', door: 2 } });
  assert.match(again.content[0].text, /already has Door 3.*replace: true/);
  const moved = parse(await client.callTool({ name: 'reserve_dock',
    arguments: { shipment_id: 'SHP-DOCK', door: 2, start_time: '07:30', replace: true } }));
  assert.equal(moved.dock.window, '07:30–09:30');
  assert.equal(moved.previous_dock.door, 'Door 3');
  await client.close();
});

test('reverse tools: unplan, cancel, release dock, withdraw tender — with refusals', async () => {
  const client = await connect(API_KEY);
  const writes = () => stack.api.seen.filter((s) => ['order-patch', 'shipment-delete'].includes(s.path)
    || (s.path === 'shipment-patch' && !String(s.id).startsWith('SHP-D'))).length;

  // Refusals never write.
  const before = writes();
  const already = await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-1' } });
  assert.match(already.content[0].text, /already Unplanned/);
  const tendered = await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-6' } });
  assert.match(tendered.content[0].text, /Tendered — withdraw the tender first \(withdraw_tender on SHP-T1\)/);
  const accepted = await client.callTool({ name: 'cancel_shipment', arguments: { shipment_id: 'SHP-ACC' } });
  assert.match(accepted.content[0].text, /'Tender Accepted' — a carrier is committed/);
  const acceptedOrder = await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-7' } });
  assert.equal(acceptedOrder.isError, true);
  const notTendered = await client.callTool({ name: 'withdraw_tender', arguments: { shipment_id: 'SHP-U2' } });
  assert.match(notTendered.content[0].text, /not Tendered/);
  const noDock = await client.callTool({ name: 'release_dock', arguments: { shipment_id: 'SHP-T1' } });
  assert.match(noDock.content[0].text, /no dock door reserved/);
  const delivered = await client.callTool({ name: 'cancel_shipment', arguments: { shipment_id: 'SHP-DONE' } });
  assert.match(delivered.content[0].text, /'Delivered'/);
  assert.equal(writes(), before, 'refused calls never reach a write route');

  // Only order on its shipment → shipment deleted, its dock freed.
  const u1 = parse(await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-3' } }));
  assert.equal(u1.unplanned, true);
  assert.equal(u1.order.status, 'Unplanned');
  assert.equal(u1.shipment_deleted, true);
  assert.deepEqual(u1.dock_released, { door: 'Door 4', window: '06:00–08:00' });
  const op = stack.api.seen.filter((s) => s.path === 'order-patch').pop();
  assert.deepEqual(op.body, { status: 'Unplanned', shipmentId: null }, 'same body as the Orders page Unplan');

  // One of two orders → shipment kept with the other, still holding its dock.
  const u2 = parse(await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-4' } }));
  assert.equal(u2.shipment_deleted, false);
  assert.deepEqual(u2.shipment_kept_with_orders, ['ORD-5']);
  assert.match(u2.note, /SHP-U2 still holds Door 5/);

  // Release that dock, then cancel the shipment.
  const rel = parse(await client.callTool({ name: 'release_dock', arguments: { shipment_id: 'SHP-U2' } }));
  assert.equal(rel.released, true);
  assert.equal(rel.previous_dock.door, 'Door 5');
  const rp = stack.api.seen.filter((s) => s.path === 'shipment-patch' && s.id === 'SHP-U2').pop();
  assert.deepEqual(rp.body, { dockDoor: null, dockTime: null, loadingStart: null, loadingEnd: null });
  const c2 = parse(await client.callTool({ name: 'cancel_shipment', arguments: { shipment_id: 'SHP-U2' } }));
  assert.deepEqual(c2.deleted_shipments, ['SHP-U2']);
  assert.equal(c2.orders_returned_to_unplanned, 1);
  assert.equal(c2.dock_released, undefined, 'dock already released');

  // Withdraw a tender → shipment and its Tendered order back to Planned; then it can be unplanned.
  const w = parse(await client.callTool({ name: 'withdraw_tender', arguments: { shipment_id: 'SHP-T1' } }));
  assert.equal(w.status, 'Planned');
  assert.deepEqual(w.orders_back_to_planned, ['ORD-6']);
  const u6 = parse(await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-6' } }));
  assert.equal(u6.shipment_deleted, true);

  // MBOL cancel takes its CBOL; cancelling the last CBOL removes its orphaned master.
  const m = parse(await client.callTool({ name: 'cancel_shipment', arguments: { shipment_id: 'SHP-M1' } }));
  assert.deepEqual(m.deleted_shipments, ['SHP-C1', 'SHP-M1']);
  assert.equal(m.orders_returned_to_unplanned, 1);
  const x = parse(await client.callTool({ name: 'cancel_shipment', arguments: { shipment_id: 'SHP-X1' } }));
  assert.equal(x.master_deleted, 'SHP-M2');
  const gone = await client.callTool({ name: 'get_shipment', arguments: { shipment_id: 'SHP-M2' } });
  assert.equal(gone.isError, true);
  await client.close();
});

test('tender_shipment: dry run, tender + email, no-email carrier, refusals; rejected tender can be unplanned', async () => {
  const client = await connect(API_KEY);
  const sent = () => stack.api.seen.filter((s) => s.path === 'tender-email').length;

  const dry = parse(await client.callTool({ name: 'tender_shipment', arguments: { shipment_id: 'SHP-TN1', dry_run: true } }));
  assert.equal(dry.nothing_written, true);
  assert.equal(dry.email, 'to dispatch@swift.example', 'carrier matched by name, email lower-cased');
  assert.equal(dry.would_tender.dock, 'none reserved');
  assert.equal(sent(), 0);
  assert.ok(!stack.api.seen.some((s) => s.path === 'shipment-patch' && s.id === 'SHP-TN1'), 'dry run never writes');

  const t = parse(await client.callTool({ name: 'tender_shipment', arguments: { shipment_id: 'SHP-TN1' } }));
  assert.equal(t.tendered, true);
  assert.equal(t.status, 'Tendered');
  assert.match(t.email, /^queued to dispatch@swift\.example/);
  assert.match(t.tender_ref, /^TND-TN1-\d{4}$/);
  assert.match(t.note, /No dock door/);
  const patch = stack.api.seen.filter((s) => s.path === 'shipment-patch' && s.id === 'SHP-TN1').pop();
  assert.deepEqual(patch.body, { status: 'Tendered', carrier: 'SWIFT TRANSPORTATION' });
  const mail = stack.api.seen.find((s) => s.path === 'tender-email').body;
  assert.deepEqual([mail.to, mail.cost, mail.dockDoor, mail.customerName, mail.contactName],
    ['dispatch@swift.example', 2309, '', 'Acme', 'Dana'], 'real dock (none), not the web app\'s Door 1 default');
  assert.deepEqual(mail.orderNumbers, ['ORD-10']);
  assert.equal(mail.lineItems.length, 2);

  const again = await client.callTool({ name: 'tender_shipment', arguments: { shipment_id: 'SHP-TN1' } });
  assert.match(again.content[0].text, /'Tendered' — only Planned or Tender Rejected/);
  const noMail = parse(await client.callTool({ name: 'tender_shipment', arguments: { shipment_id: 'SHP-TN2' } }));
  assert.match(noMail.email, /skipped — no email on file for NoMail Freight/);
  assert.equal(sent(), 1, 'one email total');

  // Withdraw puts it back; then it can be tendered again later.
  const w = parse(await client.callTool({ name: 'withdraw_tender', arguments: { shipment_id: 'SHP-TN1' } }));
  assert.equal(w.status, 'Planned');

  // Carrier rejected: order still reads Tendered, but no tender is live — unplan is allowed.
  const rj = parse(await client.callTool({ name: 'unplan_order', arguments: { order_id: 'ORD-11' } }));
  assert.equal(rj.unplanned, true);
  assert.equal(rj.shipment_deleted, true);
  await client.close();
});

test('invalid bearer token is rejected', async () => {
  await assert.rejects(connect('not-a-real-key'));
});

test('full OAuth flow: register → login page → code → token → tool call → refresh', async () => {
  const base = stack.mcpUrl;
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback';

  const reg = await (await fetch(`${base}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirectUri], token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }),
  })).json();
  assert.match(reg.client_id, /^zc_/);
  assert.ok(reg.client_secret);

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const authUrl = new URL(`${base}/authorize`);
  Object.entries({ client_id: reg.client_id, redirect_uri: redirectUri, response_type: 'code',
    code_challenge: challenge, code_challenge_method: 'S256', state: 'st-123', scope: 'tms:read',
    resource: `${base}/mcp` }).forEach(([k, v]) => authUrl.searchParams.set(k, v));
  const page = await fetch(authUrl, { redirect: 'manual' });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Sign in to ZoreeTMS/);
  assert.match(html, /return to <strong>claude\.ai<\/strong>/);
  const tx = html.match(/name="tx" value="([^"]+)"/)[1];

  const bad = await fetch(`${base}/oauth/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx, email: 'sridhar@zoree.io', password: 'wrong' }),
  });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Incorrect email or password/);

  const ok = await fetch(`${base}/oauth/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx, email: 'sridhar@zoree.io', password: 'pw' }),
  });
  assert.equal(ok.status, 302);
  const back = new URL(ok.headers.get('location'));
  assert.equal(back.origin + back.pathname, redirectUri);
  assert.equal(back.searchParams.get('state'), 'st-123');
  const code = back.searchParams.get('code');

  const tokenBody = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri,
    client_id: reg.client_id, client_secret: reg.client_secret };
  const tok = await (await fetch(`${base}/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) })).json();
  assert.equal(tok.access_token, stack.api.jwt);
  assert.equal(tok.refresh_token, 'rt-1');

  const replay = await fetch(`${base}/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(tokenBody) });
  assert.equal(replay.status, 400, 'authorization codes are single-use');

  const client = await connect(tok.access_token);
  const s = parse(await client.callTool({ name: 'search_orders', arguments: { status: 'Planned' } }));
  assert.equal(s.orders[0].id, 'ORD-2');
  await client.close();

  const ref = await (await fetch(`${base}/token`, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'rt-1',
      client_id: reg.client_id, client_secret: reg.client_secret }) })).json();
  assert.equal(ref.access_token, stack.api.refreshed);
  assert.equal(ref.refresh_token, 'rt-2');
});

test('registration refuses non-Claude redirect hosts', async () => {
  const res = await fetch(`${stack.mcpUrl}/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['https://evil.example/cb'] }),
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_client_metadata');
});

test('tampered login transaction shows the expired page', async () => {
  const res = await fetch(`${stack.mcpUrl}/oauth/login`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ tx: 'forged', email: 'a@b.c', password: 'pw' }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /expired/);
});
