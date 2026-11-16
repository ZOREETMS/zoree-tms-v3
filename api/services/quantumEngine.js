// ═══════════════════════════════════════════════════════════════════
// Quantum Engine Client — api/services/quantumEngine.js
// ─────────────────────────────────────────────────────────────────────
// Thin HTTP client for the third-party "Quantum-Enhanced TMS" optimization
// engine (Otodus Quantum, vendor manual received 2026-09-03). The engine
// runs as a separate Docker container the operator starts on the host
// (see docs — quickstart is `docker run ... tms-platform:latest`); this
// module only talks to its REST API over HTTP. It is NOT the optimizer
// itself and does not bundle, download, or execute the vendor's container.
//
// Config (api/.env):
//   QUANTUM_ENGINE_URL      base URL of the running container, default
//                           http://localhost:8000 (matches the vendor's
//                           `docker run -p 8000:8000` quickstart).
//   QUANTUM_ENGINE_API_KEY  cryptographic license key issued by the
//                           vendor, sent as the X-API-Key header on every
//                           protected call.
//
// The vendor's manual documents exact request bodies for /predict/eta and
// /reroute, but /optimize/rates and /optimize/consolidate are only shown
// piping the vendor's own bundled scripts/sample_input.json — the actual
// JSON schema for a shipment batch isn't published here. Until we have
// that schema (ask the vendor for it, or pull it via
// `docker exec tms-engine cat scripts/sample_input.json` on the host
// running the container), these two functions pass the caller's payload
// through unchanged rather than guessing a shape. Mapping a real Zoree
// shipment/order batch into that payload belongs in a separate mapper
// once the schema is known — do not bolt it onto this client.
//
// Every call throws on non-2xx with `.status` set to the upstream HTTP
// status (mirrors the err.status convention used by fscSchedule.js /
// apiKeys.js) so routes/quantumEngine.js can pass it straight through.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const BASE_URL = (process.env.QUANTUM_ENGINE_URL || 'http://localhost:8000').replace(/\/+$/, '');

function apiKey() {
  const key = process.env.QUANTUM_ENGINE_API_KEY;
  if (!key) {
    throw Object.assign(
      new Error('QUANTUM_ENGINE_API_KEY is not set — add it to api/.env (see api/.env.example)'),
      { status: 500 }
    );
  }
  return key;
}

async function parseBody(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

async function request(method, path, { auth = true, body } = {}) {
  const headers = {};
  if (auth) headers['X-API-Key'] = apiKey();
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // Container not running / wrong URL / network error.
    throw Object.assign(
      new Error(`Quantum engine unreachable at ${BASE_URL}${path}: ${err.message}`),
      { status: 502 }
    );
  }

  const data = await parseBody(res);
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Quantum engine ${path} failed: ${message}`), { status: res.status, data });
  }
  return data;
}

/** GET /api/v1/health — unauthenticated liveness check. */
function checkHealth() {
  return request('GET', '/api/v1/health', { auth: false });
}

/**
 * POST /api/v1/optimize/rates — carrier assignment/pricing under capacity
 * constraints ("Resurgent Dual Ascent"). `payload` must already be in the
 * engine's expected shape — see the schema note in the file header.
 */
function optimizeRates(payload) {
  return request('POST', '/api/v1/optimize/rates', { body: payload });
}

/**
 * POST /api/v1/optimize/consolidate — LTL→FTL bundling via 4D spatial
 * hash partitioning. Same payload-shape caveat as optimizeRates().
 */
function optimizeConsolidate(payload) {
  return request('POST', '/api/v1/optimize/consolidate', { body: payload });
}

/**
 * POST /api/v1/predict/eta — transit time / delay prediction.
 * @param {{distance_miles:number, weather:string, traffic:string, carrier_id:string}} payload
 */
function predictEta(payload) {
  return request('POST', '/api/v1/predict/eta', { body: payload });
}

/**
 * POST /api/v1/reroute — disruption-aware rerouting between two cities.
 * @param {{origin_city:string, destination_city:string, avoid_disruptions?:boolean}} payload
 */
function reroute(payload) {
  return request('POST', '/api/v1/reroute', { body: payload });
}

module.exports = {
  baseUrl: BASE_URL,
  checkHealth,
  optimizeRates,
  optimizeConsolidate,
  predictEta,
  reroute,
};
