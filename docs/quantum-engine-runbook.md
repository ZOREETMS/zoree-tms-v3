# Otodus Quantum engine — runbook

How Zoree connects to the vendor's optimizer (`tms-platform.tar`, vendor manual
"Quantum-Enhanced TMS Platform: End-to-End Operations & Command Reference").

## How it fits together

```
React app ── QuantumApi (frontend/src/lib/api.js)
              └─ quantumService.js
                    │  POST /api/quantum/plan/{consolidate,rates}   (auth required)
Express API ── routes/quantumEngine.js
              └─ services/quantumPlanning.js
                    load orders/carriers/rates ─ quantumPreflight ─ quantumEngineMapper
                    ─ readiness gate ─ quantumEngine (HTTP) ─ validateConsolidation
                    │  X-API-Key
Docker ─────── tms-engine container on :8000  (/api/v1/...)
```

Nothing writes to the database. Results are proposals.

## 1. Check the image architecture FIRST

The build received on 2026-09-03 is **arm64**. It loads on an x86-64 Windows
machine and then fails to start, or runs under emulation where none of the
vendor's benchmarks hold. Check before anything else:

```powershell
docker load -i tms-platform.tar
docker image inspect tms-platform:latest --format "{{.Architecture}}"
```

It must print `amd64`. If it prints `arm64`, ask the vendor for an amd64 build.

## 2. Start the engine (PowerShell)

Bind to localhost only and mount nothing. It is a compiled black box from an
outside party, so keep it away from the repo and the host network.

```powershell
docker run -d -p 127.0.0.1:8000:8000 -e CLIENT_API_KEY="<vendor key>" --name tms-engine tms-platform:latest
curl.exe http://localhost:8000/api/v1/health
```

Lifecycle: `docker logs -f tms-engine` · `docker stop|start|restart tms-engine` · `docker rm -f tms-engine`

## 3. Point Zoree at it

`api/.env`:

```
QUANTUM_ENGINE_URL=http://localhost:8000
QUANTUM_ENGINE_API_KEY=<same vendor key>
```

Restart the API (`restart-servers.bat`).

## 4. Verify, in this order

```powershell
cd api
node scripts/quantumRun.js --limit 50 --density 12 --dry   # builds payload, sends nothing
node scripts/quantumRun.js --limit 50 --density 12         # live; writes quantum-runs/<stamp>/
```

Then from the app (signed in): `GET /api/quantum/status` should return
`reachable: true`, and `POST /api/quantum/plan/consolidate` with
`{ "densityLbPerCuft": 12, "dryRun": true }` should return `status: "dry_run"`.

## Plan request body

| field | meaning |
|---|---|
| `orderIds` | specific orders; omit to use unplanned orders (`shipment_id is null`) |
| `limit` | when no ids; default 200, max 5000 |
| `densityLbPerCuft` | required today; orders have no volume. 12 = 53' dry van |
| `allow` | preflight rule codes to deliberately ignore, e.g. `["preferred_carrier"]` |
| `dryRun` | build and return the payload without calling the engine |

Response `status`: `ok` · `dry_run` · `blocked` (HTTP 422, with `blockers`).
For consolidate, only `feasible` groups and `totals.feasible_savings` are
actionable. The engine does not enforce the capacity caps it is sent, so
`infeasible` groups must never be planned.

## Known data limits (not bugs in the connector)

- Only carriers with a real `cost_per_mile` are sent (1 of 11 at last check).
  Lane per-mile rates exist in `rates`. See `pickLaneRatePerMile` in the mapper.
- Volume is estimated from density for every order. Each one is listed in
  `summary.volume_estimated_ids`.
- The engine's rate table keys on 4 Census regions, so lane-level pricing is
  coarsened.
