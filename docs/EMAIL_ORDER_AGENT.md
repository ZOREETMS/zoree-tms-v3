# Email Order Agent

Reads order requests from a mailbox, has Claude pull out the order, and puts each one on the **Email Orders** page as a draft. A planner checks it, fixes anything, and clicks **Create order**. The order lands on the Orders board as `Unplanned`, with `sync_source = 'email'`, a `create` row in change history, and a link back to the email it came from.

```
sridhar@zoree.io ──IMAP (read-only)──▶ mailbox.js ──▶ extractor.js (Claude, forced tool call)
                                                         │
                         email_order_intake (draft) ◀────┘
                                   │  planner approves on /email-orders
                                   ▼
                         orderCreate.js ──▶ orders + order_lines + change_history + SSE/WS
```

## What it does and doesn't do

- **Read-only on the mailbox.** Opens the folder with IMAP EXAMINE. It never marks mail read, moves, labels or deletes anything. Dedupe is by Message-ID in the database.
- **Finds candidates with a Gmail search**, then Claude decides if each one is really an order. Default search: last 2 days of inbox mail mentioning order / PO / load / pickup / pallets / shipment / freight / BOL / tender / ship date, skipping promotions/social/forums and mail you sent. Narrow it with `EMAIL_INTAKE_QUERY` (e.g. a Gmail filter that labels customer mail `zoree-orders`, then `label:zoree-orders newer_than:7d`).
- **Reads** the body, PDF attachments, images (scanned POs) and CSV/TXT attachments. Excel attachments are listed as "not read".
- **Handles** several orders in one email, kg → lb, relative dates ("next Monday"), and matches the customer to existing TMS customer names.
- **Never invents values.** Missing fields stay empty and show as questions to ask the sender. Customer, origin, destination and weight are required before **Create order** is enabled.
- **Flags duplicates** when the PO number already exists on an order.
- **Email content is treated as data.** The model only fills an extraction schema; it has no tool that can change the TMS. Approval is a human click (unless you turn on auto-create).
- Non-order emails are stored as sender + subject only (no body).

## Files

| File | Role |
|---|---|
| `api/migrations/049_email_order_intake.sql` | `email_order_intake` table, `orders.email_intake_id` FK, `sync_source` accepts `'email'` |
| `api/services/emailIntake/mailbox.js` | IMAP reader (imapflow + mailparser) |
| `api/services/emailIntake/extractor.js` | Claude call + extraction schema |
| `api/services/emailIntake/intakeService.js` | validate, dedupe, store draft, approve / reject / retry |
| `api/services/emailIntake/poller.js` | interval + "Check inbox now", one run at a time |
| `api/services/orderCreate.js` | shared create path: insert (never overwrite), lines, rollback on failure, audit, SSE |
| `api/routes/emailIntake.js` | `/api/email-intake/*` (Edit on Orders required to create) |
| `frontend/src/pages/EmailOrdersPage.jsx` + `components/email-orders/*` | review page (sidebar: Planning → Email Orders) |
| `api/__tests__/emailIntake.test.js` | unit tests (`node --test __tests__/emailIntake.test.js`) |

## Run it locally

1. **Database** — Supabase → SQL Editor → paste `api/migrations/049_email_order_intake.sql` → Run.
2. **Claude key** — console.anthropic.com → API keys → create one → `ANTHROPIC_API_KEY=` in `api/.env`.
3. **App password for sridhar@zoree.io** — myaccount.google.com → Security → 2-Step Verification must be on → App passwords → create "Zoree TMS" → paste the 16 characters (no spaces) into `EMAIL_INTAKE_IMAP_PASS=`. If App passwords doesn't appear, the Workspace admin setting for it is off (admin.google.com, signed in as admin). IMAP must also be on for the account (Gmail → Settings → Forwarding and POP/IMAP).
4. Set `EMAIL_INTAKE_ENABLED=true` in `api/.env`.
5. `restart-servers.bat` (nodemon needs a restart to pick up `.env`). The API log prints `✅ Email order agent watching sridhar@zoree.io every 120s`.
6. Open **Email Orders** in the sidebar. Use **Paste an email** to try it without waiting for mail, or **Check inbox now**.

## Settings (`api/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `EMAIL_INTAKE_ENABLED` | `false` | start the poller with the API |
| `EMAIL_INTAKE_IMAP_HOST` / `PORT` | `imap.gmail.com` / `993` | |
| `EMAIL_INTAKE_IMAP_USER` / `PASS` | — | mailbox + app password |
| `EMAIL_INTAKE_MAILBOX` | `INBOX` | IMAP folder |
| `EMAIL_INTAKE_QUERY` | see `mailbox.js` | Gmail search for candidates |
| `EMAIL_INTAKE_POLL_SECONDS` | `120` | min 30 |
| `EMAIL_INTAKE_MAX_PER_POLL` | `10` | emails sent to Claude per run |
| `EMAIL_INTAKE_AUTO_CREATE` | `false` | create without review when confident and complete |
| `EMAIL_INTAKE_AUTO_CREATE_MIN_CONFIDENCE` | `0.9` | |
| `EMAIL_INTAKE_MODEL` | `claude-sonnet-5-5` | |

## API

| Method | Path | |
|---|---|---|
| GET | `/api/email-intake/status` | agent config, last run, counts |
| GET | `/api/email-intake?status=pending_review` | list (`created`, `rejected`, `not_order`, `error`, `all`) |
| GET | `/api/email-intake/:id` | one item incl. email body |
| POST | `/api/email-intake/poll` | check the mailbox now |
| POST | `/api/email-intake/paste` | `{ from, subject, body }` |
| POST | `/api/email-intake/:id/approve` | `{ drafts? }` — edited drafts replace the AI's |
| POST | `/api/email-intake/:id/reject` | `{ reason? }` |
| POST | `/api/email-intake/:id/retry` | re-run Claude on the stored body |

## Deploying to DigitalOcean (later)

The agent runs inside the API process, so it deploys with the API — no extra service.

- Put the same `EMAIL_INTAKE_*` and `ANTHROPIC_API_KEY` values in the droplet's env (or App Platform env vars, marked secret).
- Outbound port **993** to `imap.gmail.com` must be open (it is by default on droplets; check any cloud firewall).
- Run **one** API instance with `EMAIL_INTAKE_ENABLED=true`. If you scale to several, enable it on one only — the unique index stops double-processing, but every instance would still pay for the Claude call before losing the race.
- Turn it off on your laptop (`EMAIL_INTAKE_ENABLED=false`) once the droplet is live, for the same reason.
- Logs: `[emailIntake] poll: {...}` after each run that found new mail; failures as `[emailIntake] poll failed: …` and on the page header.

## Cost

One Claude call per candidate email. A plain-text order email is roughly 2–3K input tokens and under 1K output; a PDF PO adds about 1.5–3K tokens per page. Non-order emails that slip through the Gmail search still cost one call each — tighten `EMAIL_INTAKE_QUERY` if that adds up.
