# Microsoft Teams integration — setup guide

Three independent pieces, each usable on its own. All server code is env-gated: with no `TEAMS_*` vars set, nothing changes.

| Piece | What you get | Effort |
|---|---|---|
| 1. Channel notifications | Cards in a Teams channel on tender sent / accepted / rejected | ~5 min |
| 2. Interactive bot | `orders`, `plan`, `tender`, `accept`, `reject` from Teams chat | ~30 min (Azure Bot + tunnel) |
| 3. TMS tab | The full Zoree web UI inside a Teams tab | needs public HTTPS hosting |

Code map: `api/services/teamsNotify.js` (notifications), `api/services/teamsBot/*` + `api/routes/teamsBot.js` (bot), `teams/manifest/` (Teams app package). Health: `GET /health` → `teams`, `GET /api/teams/status`.

---

## 1. Channel notifications (webhook)

1. In Teams, open the target channel → **⋯ → Workflows → "Post to a channel when a webhook request is received"** (or Workflows app → create from that template). Copy the HTTP URL it gives you.
2. In `api/.env`:
   ```
   TEAMS_WEBHOOK_URL=<the URL>
   ZOREE_WEB_URL=http://localhost:5173      # used for "Open in Zoree" buttons
   ```
3. Restart the API (`restart-servers.bat`). Startup log shows `💬 Teams notify: ACTIVE`; `GET /health` → `teams.configured: true`.
4. Test: tender a shipment (or accept one). Cards fire from three seams — tender email sent, status PATCH to Tender Accepted/Rejected, and the `tender_accepted` broadcast — with 30 s dedupe so accepts never double-post.

Optional: `TEAMS_NOTIFY_ORDERS=true` also posts a card per new order (off by default — bulk ingests are noisy). `TEAMS_NOTIFY_ENABLED=false` hard-disables without removing the URL.

## 2. Interactive bot

The bot endpoint is `POST /api/teams/messages`. It validates Bot Framework JWTs, ACKs, and replies via the connector — no new npm dependencies.

**a. Dedicated TMS user.** In Supabase Auth create e.g. `teams-bot@zoree.io` and give it the **planner** (or admin) role. Every bot action runs as this user through the normal endpoints, so role gates and change_history apply. In `api/.env`:
```
TEAMS_BOT_TMS_EMAIL=teams-bot@zoree.io
TEAMS_BOT_TMS_PASSWORD=<its password>
```

**b. Public HTTPS for the endpoint.** For dev on Windows, run a tunnel (in its own terminal, outside this repo's restart scripts):
```
cloudflared tunnel --url http://localhost:3001
```
(or `ngrok http 3001`). Note the HTTPS URL.

**c. Azure Bot registration.** Azure Portal → *Create resource → Azure Bot* (free F0 tier, "Multi Tenant"). After create:
- Configuration → **Messaging endpoint** = `https://<tunnel-domain>/api/teams/messages`
- Copy the **Microsoft App ID**; create a **client secret** under the linked app registration.
- Channels → add **Microsoft Teams**.

In `api/.env`:
```
TEAMS_BOT_APP_ID=<app id>
TEAMS_BOT_APP_PASSWORD=<client secret>
```
Restart the API. `GET /api/teams/status` should show both `true`.

**d. Install in Teams.** Edit `teams/manifest/manifest.json`: set `bots[0].botId` to your App ID and replace `YOUR-TMS-DOMAIN.example.com` (for the tab; if you only want the bot, you can delete the `staticTabs` block and slim `validDomains`). Zip `manifest.json + color.png + outline.png` (files at zip root), then Teams → Apps → **Manage your apps → Upload a custom app**.

**e. Use it.** Chat with the bot (or @mention it in a channel):
```
today                      → counts: unplanned, planned, tendered, in transit, delivered, exceptions
orders                     → unplanned orders, with Plan buttons
shipments                  → recent shipments; status-appropriate action buttons
order ORD-140346           → full order detail + Rate/Plan buttons
shipment SHP-2026-6021     → full shipment detail + next-step buttons
rate ORD-140346            → ranked carrier quotes, then "Plan with <carrier>"
plan ORD-140058 XPO        → creates shipment, flips order to Planned
tender SHP-2026-6021       → status → Tendered (rate-con email still sent from TMS UI)
accept SHP-2026-6021       → status → Tender Accepted + OMS push + WS broadcast
reject SHP-2026-6021       → status → Tender Rejected
withdraw SHP-2026-6021     → back to Planned
intransit / delivered SHP-2026-6021  → move the shipment along
```
Natural phrasing works — filler words are ignored, so `plan order ORD-140346 with XPO`
and `deliver the shipment SHP-2026-6021` both parse correctly.
`accept` mirrors the frontend's `propagateTenderAcceptance` server-side (OMS push + `/api/notify`), so a Teams accept behaves exactly like a web accept — including the post-tender date freeze guard.

Dev note: with `TEAMS_BOT_APP_ID` unset, inbound auth is skipped (warning logged) so you can test with the Bot Framework Emulator; production refuses unauthenticated traffic.

## 3. TMS tab

Teams tabs are iframes, so the frontend host must send `Content-Security-Policy: frame-ancestors` allowing Teams. Already wired:
- Vite dev + preview servers (`frontend/vite.config.js`) send the header.
- The API (`server.js`) sends it too (frameguard disabled, CSP frame-ancestors added).

Steps:
1. Host the frontend on public HTTPS (tunnel to `localhost:5173` works for testing: `cloudflared tunnel --url http://localhost:5173`).
2. In `teams/manifest/manifest.json`, set `staticTabs[0].contentUrl`/`websiteUrl` and `validDomains` to that domain.
3. Same zip/upload as step 2d (one app package can carry both tab and bot).

Login inside the tab uses the normal TMS login (token auth, no third-party cookies needed). If the tab renders blank, check the browser console for a frame-ancestors violation — the header isn't reaching Teams (usually a proxy stripping it).

## Troubleshooting

- `GET /health` → `teams.lastError` — last webhook failure (bad URL, workflow disabled).
- Bot replies nothing: check API console for `[teamsBot]` lines — inbound auth rejection (wrong App ID/secret), TMS sign-in failure (bot user creds/role), or tunnel down.
- Cards but no buttons working: buttons need the **bot** installed (webhook-only setups get link buttons only — that's by design).
- Multiple channels: create more Workflows; today one `TEAMS_WEBHOOK_URL` = one channel.
