#!/usr/bin/env python3
"""
Solve Zoree consolidation QUBOs on D-Wave — scripts/quantum/solve_bqm_dwave.py
───────────────────────────────────────────────────────────────────────────────
Takes the response of

    POST /api/quantum/plan/consolidate   { ..., "engine": "zoree", "exportQubo": true }

(saved to a file), rebuilds each bucket's QUBO as a dimod BinaryQuadraticModel
and samples it with a D-Wave sampler. Each sample is decoded into loads with
the column table that ships inside the export, so no Zoree code is needed on
the quantum side.

Samplers
    sa     dwave-samplers SimulatedAnnealingSampler — local, free, the same
           algorithm the Node engine runs. Use it to check the export.
    leap   LeapHybridSampler — D-Wave's cloud hybrid solver (QPU + classical).
           Needs DWAVE_API_TOKEN. This is the realistic hardware path.
    qpu    DWaveSampler + EmbeddingComposite — raw quantum annealer. Needs
           DWAVE_API_TOKEN. Only sensible for small buckets (embedding limits).

Install
    pip install dimod dwave-samplers            # sa
    pip install dwave-ocean-sdk                 # leap / qpu

Usage
    python scripts/quantum/solve_bqm_dwave.py plan.json --sampler sa
    python scripts/quantum/solve_bqm_dwave.py plan.json --sampler leap --out dwave_plan.json

Output: per bucket, the energy the Node annealer found vs. the D-Wave energy
(lower is better) and the decoded loads. Savings here are the QUBO's column
savings; the TMS still re-prices and re-validates anything it books.
"""

import argparse
import json
import sys


def load_buckets(path):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    qubos = doc.get("qubos")
    if not qubos:
        sys.exit("No 'qubos' in the file — call /plan/consolidate with engine=zoree and exportQubo=true.")
    return qubos


def to_bqm(dimod, export):
    quadratic = {}
    for key, w in export["quadratic"].items():
        a, b = key.split("||", 1)
        quadratic[(a, b)] = w
    return dimod.BinaryQuadraticModel(export["linear"], quadratic, export["offset"], dimod.BINARY)


def make_sampler(name, reads):
    if name == "sa":
        from dwave.samplers import SimulatedAnnealingSampler
        return SimulatedAnnealingSampler(), {"num_reads": reads}
    if name == "leap":
        from dwave.system import LeapHybridSampler
        return LeapHybridSampler(), {}
    if name == "qpu":
        from dwave.system import DWaveSampler, EmbeddingComposite
        return EmbeddingComposite(DWaveSampler()), {"num_reads": reads}
    sys.exit(f"unknown sampler {name}")


def decode(sample, columns):
    """Switched-on columns, best savings first, dropping any that reuse a shipment."""
    on = [c for c in columns if sample.get(c["label"], 0) == 1]
    on.sort(key=lambda c: -c["savings"])
    used, loads = set(), []
    for c in on:
        if used.intersection(c["shipment_ids"]):
            continue
        used.update(c["shipment_ids"])
        loads.append(c)
    return loads


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("plan", help="JSON response from /api/quantum/plan/consolidate with exportQubo=true")
    ap.add_argument("--sampler", choices=["sa", "leap", "qpu"], default="sa")
    ap.add_argument("--reads", type=int, default=100)
    ap.add_argument("--out", help="write decoded loads here as JSON")
    args = ap.parse_args()

    import dimod

    sampler, kwargs = make_sampler(args.sampler, args.reads)
    results = []
    total = 0.0
    for b in load_buckets(args.plan):
        export = b["bqm"]
        bqm = to_bqm(dimod, export)
        best = sampler.sample(bqm, **kwargs).first
        loads = decode(best.sample, export["columns"])
        savings = sum(c["savings"] for c in loads)
        total += savings
        results.append({
            "bucket": b["bucket"],
            "variables": len(bqm.variables),
            "js_energy": export.get("js_best_energy"),
            "dwave_energy": round(best.energy, 2),
            "savings": round(savings, 2),
            "loads": [{"shipment_ids": c["shipment_ids"], "savings": c["savings"]} for c in loads],
        })
        print(f"{b['bucket']:<28} vars={len(bqm.variables):<5} node={export.get('js_best_energy')!s:<12} "
              f"{args.sampler}={best.energy:<12.2f} loads={len(loads):<3} savings={savings:,.2f}")

    print(f"\nTotal QUBO savings ({args.sampler}): {total:,.2f}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump({"sampler": args.sampler, "total_savings": round(total, 2), "buckets": results}, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
