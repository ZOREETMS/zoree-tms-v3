# Zoree Quantum Planning Engine (`engine: "zoree"`)

Zoree's own load-consolidation optimizer. It is a QUBO formulation that one of three in-process samplers solves: simulated annealing, simulated bifurcation (quantum-inspired) or an exact solver. The same model can be sent to D-Wave hardware. It plugs into the existing `/api/quantum/plan/*` pipeline in place of the Otodus container, behind the same interface.

## Why it exists

The Otodus engine is a compiled arm64 black box. It does not run natively on x86, it does not enforce the capacity caps it is sent, and it cannot be audited. This engine is source-owned. It runs anywhere Node runs, needs no license key, and prices every load it returns exactly.

## Pipeline

```
orders ─▶ quantumPreflight ─▶ quantumEngineMapper ─▶ quantumLocal ─▶ validateConsolidation ─▶ proposal
                                                     │
                     costModel ◀────────────────────┤  exact pricing + feasibility
                     consolidation: bucket → column pool → set-packing QUBO
                     sampler:  local (simulated annealing) | sb (simulated bifurcation)
                               | exact (proven optimum) | dwave-* (D-Wave hardware)
                     greedy baseline + local-search polish on every bucket
```

Nothing is written to the database. Each result is a proposal, as before.

## Formulation

1. **Decompose.** Bucket shipments by region lane, then by ready time, into chunks of at most 24.
2. **Column pool.** Build candidate loads: every feasible, profitable pair, then beam-grown triples up to 6-shipment loads, plus the greedy plan's loads. Each one is priced by `costModel.evaluateLoad`. That function checks weight and volume caps, at most 3 pickups and 3 drops, at most 1.6× detour, and on-time delivery under a solo-driver HOS clock.
3. **Set-packing QUBO.** For each column c, define a binary variable z[c].

   `E(z) = − Σ S_c·z[c] + P·Σ z[c]·z[d]`, where the second sum runs over pairs of columns that share a shipment, and `P = max S + 1`.

   Hard constraints are enforced by which columns exist. That means no slack bits, and every local minimum is a valid plan.
4. **Sample.** The `sampler` option picks the solver (see Samplers below). The default is seeded simulated annealing, using a neal-style β schedule derived from the coefficients, with read 0 warm-started from the greedy plan.
5. **Polish and benchmark.** Run an exact local search (insert, pair, move). Each bucket keeps the better of QUBO and greedy, and both totals are returned in `benchmark`.

### Formulations tried and rejected (measured)

| Formulation | 40-shipment result | Problem |
|---|---|---|
| Assignment QUBO `x[i,truck]` + slack-bit capacity | Best energy +64,013 (never feasible) | Large slack coefficients freeze single-bit-flip annealing |
| Multilevel max-weight matching | $7,717 vs greedy $8,080 | Pairs everything early and blocks better triples |
| **Set packing over column pool** | **$8,093 vs greedy $8,080** | Kept |

## Samplers

All three in-process samplers read the same QUBO and need no Python, license or network. The D-Wave samplers are covered under Real quantum hardware.

| `sampler` | Algorithm | File | Category |
|---|---|---|---|
| `local` (default) | Simulated annealing, warm-started from greedy | `annealer.js` | Classical (thermal) |
| `sb` | Simulated bifurcation (discrete SB by default, ballistic optional) | `bifurcation.js` | Quantum-inspired |
| `exact` | Branch and bound with a Lagrangian bound | `exact.js` | Exact (proven optimum over the candidate loads) |

**Simulated bifurcation.** This is the algorithm behind Toshiba's SQBM+ (Goto et al., Science Advances 2019 and 2021). It simulates a network of nonlinear oscillators. As the pump rises, each oscillator bifurcates into one of two branches, and the branch pattern is the answer. Every variable moves at once, unlike annealing's one bit flip at a time. Linear terms become couplings to one auxiliary spin. Agents start at random, with no warm start, so the comparison with greedy is fair. A single-flip descent finishes each agent. Settings: `solver.sbAgents` (32), `sbSteps` (1500), `sbMode` (`discrete` | `ballistic`).

**Exact.** This solves the set-packing problem behind the QUBO directly: maximise total savings so that no shipment rides twice. It branches on the most constrained shipment. The bound is the tighter of (a) each shipment's best savings per shipment and (b) a Lagrangian bound whose shipment prices are tuned once at the root by subgradient descent. The greedy plan seeds the incumbent. "Proven" means optimal over the candidate pool. Loads that were never generated cannot be chosen; polish can still find them, which is why a plan can occasionally beat the pool optimum. `solver.exactTimeLimitMs` (2000) caps a bucket; past it the result is reported as unproven.

**Optimality gap.** Set `optimalityGap: true` with any sampler. Each bucket then also gets solved exactly, and the response reports `pool_optimum`, `optimum_proven` and `gap_pct` per bucket, plus `benchmark.optimality` for the whole plan. The `exact` sampler always reports it.

