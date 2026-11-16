#!/usr/bin/env python3
"""
D-Wave sampler sidecar — scripts/quantum/dwave_sampler.py
──────────────────────────────────────────────────────────
Called by api/services/quantumLocal/dwaveSampler.js. Reads ONE JSON request
on stdin, writes ONE JSON response on stdout. Nothing else is printed to
stdout; diagnostics go to stderr.

Request
  {
    "sampler": "hybrid" | "qpu" | "sa",
    "bqm":     { "linear": {label: h}, "quadratic": {"a||b": J}, "offset": c },
    "params":  { "time_limit": 3, "num_reads": 100, "solver": "..." },   # optional
    "label":   "Zoree consolidation"                                     # shows in the Leap dashboard
  }

Response
  { "sample": {label: 0|1}, "energy": float, "sampler": str, "solver": str,
    "problem_id": str|null, "timing": {...}, "num_variables": int }
  or on failure
  { "error": str, "kind": "config" | "auth" | "solver" | "input" }   (exit code 1)

Samplers
  hybrid  LeapHybridSampler — D-Wave Leap hybrid BQM solver (QPU + classical).
          Billed per call against the project's solver-access time.
  qpu     EmbeddingComposite(DWaveSampler()) — the annealing QPU directly.
          Only for small problems (minor-embedding limits).
  sa      dwave.samplers.SimulatedAnnealingSampler — local, free, no token.
          Exercises this exact bridge without spending solver time.

Auth: Ocean reads DWAVE_API_TOKEN from the environment (or a dwave.conf
profile). The Node side passes the API's environment through untouched.

  python dwave_sampler.py --check     readiness: Ocean installed? token set?
                                      token valid? (lists solvers; no solver time used)
Install:  pip install dwave-ocean-sdk
"""

import json
import os
import sys
import warnings

warnings.filterwarnings("ignore")


def emit(obj, code=0):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()
    sys.exit(code)


def fail(kind, message):
    emit({"error": str(message), "kind": kind}, 1)


def check():
    out = {"python": sys.version.split()[0], "ocean": None, "token_set": bool(os.environ.get("DWAVE_API_TOKEN")),
           "token_valid": None, "hybrid_solvers": [], "qpu_solvers": []}
    try:
        import dwave.cloud
        out["ocean"] = getattr(dwave.cloud, "__version__", "installed")
    except ImportError:
        emit(out)
    if not out["token_set"]:
        emit(out)
    try:
        from dwave.cloud import Client
        with Client.from_config() as client:
            solvers = client.get_solvers()
            out["token_valid"] = True
            out["hybrid_solvers"] = [s.name for s in solvers if "hybrid" in s.name]
            out["qpu_solvers"] = [s.name for s in solvers if getattr(s, "qpu", False)]
    except Exception as exc:  # noqa: BLE001 — report, never crash the status endpoint
        out["token_valid"] = False
        out["error"] = f"{type(exc).__name__}: {exc}"
    emit(out)


def to_bqm(spec):
    import dimod
    quadratic = {}
    for key, w in (spec.get("quadratic") or {}).items():
        a, b = key.split("||", 1)
        quadratic[(a, b)] = w
    return dimod.BinaryQuadraticModel(spec.get("linear") or {}, quadratic, spec.get("offset", 0.0), dimod.BINARY)


def classify(exc):
    name = type(exc).__name__
    text = str(exc).lower()
    if "auth" in name.lower() or "401" in text or "token" in text and ("invalid" in text or "missing" in text):
        return "auth"
    if "configfilereaderror" in name.lower() or "no solvers" in text or "solvernotfound" in name.lower():
        return "config"
    return "solver"


def main():
    if "--check" in sys.argv:
        check()

    try:
        req = json.load(sys.stdin)
        sampler_name = req.get("sampler", "hybrid")
        bqm = to_bqm(req["bqm"])
        params = dict(req.get("params") or {})
        label = req.get("label") or "Zoree consolidation"
    except Exception as exc:  # noqa: BLE001
        fail("input", f"bad request: {exc}")

    try:
        import dimod  # noqa: F401
    except ImportError:
        fail("config", "Ocean SDK not installed — pip install dwave-ocean-sdk")

    solver_kw = {}
    if params.get("solver"):
        solver_kw["solver"] = params.pop("solver")

    try:
        if sampler_name == "sa":
            from dwave.samplers import SimulatedAnnealingSampler
            sampler = SimulatedAnnealingSampler()
            ss = sampler.sample(bqm, num_reads=int(params.get("num_reads", 50)), seed=params.get("seed"))
            solver = "dwave-samplers SimulatedAnnealingSampler (local)"
        elif sampler_name == "hybrid":
            if not os.environ.get("DWAVE_API_TOKEN") and not os.environ.get("DWAVE_CONFIG_FILE"):
                fail("config", "DWAVE_API_TOKEN is not set")
            from dwave.system import LeapHybridSampler
            sampler = LeapHybridSampler(**solver_kw)
            kw = {"label": label}
            if params.get("time_limit"):
                kw["time_limit"] = float(params["time_limit"])
            ss = sampler.sample(bqm, **kw)
            solver = sampler.solver.name
        elif sampler_name == "qpu":
            if not os.environ.get("DWAVE_API_TOKEN") and not os.environ.get("DWAVE_CONFIG_FILE"):
                fail("config", "DWAVE_API_TOKEN is not set")
            from dwave.system import DWaveSampler, EmbeddingComposite
            child = DWaveSampler(**solver_kw)
            sampler = EmbeddingComposite(child)
            ss = sampler.sample(bqm, num_reads=int(params.get("num_reads", 100)), label=label)
            solver = child.solver.name
        else:
            fail("input", f"unknown sampler {sampler_name}")
        best = ss.first
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        fail(classify(exc), f"{type(exc).__name__}: {exc}")

    info = getattr(ss, "info", {}) or {}
    timing = info.get("timing") or {k: v for k, v in info.items() if k.endswith("_time") or k == "charge_time"}
    emit({
        "sample": {str(k): int(v) for k, v in best.sample.items()},
        "energy": float(best.energy),
        "sampler": sampler_name,
        "solver": solver,
        "problem_id": info.get("problem_id"),
        "timing": {k: (float(v) if isinstance(v, (int, float)) else v) for k, v in timing.items()},
        "num_variables": len(bqm.variables),
    })


if __name__ == "__main__":
    main()
