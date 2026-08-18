# Zoree AI-Native TMS — Prospect Research Execution Plan

**Date:** 2026-08-17
**Target:** ≥1,000 unique qualified prospects (working pool 1,300–1,500 pre-QA)
**Geography:** United States and Canada ONLY — hard filter, no exceptions
**Apollo credits available:** 2,610 lead credits (cycle ends 2026-09-17)

---

## 0. Tooling reality check (done before planning)

Verified what this Apollo connector actually exposes, because the plan's shape depends on it:

| Capability | Available? | Cost | Implication |
|---|---|---|---|
| `apollo_mixed_people_api_search` | Yes | **Free** | All filtering happens here. Unlimited use. |
| `apollo_mixed_companies_search` | Yes | **1 credit/request** (0 if no results) | Cheap at 100 results/page. Requires user confirmation. |
| `apollo_people_bulk_match` | Yes | 1 credit/person | **Max 10 people per call** — the bottleneck. |
| `apollo_people_match` | Yes | 1 credit/person | Single-record. Only for the top-25 deep dives. |
| `apollo_organizations_bulk_enrich` | Yes | 1 credit/company | Not needed — company search returns the same fields. |
| Record collections (`custom_objects_create`) | **NO** | — | Cannot use the persistent-collection enrichment path. |
| `dynamic_field_enrichment_enrich` | **NO** | — | Cannot bulk-enrich server-side. |
| `organizations_lookup` (free discovery) | **NO** | — | Company discovery must use the paid search. |
| `export_credit` | 0 remaining | — | No Apollo-side CSV export; we assemble the CSV ourselves. |

**Consequence:** enrichment is ~140 sequential `people_bulk_match` calls of 10. Each returns the full employer technology blob and will overflow the tool output cap, spilling to a file that must be `Grep`ped for the ~8 fields we need. This is the single largest execution risk and is mitigated in §9.

## 1. Target company profile

- **Geography:** HQ in United States or Canada.
- **Revenue:** primary band ≥ $500M. Secondary band $100M–$500M admitted only when transportation complexity is demonstrably high (multi-plant, multi-DC, or wholesale/distribution model).
- **Employees:** 501+ primary; 201–500 admitted in the secondary revenue band.
- **Required trait:** physical goods moving at scale. A company that does not ship freight cannot buy a TMS, regardless of size or tech sophistication.

