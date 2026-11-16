// ════════════════════════════════════════════════════════════════════
// mcpServer.js — builds one McpServer bound to one caller's credential.
//
// The HTTP layer runs stateless: a fresh server + transport per request,
// each holding an API client that forwards that request's token. No
// session state means any instance behind a load balancer can serve
// any request.
// ════════════════════════════════════════════════════════════════════

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { createZoreeApiClient } = require('./services/zoreeApiClient');
const { registerOrderTools } = require('./tools/orders');
const { registerShipmentTools } = require('./tools/shipments');
const { registerRatingTools } = require('./tools/rating');
const { registerPlanningTools } = require('./tools/planning');
const { registerDockTools } = require('./tools/docks');
const { registerUnplanningTools } = require('./tools/unplanning');
const { registerTenderingTools } = require('./tools/tendering');
const pkg = require('../package.json');

const INSTRUCTIONS = [
  'Seven tools change data. Forward: plan_order (creates a shipment), reserve_dock (books a dock door on one) and',
  'tender_shipment (Tendered + emails the carrier — always run it with dry_run: true first and confirm the recipient).',
  'Reverse: unplan_order (order back to Unplanned; deletes its shipment if it was the only order),',
  'cancel_shipment (deletes a shipment, its orders back to Unplanned), release_dock (clears a dock door) and',
  'withdraw_tender (Tendered shipment back to Planned; do this before unplanning or cancelling a Tendered load).',
  'Before any of them, tell the user exactly what will change (carrier, cost, dates, door/window, orders and',
  'shipments affected) and get their go-ahead. Everything else is read-only.',
  'ZoreeTMS is a transportation management system. The read-only tools:',
  'search/get orders and shipments, read audit history, list carriers, rate LTL lanes,',
  'and look up diesel price and lane miles. Order ids look like ORD-xxxxx.',
  'Prefer count_orders for totals; search tools scan the 500 most recent records.',
  'For "carrier options / rates / transit for an order" use rate_order — it matches the Plan screen',
  '(LTL + TL, fuel, transit, pickup/delivery dates). quote_ltl is a bare LTL base-rate lookup by ZIP.',
].join(' ');

function createMcpServer({ apiUrl, token, fetchImpl }) {
  const server = new McpServer(
    { name: 'zoree-tms', title: 'ZoreeTMS', version: pkg.version },
    { instructions: INSTRUCTIONS },
  );
  const api = createZoreeApiClient({ apiUrl, token, fetchImpl });
  registerOrderTools(server, api);
  registerShipmentTools(server, api);
  registerRatingTools(server, api);
  registerPlanningTools(server, api);
  registerDockTools(server, api);
  registerUnplanningTools(server, api);
  registerTenderingTools(server, api);
  return server;
}

module.exports = { createMcpServer };