**Validation (2026-11-08).**
- The exact solver matched brute force on 100 random instances. On a 120-shipment batch it matched Google OR-Tools CP-SAT on all 6 buckets; the hardest bucket (429 variables, 40,205 couplings) proved optimal in 93 ms.
- `bifurcation.js` found the brute-force ground state on 39 of 40 random 16-variable QUBOs.
- On the same 120-shipment buckets it landed in the same range as the reference Python package `simulated-bifurcation` 2.0 (128 agents, 10,000 steps): equal on 5 buckets and 1.7% lower on the hardest one.

## Benchmark (synthetic — `node scripts/quantum/benchmark.js 60 120 200 300`)

Each sampler's own savings, before the per-bucket greedy fallback. Gap = how far below the exact result.

| Shipments (seed) | Greedy | SA (`local`) | SB (`sb`) | Exact | SA gap | SB gap | Time SA / SB / exact |
|---|---|---|---|---|---|---|---|
| 60 (7) | $12,912 | $12,979 | $12,979 | $13,157 | 1.35% | 1.35% | 1.6 / 7.8 / 0.2 s |
| 120 (8) | $18,947 | $21,329 | $20,911 | $21,329 | 0.00% | 1.96% | 2.2 / 10.1 / 0.2 s |
| 200 (7) | $41,399 | $43,772 | $42,684 | $43,794 | 0.05% | 2.54% | 4.4 / 13.5 / 0.6 s |
| 300 (7) | $61,058 | $66,826 | $66,351 | $67,393 | 0.84% | 1.55% | 7.2 / 18.8 / 0.7 s |

Times are from a 2-core VM, so expect faster runs on the API machine. Every bucket was proven optimal.

What this shows:
- The exact solver is both the best and the fastest at Zoree's bucket sizes (≤ 24 shipments). It beats greedy by 1.9–12.6%.
- Simulated annealing lands within 0–1.35% of optimal.
- Simulated bifurcation lands within 1.4–2.5% and is the slowest. It is designed for large, dense problems such as Max-Cut, and these QUBOs are dominated by penalty couplings. The benefit of `sb` is an accurate "quantum-inspired" label, not extra savings; the per-bucket greedy fallback means it never costs savings in a live plan.
- None of these figures are customer numbers. They come from synthetic data. Reproduce them on live orders with `optimalityGap: true` before quoting any of them.

Earlier figures (annealing vs greedy, before the exact solver existed) used seeds 7, 7, 11, 3, 5. Annealing beat greedy by 0.5–4.6%, and with annealing switched off the result equalled greedy, so that lift came from the annealer.

## API

```http
POST /api/quantum/plan/consolidate
{ "densityLbPerCuft": 12, "engine": "zoree", "seed": 1, "exportQubo": false,
  "sampler": "exact", "optimalityGap": true }
```

- `sampler` is `local` (default), `sb`, `exact`, `dwave-hybrid`, `dwave-qpu` or `dwave-sa`.
- `optimalityGap` reports each bucket's gap to the proven pool optimum.

- `engine` is `"zoree"` (default, controlled by `QUANTUM_ENGINE_MODE`) or `"otodus"`.
- `seed` makes the plan reproducible.
- `exportQubo` adds a dimod BQM for each bucket, including its column table.
- The response adds `benchmark`, `solver.buckets[]`, `unconsolidated` and `unpriced`. Each group carries `stops`, `route_miles`, `standalone_cost`, `load_cost` and `savings`.

## Real quantum hardware

```bash
pip install dwave-ocean-sdk
# save a plan response made with exportQubo=true to plan.json, then:
python scripts/quantum/solve_bqm_dwave.py plan.json --sampler sa     # local check
python scripts/quantum/solve_bqm_dwave.py plan.json --sampler leap   # D-Wave Leap hybrid (DWAVE_API_TOKEN)
```

On a 120-shipment batch, D-Wave's own `SimulatedAnnealingSampler` reproduced the Node engine's energies exactly on 6 of 7 buckets. That verifies the export.

Current quantum hardware is not expected to beat this solver at these problem sizes. The value of the export is portability and a verifiable path to hardware, not speed today.

## Known limits

- Buckets are per region lane, so cross-lane multi-stop loads are not considered.
- Mileage is great-circle × 1.2, calibrated per shipment to its real miles when known. PC*Miler is not called.
- HOS uses a simple 11-hour drive / 10-hour break clock. There are no appointment times or dock hours.
- Pricing is `base_fee + rate_per_mile × miles` for truckload, and the rate table for standalone rated moves. There are no accessorials or stop-off charges yet; adding a per-stop charge is a one-line change in `costModel`.
- The data gaps listed in the Otodus notes still apply: 10 of 11 carriers have no `cost_per_mile`, and orders have no volume. The engine skips anything it cannot price rather than inventing a price.
