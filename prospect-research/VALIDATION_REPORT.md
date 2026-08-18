# Zoree AI-Native TMS — Prospect Database Validation Report

**Date:** 2026-08-17 · **Geography:** United States & Canada only · **Apollo credits consumed:** 1,593 of 2,610

---

## Headline numbers

| Metric | Value |
|---|---|
| **Final unique qualified prospects** | **1,082** |
| Unique companies | 435 |
| Unique buying entities (after corporate-family collapse) | 435 |
| A+ (score 9–10) | 270 |
| A (score 8) | 284 |
| B (score 6–7) | 528 |
| C (score ≤5) | **0 — all removed** |
| Verified emails | 933 (86.2%) |
| No email (LinkedIn only) | 146 (13.5%) |
| Extrapolated, explicitly flagged as NOT verified | 3 (0.3%) |
| Deep Research (sourced company signal) | 825 (76.2%) |
| Enriched (no sourced signal) | 257 (23.8%) |

## Funnel — every removal accounted for

| Stage | Count |
|---|---|
| Companies retrieved (Apollo company search) | 1,100 raw → **821** vetted accounts |
| Raw contacts discovered across 10 batches | ~3,900 search hits |
| Contacts enriched (credits spent) | 1,277 + 200 + 103 = **1,580** |
| Merged raw rows | 1,541 |
| Removed as duplicates | 1 |
| Removed — dead company (Rite Aid, Ch. 11 wind-down, DCs closing) | 1 |
| Removed — QA Pass 1 (role fit, geography, data quality) | 38 |
| Removed — C-grade after scoring | 388 |
| Removed — QA Pass 2 independent review (67 cuts, all severities) | 67 |
| Removed — top-25 deep research (departed / departing / unverifiable) | 3 |
| **Final** | **1,082** |

Removal reasons in detail:
- **Poor role fit:** 38 (32 titles with no supply-chain token; 5 pure procurement/sourcing; 1 banned function as primary remit)
- **Poor company fit:** 1 (Rite Aid) + carriers/3PLs/brokers excluded at the account stage before any credits were spent
- **Data quality / duplicates:** 1 duplicate + 4 cross-employer email domains + 1 company-variant collapse (Nextpower→Nextracker)
- **Scoring threshold:** 388 C-grade
- **Independent QA:** 67
- **Deep-research corrections:** 3

## Verification assertions — all executed, all passing

| Check | Result | Status |
|---|---|---|
| Unique Apollo person IDs = row count | 1,082 = 1,082 | PASS |
| Duplicate emails | 0 | PASS |
| Duplicate LinkedIn URLs (normalised) | 0 | PASS |
| Duplicate normalised name + company | 0 | PASS |
| Fuzzy / nickname near-duplicates | 0 pairs | PASS |
| Rows outside US / Canada | 0 | PASS |
| Max contacts per buying entity | 4 | PASS |
| Grade ↔ score consistency | 0 mismatches | PASS |
| C-grade retained | 0 | PASS |
| Blank first/last/title/company | 0 | PASS |
| Rows with neither email nor LinkedIn | 0 | PASS |
| Role-based emails (info@, sales@) | 0 | PASS |
| Free-mail domains (gmail, yahoo…) | 0 | PASS |

### Process confirmations

- ✅ **Duplicate email check** — completed (exact, case-insensitive, blanks excluded)
- ✅ **Duplicate LinkedIn check** — completed (normalised for scheme, `www.`, trailing slash, query string)
- ✅ **Normalised name + company check** — completed (case, punctuation, middle initials, and suffixes Inc/LLC/Ltd/Corp/Co/plc/GmbH/Group/Holdings stripped)
- ✅ **Fuzzy duplicate review** — completed (30-entry nickname table + token-sort similarity ≥0.90 within each company; 0 pairs found)
- ✅ **QA Pass 1** — completed (role relevance, geography, email anomalies, staleness, per-company cap, company-variant collapse)
- ✅ **QA Pass 2** — completed by an **independent subagent** with no knowledge of how the list was built, briefed as a sales-ops manager accountable for CRM quality. It re-ran all five duplicate tests from scratch and produced 67 cuts across 20 checks.

## Composition

**Persona mix** — P5 exec sponsor 29.7% · P4 logistics 20.7% · **P2 SC technology/systems 17.7%** · **P1 SC transformation 17.1%** · P3 transportation 8.8% · **P6 enterprise apps/architecture 5.8%** · P7 AI 0.2%

- **P1+P2+P6 = 40.6%** — meets the 40% target for the personas that own the build-vs-buy decision.
- **P3 = 8.8%** — well inside the 20% ceiling. The list is not transportation-title-heavy.

**Vertical mix** — Retail/E-comm 233 · Consumer & F&B 200 · Distribution/Wholesale 136 · High Tech 130 · Industrial Mfg 113 · Automotive 112 · Chemicals/Materials/Aero 87 · Medical Device/Pharma 71

**Geography** — United States 1,033 · Canada 49

## Honest limitations — read before importing

1. **23.8% of rows carry no sourced company signal.** Signal research covered the 420 largest of 675 companies. Those 257 rows are qualified on role, freight profile and scale only. **None were promoted above B** — the scoring caps an unresearched company at 6. The column reads `none_found` rather than filler.

2. **"Transportation Complexity" is a vertical profile, not company research.** The column is named accordingly. It is one of eight templates mapped from the company's vertical, not an individual finding.

3. **Apollo's "verified" flag is unaudited.** 933 addresses carry Apollo's verified status; deliverability was not independently tested. QA2 found at least one verified address on a domain dead since 2019. Treat as high-confidence, not guaranteed.

4. **Title staleness.** `Record Last Refreshed` is populated on 1,008 of 1,082 rows and every record was checked to be under 12 months old at selection. At normal supply-chain leadership churn, expect 10–15% drift. The top-25 deep pass found **3 errors in 25** — one departed, one departing, one unverifiable title — which is consistent with that estimate and is why deep verification before sending matters.

5. **Revenue is Apollo-estimated.** Some figures are parent-level rather than entity-level, and a few pre-revenue companies carry funding-derived numbers. Since revenue contributes 1 scoring point, a small number of rows rank slightly higher than their true freight volume justifies.

6. **Employee count and city/state are sparse** on a minority of rows where Apollo returned a null organization object.

## What was deliberately NOT done

- **No outreach.** Nothing was emailed, messaged, connected with, or enrolled in any sequence. This is research and qualification only.
- **No invented emails.** Not one address was pattern-guessed. 146 rows have a blank email rather than a plausible-looking fabrication.
- **No unsourced signals.** Every signal carries a URL and a date. Roughly 30 credible-sounding claims were rejected during research for lacking a verifiable source, including several that would have made attractive-looking column entries.

## Deliverables

| File | Contents |
|---|---|
| `MASTER_PROSPECTS.csv` | 1,082 prospects × 32 columns |
| `TOP_100_ACCOUNTS.csv` | 100 accounts ranked by signal strength, contact quality, scale and depth |
| `TOP_100_PROSPECTS.csv` | 100 highest-scoring individuals |
| `TOP_25_DEEP_RESEARCH.csv` | 25 shortlisted for personal outreach, individually verified |
| `06_signals_merged.csv` | 420 companies × sourced public signals with URLs and dates |
| `01_account_universe.csv` | 821 vetted target accounts |
| `09_qa2_cuts.csv` | Independent QA cut list with reasons and severity |
| `00_EXECUTION_PLAN.md` | Plan and self-critique |
