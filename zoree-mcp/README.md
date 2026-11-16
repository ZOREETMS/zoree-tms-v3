# zoree-mcp: ZoreeTMS connector for Claude

This is a remote MCP server. It lets Claude read ZoreeTMS orders, shipments, audit history, carriers, LTL quotes, diesel price and lane miles. Users add it in Claude under **Customize → Connectors → Add custom connector** and sign in with their normal ZoreeTMS email and password.

```
Claude ──HTTPS──▶ zoree-mcp (/mcp) ──▶ ZoreeTMS Express API (/api/*) ──▶ Supabase
                 OAuth sign-in          same auth, roles, audit as the web app
```

The server never touches Supabase directly. Every call goes through the Express API with the user's own token, so role checks and the change-history pipeline apply exactly as they do in the web app.

## 1. Tools (v0.1)

| Tool | API route | What it does |
|---|---|---|
| `search_orders` | `GET /api/orders` | Free text plus status, customer and mode filters over the 500 most recent orders |
| `get_order` | `GET /api/orders/:id/full` | Order header and lines |
| `count_orders` | `GET /api/orders/count` | Exact totals for KPIs (no 500-row cap) |
| `search_shipments` | `GET /api/shipments` | Free text plus status, carrier and mode filters |
| `get_shipment` | `GET /api/shipments?id=` | Every field of one shipment |
| `get_history` | `GET /api/{orders,shipments}/:id/history` | Who changed what, and when |
| `list_carriers` | `GET /api/carriers` | SCAC, mode, status, integration flags |
| `rate_order` | `POST /api/bulk-plan/rate` | Every LTL + TL option for an order, as the Plan screen shows it: total, base, fuel, miles, transit, pickup/delivery dates, meets-due-date |
| `quote_ltl` | `POST /api/ltl/quote` | Bare CzarLite LTL lookup by ZIP (no TL, no dates) |
| `get_diesel_price` | `GET /api/fsc/eia/current` | Current EIA diesel price |
| `estimate_miles` | `GET /api/mileage/estimate` | Quick ZIP-to-ZIP miles |
| `get_dock_availability` | `GET /api/shipments`, `GET /api/db/warehouse_dock_config`, `GET /api/db/dock_loading_durations` | Doors at a shipment's origin on its pickup date: booked windows, earliest free start per door, suggested door/window |
| `plan_order` (write) | `POST /api/bulk-plan/execute` | Plans one Unplanned order with a chosen carrier; same route and audit as "Confirm & Create Shipment". No dock |
| `reserve_dock` (write) | `PATCH /api/shipments/:id` | Books a dock door + loading window (auto, by door, or exact door + time; refuses overlaps). Same audited route as the Dock Scheduling board, mirrored to OMS |
| `unplan_order` (write) | `PATCH /api/orders/:id` | Order back to Unplanned, off its shipment — the Orders page "Unplan". Server deletes the shipment if it was the last order (freeing its dock), else re-totals it |
| `cancel_shipment` (write) | `DELETE /api/shipments/:id` | Deletes a shipment; its orders go back to Unplanned (audited). MBOL takes its CBOLs; an orphaned master is removed |
| `release_dock` (write) | `PATCH /api/shipments/:id` | Clears dock door + loading window (reverse of `reserve_dock`), mirrored to OMS |
| `tender_shipment` (write) | `PATCH /api/shipments/:id`, `POST /api/tender/email` | Planned / Tender Rejected shipment → Tendered (orders follow, MBOL's CBOLs too) and the load tender emailed to the carrier on file. `dry_run` previews carrier, cost, dock and recipient without writing |
| `withdraw_tender` (write) | `PATCH /api/shipments/:id` | Tendered shipment (and an MBOL's CBOLs) back to Planned; its Tendered orders back to Planned |

Read-only tools carry `readOnlyHint: true`; the seven write tools carry `destructiveHint: true` so Claude confirms first. `reserve_dock` reads each booking's real loading window and checks overlap, where the web app's auto-assign assumes booked minutes are packed from 06:00. `unplan_order` and `cancel_shipment` refuse a live tender (run `withdraw_tender` first) and anything a carrier has accepted or is moving — the same rule as the bulk Unplan / Delete buttons; a Tender Rejected load can be unplanned directly. `tender_shipment` only tenders to the shipment's own carrier (its rate was quoted for that carrier), puts the real dock in the email (the web app defaults to Door 1 / 06:00–08:00) and is meant to be run with `dry_run: true` first, because the email goes to a real carrier unless `TENDER_EMAIL_OVERRIDE` is set in `api/.env`. Still to come: `update_order_status`, `assign_carrier` (change carrier + re-rate).

## 2. Authentication

The server accepts two kinds of credential on `/mcp`:

- **OAuth (claude.ai, Claude Desktop, mobile).** Claude registers itself, opens the ZoreeTMS sign-in page, and receives the user's Supabase session token. Refresh goes through `POST /api/auth/refresh`. The flow is stateless: client ids, login transactions and auth codes are AES-256-GCM sealed with `MCP_SECRET`, so no new DB table is needed and restarts don't sign anyone out. Auth codes expire after 2 minutes and can be used once.
- **Registration is limited** to Claude's callback hosts (`claude.ai`, `claude.com`) plus localhost for Claude Code. You can override the list with `ALLOWED_REDIRECT_HOSTS`. This stops a look-alike app from registering and harvesting ZoreeTMS logins. The sign-in page also shows which host the user will be sent back to.
- **ZoreeTMS API key (Claude Code, Claude API, scripts).** Send `Authorization: Bearer <api key>`. The server forwards it to the API as `ApiKey <key>`, so the key's role and tenant apply.

Tokens are validated against `GET /api/auth/me` and cached for 30 seconds. Disabled users and revoked keys are rejected.

## 3. Run it locally and connect Claude (testing)

```powershell
cd C:\Zoree\zoree-tms-v3\zoree-tms-v3
npm run dev                                   # API on :3010 (if not already running)
cd zoree-mcp
npm install                                   # first time only
npm test                                      # 21 tests, includes a full OAuth round-trip
powershell -ExecutionPolicy Bypass -File start-with-tunnel.ps1
```

The script starts a Cloudflare quick tunnel and prints a URL like `https://xxxx.trycloudflare.com/mcp`. In Claude, go to **Customize → Connectors → Add custom connector**, paste that URL, click **Connect**, and sign in with your ZoreeTMS login.

Quick-tunnel URLs change on every run, so you'll need to re-add the connector each time. That's fine for testing. For anything longer-lived, use §4.

To use it from Claude Code with an API key instead:

```powershell
claude mcp add --transport http zoree-tms https://<host>/mcp --header "Authorization: Bearer <ZoreeTMS API key>"
```

## 4. Production deploy (fixed URL)

1. Pick a host that both Claude and the API can reach, for example the DigitalOcean droplet next to the API. Use a fixed name such as `mcp.zoree.io`.
2. Set the env vars from `.env.example`:
   - `ZOREE_API_URL` = the public API URL
   - `PUBLIC_URL` = `https://mcp.zoree.io`
   - `MCP_SECRET` = `openssl rand -hex 32`
3. Run `npm ci --omit=dev && node src/index.js` under pm2 or systemd.
4. Put TLS in front with Caddy (`mcp.zoree.io { reverse_proxy localhost:3030 }`) or a named Cloudflare tunnel.
5. Check that `https://mcp.zoree.io/health` and `https://mcp.zoree.io/.well-known/oauth-authorization-server` both respond, then add the connector in Claude.

`PUBLIC_URL` must match the URL Claude uses exactly, because it is the OAuth issuer.

## 5. Known limits

- Search tools filter the 500 most recent rows, because the API list endpoints cap there. `count_orders` gives true totals. Moving search filters into the API (`?status=&customer=&q=`) would lift the cap.
- Tenant scoping is whatever the API enforces today. Login currently resolves every user to `zoree-default`.
- **Before exposing the API publicly, fix `GET /api/db/:table` in `api/server.js`.** It uses `verifyTokenSoft` plus the service role, so anyone who has the API URL can read every allowed table without logging in. The MCP server doesn't use this route, but deploying the API where Claude can reach it also makes this route reachable.
- The login form has a per-IP limit of 10 attempts per 15 minutes, held in memory.

## 6. Layout

```
zoree-mcp/
  src/index.js                 entry; loads .env
  src/config.js                env parsing
  src/app.js                   Express wiring: auth router, /oauth/login, /mcp
  src/mcpServer.js             McpServer per request, bound to the caller's token
  src/tools/{orders,shipments,rating,planning,docks,unplanning,tendering}.js   tool definitions (thin, call the API)
  src/tools/format.js          projection/compaction, error → tool result
  src/services/zoreeApiClient.js  fetch wrapper; Bearer vs ApiKey forwarding
  src/services/sealedBox.js    AES-256-GCM seal/open
  src/auth/oauthProvider.js    OAuth server (stateless)
  src/auth/tokenVerifier.js    bearer validation via /api/auth/me
  src/auth/loginPage.js        sign-in HTML
  src/auth/loginRoutes.js      POST /oauth/login
  test/                        unit + end-to-end (fake API, real MCP client)
  start-with-tunnel.ps1        local test via Cloudflare quick tunnel
```
