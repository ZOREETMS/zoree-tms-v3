# Kestrel Bay · Carrier Invoice Agent (BackOps SE panel)

Checks each carrier invoice against the TMS shipment and the contract rate, clears the clean ones, and routes the rest to a person with the reason. Built on the Zoree freight-audit rules, extended for Kestrel Bay's AP rules.

## Run it (laptop, no cloud needed)

Double-click `start-demo.bat`, or:

```
cd demo\kestrel-bay
npm install      (first time only)
npm start        → http://localhost:4310
npm run check    → offline check of all 8 invoices, no network
```

- Claude key: read from `demo/kestrel-bay/.env`, else from `api/.env`. With no key or no internet, the rules engine still decides everything and writes the reasons itself — the demo cannot break on the network.
- `AGENT_MODE=shadow` (default): agent recommends, people act. Matches the Nov 20 – Jan 5 peak freeze.

## What the agent does

Invoice PDF (AP inbox) → **Claude reads it** into fields → agent **checks the read** (lines add up, carrier contracted, confidence ≥ 0.85; else a person keys it) → matches the **TMS shipment** and **contract lane** (read-only) → **AP rules decide** → clean invoices go on the **ready-to-post list**, everything else goes to a person with the reason and a recommendation.

Claude reads and explains. Fixed rules decide pay or no-pay. Nothing is written to the TMS or NetSuite.

| Layer | File |
|---|---|
| Invoice PDFs (3 carrier layouts) | `inbox/*.pdf` — regenerate with `scripts/make_invoices.py` |
| PDF read (Claude) + cache for offline | `src/services/invoiceExtractor.js` |
| Read checks | `src/services/extractionChecks.js` |
| AP rules (pure) | `src/services/auditRules.js` |
| Batch + duplicate ledger + summary | `src/services/auditRunner.js` |
| End-to-end agent with live progress | `src/services/agentPipeline.js` |
| Explanations, carrier email, Q&A | `src/services/explainer.js` |
| Ready-to-post CSV for AP | `src/services/apExport.js` |
| TMS + contract extracts, AP/IT rules | `src/data/*.json` |

`npm run check` runs the real agent on all 8 PDFs and compares the read and the decision with expected AP outcomes. `node scripts/verify.js --offline` does the same from cached reads.

## Expected result

| # | Invoice | Result | Why |
|---|---|---|---|
| 1 | RF-88213 | Clear | Base and 24% fuel match contract |
| 2 | RF-88214 | Overbilled $85 | Liftgate not approved in TMS |
| 3 | RF-88219 | Clear | Matches contract |
| 4 | BW-5521 | Overbilled $122 | Base $100 over; 22% fuel applied to the wrong base (+$22) |
| 5 | PE-0931 | Clear | Detention 2 hrs × $75 = $150, approved in TMS |
| 6 | RF-88213 (resent) | Duplicate | Same invoice number and PRO as #1 |
| 7 | BW-5527 | No match | KB-SH-40999 not in TMS |
| 8 | RF-88230 | Not payable | KB-SH-40155 is cancelled |
| 9 | PE-0944 (phone scan, added) | Clear | Crooked, noisy image-only PDF — still read at 0.90 confidence |
| 10 | RF-88241 (added) | Read check failed | Lines add up to $510.88 but the printed total is $519.88 — a person keys it, the agent never guesses |

Invoices 9 and 10 were added to the sample (with shipments KB-SH-40160 / 40163) to show bad data being handled live; the page says so in the data-pack check.

Overcharges caught $207 on 2 invoices; $2,981.24 held on 4 invoices; $1,757.04 ready to post.