**Hard exclusions:** pure software/SaaS, financial services, insurance, professional services, staffing, marketing agencies, healthcare providers (hospitals/clinics — they buy, they don't run freight networks), education, government, non-profits. Also excluded: carriers, 3PLs, freight brokers and freight forwarders — they sell transportation services and are competitors or partners, not TMS buyers of this type.

## 2. Industries and NAICS codes to search

| # | Batch | NAICS prefixes |
|---|---|---|
| 1 | Industrial manufacturing / machinery | 332, 333 |
| 2 | High tech / electronics / semiconductor | 3341, 3342, 3344, 3345 |
| 3 | Consumer products / food & beverage | 311, 312, 3256, 339 |
| 4 | Retail / e-commerce | 44, 45 |
| 5 | Automotive / auto suppliers | 3361, 3362, 3363 |
| 6 | Medical device / pharmaceuticals | 3391, 3254 |
| 7 | Distribution / wholesale | 42 |
| 8 | Chemicals / building materials / aerospace / paper | 3251, 3252, 327, 3364, 321, 322 |

## 3. Revenue and size ranges

- `revenue_range`: `{min: 100000000}` — post-filter into ≥$500M (full points) and $100–500M (conditional).
- `organization_num_employees_ranges`: `201,500` · `501,1000` · `1001,5000` · `5001,10000` · `10001,50000` · `50001,100000` · `100001,500000`
- `organization_locations`: `["United States", "Canada"]`
- `person_locations`: `["United States", "Canada"]` — **both** must be set. Setting only the org filter returns employees worldwide, which wastes enrichment credits on out-of-scope people.

## 4. Persona groups (8 separate searches per account chunk)

| # | Group | Target share |
|---|---|---|
| P1 | Supply Chain Transformation / Digital | ~18% |
| P2 | Supply Chain Technology / Systems | ~18% |
| P3 | Transportation | ~20% (capped) |
| P4 | Logistics | ~18% |
| P5 | Executive sponsor (CSCO / SVP-VP Supply Chain / VP Ops) | ~14% |
| P6 | Enterprise Applications / Architecture (SC-linked only) | ~8% |
| P7 | AI / Automation (SC-linked only) | ~4% |

Transportation is **capped at 20%** so the dataset does not collapse into one persona. P2 and P6 are deliberately protected — they own the build-vs-buy architectural decision, which is Zoree's actual pitch.

`person_seniorities`: `director`, `vp`, `head`, `c_suite`, plus `manager` only for P3 (transportation/systems managers are genuine influencers) — never `senior`, `entry`, or `intern`.

`include_similar_titles: false` on the narrow persona searches to stop Apollo drifting into adjacent noise.

## 5. Apollo searches to run

**Phase A — account universe (paid, ~16–20 requests ≈ 16–20 credits)**
Two `apollo_mixed_companies_search` requests per batch at `per_page: 100`, filtered by NAICS + revenue + employees + US/Canada HQ. Yields ~1,600 candidate companies → scored and cut to a working universe of **400–500 accounts**.

**Phase B — contacts (free, ~150–190 requests)**
For each chunk of ~25 vetted `organization_ids`, run the 7 persona searches. Free, so we can be exhaustive. Target 2–4 contacts per account.

**Phase C — enrichment (paid, ~1,400 credits)**
Only records that already passed relevance filtering get enriched. Never enrich a record we haven't decided to keep.

## 6. Apify research (company-level signals only)

Apify is for public transformation signals, never contact discovery. Run against the top ~150 accounts by preliminary score, searching: TMS · Transportation Management System · Oracle Transportation Management / OTM · SAP TM · Blue Yonder · Manhattan · MercuryGate · E2open · Descartes · freight optimization · transportation/logistics/supply-chain transformation · digital supply chain · SAP S/4HANA · Oracle ERP · ERP modernization · WMS implementation/modernization · AI supply chain · generative AI · agentic AI · enterprise AI · new distribution centers · new manufacturing facilities · logistics network expansion.

**Every signal carries a source URL. An unsourced signal scores zero.** Never infer a TMS evaluation without direct public evidence. Apollo `technology_names` is inferred vendor data — usable for prioritization, never quotable as fact.

## 7. Target company count

400–500 vetted accounts. At an achieved average of ~2.8 qualified contacts per account that yields ~1,120–1,400 prospects — enough to survive dedupe and QA attrition and still clear 1,000.

## 8. Contacts per company

Target 2–4. Hard cap 4 unless documented. Preferred stack per account: executive sponsor · transformation/technology leader · transportation/logistics leader · systems/architecture stakeholder.

## 9. Execution architecture (context-safety mitigation)

A 1,400-row dataset cannot live in conversation context, and 140 spilling enrichment responses cannot either.

1. **Master dataset on disk from row one:** `prospect-research/master_prospects.csv`. Every batch appends. All dedupe, scoring and QA run as Python over that file.
2. **One subagent per batch.** Each runs its own Phase B searches and Phase C enrichment, greps its own spill files, appends clean rows to a batch CSV, and returns **only a count summary** — never row data. This keeps the orchestrating context clean and lets batches run concurrently.
3. **Per-batch artifacts:** `batch_N_raw.csv` → `batch_N_clean.csv`, so any batch can be re-run in isolation without redoing the others.
4. **Resumability:** an `enrichment_ledger.csv` records every Apollo person ID already enriched, so an interrupted run never double-spends a credit.

## 10. Deduplication methodology

Four passes as Python over the master CSV, each logging the count removed:

1. **Exact verified email.** Collision → keep the record with more populated fields, then more recent `last_refreshed_at`, then more specific title.
2. **Exact LinkedIn URL**, normalized: lowercase, strip scheme, strip `www.`, strip trailing slash, strip query string.
3. **Normalized name + normalized company.** Strip case, middle initials, punctuation, and suffixes (Inc, LLC, Corp, Ltd, plc, GmbH, Co, Holdings, Group). "John A. Smith — ABC Corporation" ≡ "John Smith — ABC Corp."
4. **Fuzzy review.** Nickname table (Bob/Robert, Mike/Michael, Liz/Elizabeth, Jim/James, Dave/David, Bill/William, Rick/Richard, Tom/Thomas, Chris/Christopher, Steve/Steven, Dan/Daniel, Jeff/Jeffrey, Ken/Kenneth, Ron/Ronald, Tony/Anthony) + token-sort ratio ≥ 0.90 on name within the same normalized company → flagged for manual review, not auto-dropped.

Plus a **company-variant collapse** so one account cannot appear as several ("Steris" / "STERIS plc" / "STERIS Corporation").

## 11. Quality scoring (Zoree Fit Score, 1–10)

| Component | Max | Basis |
|---|---|---|
| Role authority / relevance | 3 | 3 = VP+ owning SC transformation/technology or transportation; 2 = director-level in those areas; 1 = manager or adjacent-but-relevant; 0 = weak |
| Transportation / logistics complexity | 2 | 2 = multi-plant + multi-DC + international; 1 = one clear dimension; 0 = unclear |
| Company scale | 1 | 1 = ≥$500M revenue; 0 = below |
| SC / technology transformation signal | 2 | **Requires sourced public evidence** |
| AI / ERP / WMS / TMS modernization signal | 2 | **Requires sourced public evidence** |

**A+** 9–10 · **A** 8 · **B** 6–7 · **C** ≤5. C removed unless documented justification.

Because signal points require sourced evidence and Apify covers only the top ~150 accounts, most accounts will cap at 6–7 (B) without a signal. This is honest scoring, not a defect: A+/A status is reserved for accounts with real public evidence.

## 12. QA methodology and uniqueness verification

**QA Pass 1** — scripted checks over the master CSV: duplicate emails · duplicate LinkedIn URLs · duplicate name+company · fuzzy name pairs · title-relevance regex audit · generic IT/AI without SC tie · procurement-only · warehouse-only · company fit · email-status anomalies (blank, role-based like info@/sales@, malformed, free-domain) · >4 contacts per company · company spelling variants. Fix, recount, and if below 1,000 expand the account universe rather than lower the bar.

**QA Pass 2** — delegated to a **fresh subagent** that receives only the dataset and the criteria, with no knowledge of how it was built, briefed as a sales-ops manager accountable for CRM data quality. It re-runs every duplicate check from scratch and reports independently.

**Final uniqueness proof:** assert `len(df) == df.email.dropna().nunique() + rows_without_email`, plus zero collisions on normalized LinkedIn and on normalized name+company, with the assertion output quoted verbatim in the validation report. No "no duplicates" claim is made unless all four passes and both QA passes actually ran.

---

# PLAN CRITIQUE (self-review before execution)

**Will this produce actual TMS buyers, or generic supply-chain contacts?**
Mostly buyers, but two leaks needed plugging. (a) The original industry list would have pulled in carriers, 3PLs and freight brokers under wholesale/transport NAICS — they sell freight services rather than buy this kind of TMS. Added as a hard exclusion in §1. (b) Retail NAICS 44/45 would surface store-operations and merchandising directors with no freight remit. Corrected: retail persona searches require a supply-chain, logistics, transportation, distribution or systems token in the title.

**Am I over-indexing on Transportation titles?**
That was the plan's biggest weakness — persona search order naturally over-produces P3 because those titles are the most numerous and unambiguous. Fixed with an explicit 20% cap on P3 and protected floors for P2 and P6, enforced in the per-batch mix rather than checked at the end when it would be too late to fix cheaply.

**Am I including Transformation, Systems, Technology and Digital leaders?**
Yes — P1, P2 and P6 together target ~44% of the dataset. These are the roles that own build-vs-buy, which is the actual Zoree proposition, and they are exactly where the Praveen Chapa and Rachel Timura profiles sat.

**Is the universe large enough to survive filtering?**
Yes, with margin. 450 accounts × 2.8 = ~1,260 raw. Expected attrition ~20% (dedupe + QA) leaves ~1,010 — uncomfortably tight. **Corrected: raise Phase A to 1,600 candidate companies and the working universe to the top 500**, targeting ~1,400 raw for ~1,120 final. Credit cost stays within budget.

**Obvious gaps found and corrected:**

1. **Canada was under-served.** NAICS is North American so codes hold, but Apollo revenue data is USD and Canadian mid-caps skew smaller. Added: for Canadian companies, admit the $100M–$500M band on equal footing rather than conditionally, or genuine Canadian manufacturers get filtered out.
2. **No stale-record guard.** A "Director Transportation" who left 18 months ago is a data-quality failure that dedupe would never catch. Added: reject any record whose `last_refreshed_at` is older than 12 months, and prefer `person_days_in_current_title_range: {min: 90}` to skip people too new to have influence yet.
3. **Email status was under-specified.** "Verified" was treated as binary. Corrected: record Apollo's `email_status` verbatim; count `verified` and `likely to engage` separately in the validation report; never present the latter as verified.
4. **No credit circuit-breaker.** 140 enrichment calls could silently overrun. Added: re-check `credit_usage_stats` after every batch and halt if remaining credits drop below 200, reporting rather than continuing blind.
5. **Divisional double-counting.** Large manufacturers appear under multiple Apollo org IDs (subsidiaries, acquired brands — Motorola Solutions alone showed 40 sub-organizations). Two different org IDs for the same parent would let one account masquerade as several and blow the 4-contact cap. Added to the company-variant collapse: map subsidiary org IDs to parent where Apollo exposes `owned_by_organization`.
6. **Revenue is Apollo-estimated, not filed.** For the top 100 accounts, revenue will be cross-checked against public filings before it appears in a deliverable, and flagged as estimated everywhere else.

**Net changes from critique:** account universe 400–500 → **500**; candidate pool 1,600; carriers/3PLs/brokers excluded; retail title-token requirement; P3 capped at 20%; 12-month staleness rejection; email-status granularity; credit circuit-breaker at 200; subsidiary-to-parent collapse; Canadian revenue band equalized.

---

## Credit budget

| Phase | Calls | Credits |
|---|---|---|
| A — account universe | ~18 company searches | ~18 |
| B — contact discovery | ~180 people searches | 0 (free) |
| C — enrichment | ~140 bulk_match × 10 | ~1,400 |
| Top-25 deep research | ~25 single matches | ~25 |
| Contingency (re-enrichment, replacements) | — | ~150 |
| **Total** | | **~1,593 of 2,610** |

Leaves ~1,000 credits of headroom. Circuit-breaker halts at <200 remaining.
