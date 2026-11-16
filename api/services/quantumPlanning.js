// ═══════════════════════════════════════════════════════════════════
// Quantum Planning — api/services/quantumPlanning.js
// ─────────────────────────────────────────────────────────────────────
// Connects Zoree's own data to a quantum planning engine for the app.
// This is the in-process twin of scripts/quantumRun.js: same pipeline,
// same guards, but it returns a structured result instead of printing,
// so routes/quantumEngine.js can serve it to the UI.
//
// Two engines, same interface, chosen per call (`engine` option) or by
// QUANTUM_ENGINE_MODE (default 'zoree'):
//   zoree   services/quantumLocal — Zoree's own QUBO set-packing optimizer,
//           in-process, source-owned, benchmarked against greedy each run
//   otodus  services/quantumEngine — the vendor container over HTTP
//
//   1. Load    orders (explicit ids, or unplanned ones), carriers,
//              rates, equipment caps, known lane miles, zip geo
//   2. Guard   quantumPreflight — drop orders the engine cannot plan
//              safely (no_consolidate, hazmat, dedicated, preferences…)
//   3. Map     quantumEngineMapper — never zero-fills a priced field
//   4. Gate    refuse to call the engine on an empty / unpriced batch
//   5. Call    quantumEngine (HTTP transport only)
//   6. Verify  validateConsolidation — the engine does NOT enforce the
//              capacity caps it is sent; infeasible groups are split out
//              and never counted toward savings
//
// NOTHING IS WRITTEN TO THE DATABASE. The output is a proposal; turning
// a feasible group into a shipment goes through the normal planning
// path (and its change-history audit), not through here.
//
// Dependencies are injected (createQuantumPlanning) so the pipeline is
// unit-testable without Supabase or a running container. The default
// export is wired to the real modules.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const TASKS = Object.freeze(['consolidate', 'rates']);
const ENGINES = Object.freeze(['zoree', 'otodus']);
const SAMPLERS = Object.freeze(['local', 'sb', 'exact', 'dwave-hybrid', 'dwave-qpu', 'dwave-sa']);
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 5000;
const MAX_IDS = 5000;
const ID_CHUNK = 200;

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Normalise and validate the caller's options. Throws 400 on bad input. */
function normaliseOptions(raw = {}) {
  const task = String(raw.task || 'consolidate').toLowerCase();
  if (!TASKS.includes(task)) throw badRequest(`task must be one of ${TASKS.join(', ')}`);

  let orderIds = raw.orderIds;
  if (orderIds !== undefined && orderIds !== null) {
    if (!Array.isArray(orderIds)) throw badRequest('orderIds must be an array of order ids');
    orderIds = [...new Set(orderIds.map((x) => String(x).trim()).filter(Boolean))];
    if (orderIds.length > MAX_IDS) throw badRequest(`orderIds is capped at ${MAX_IDS}`);
  } else {
    orderIds = [];
  }

  let limit = raw.limit === undefined || raw.limit === null ? DEFAULT_LIMIT : Number(raw.limit);
  if (!Number.isInteger(limit) || limit < 1) throw badRequest('limit must be a positive integer');
  limit = Math.min(limit, MAX_LIMIT);

  let density;
  if (raw.densityLbPerCuft !== undefined && raw.densityLbPerCuft !== null && raw.densityLbPerCuft !== '') {
    density = Number(raw.densityLbPerCuft);
    if (!(density > 0)) throw badRequest('densityLbPerCuft must be a positive number');
  }

  const allow = Array.isArray(raw.allow) ? raw.allow.map(String) : [];

  let engine;
  if (raw.engine !== undefined && raw.engine !== null && raw.engine !== '') {
    engine = String(raw.engine).toLowerCase();
    if (!ENGINES.includes(engine)) throw badRequest(`engine must be one of ${ENGINES.join(', ')}`);
  }

  let seed;
  if (raw.seed !== undefined && raw.seed !== null && raw.seed !== '') {
    seed = Number(raw.seed);
    if (!Number.isInteger(seed) || seed < 0) throw badRequest('seed must be a non-negative integer');
  }

  let sampler;
  if (raw.sampler !== undefined && raw.sampler !== null && raw.sampler !== '') {
    sampler = String(raw.sampler).toLowerCase();
    if (!SAMPLERS.includes(sampler)) throw badRequest(`sampler must be one of ${SAMPLERS.join(', ')}`);
    if (engine === 'otodus') throw badRequest('sampler applies to the zoree engine only');
  }

  let dwaveTimeLimit;
  if (raw.dwaveTimeLimit !== undefined && raw.dwaveTimeLimit !== null && raw.dwaveTimeLimit !== '') {
    dwaveTimeLimit = Number(raw.dwaveTimeLimit);
    if (!(dwaveTimeLimit > 0) || dwaveTimeLimit > 300) throw badRequest('dwaveTimeLimit must be between 0 and 300 seconds');
  }

  return {
    task, orderIds, limit, density, allow, dryRun: raw.dryRun === true, engine, seed,
    exportQubo: raw.exportQubo === true, sampler, dwaveTimeLimit,
    optimalityGap: raw.optimalityGap === true,
  };
}

/** First-seen shipment mileage per order id — real miles beat haversine. */
function buildMilesByOrderId(shipments) {
  const m = new Map();
  for (const s of shipments || []) {
    if (!s || !s.miles || !Array.isArray(s.order_ids)) continue;
    for (const oid of s.order_ids) if (!m.has(oid)) m.set(oid, Number(s.miles));
  }
  return m;
}

/**
 * Carrier capacity from Zoree's own equipment_types (LTL carriers → LTL,
 * everything else → DV53). Same rule as scripts/quantumRun.js and
 * migration 048's backfill — caps are never invented here.
 */
function buildCapsByCarrierId(carriers, equipment) {
  const byCode = new Map((equipment || []).map((e) => [String(e.code).toUpperCase(), e]));
  const caps = new Map();
  for (const c of carriers || []) {
    const eq = byCode.get(String(c.mode).toUpperCase() === 'LTL' ? 'LTL' : 'DV53');
    if (eq) caps.set(c.id, { max_weight: Number(eq.max_weight), max_volume: Number(eq.max_volume) });
  }
  return caps;
}

/** Collapse skip lists to {reason: count} so the UI can show a table. */
function countReasons(rows) {
  const out = {};
  for (const r of rows || []) {
    // "no geo for origin zip 12345" → "no geo for origin zip"
    const k = String(r.reason || 'unknown').replace(/\s+\S*\d\S*$/, '').trim();
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function createQuantumPlanning(deps) {
  const { dbSelect, zipGeo, mapper, preflightOrders } = deps;
  // `engine` is the Otodus HTTP client (kept under its original name);
  // `localEngine` is Zoree's own optimizer. Callers that inject only
  // `engine` (older tests, scripts) keep Otodus as their default.
  const engines = {};
  if (deps.engine) engines.otodus = deps.engine;
  if (deps.localEngine) engines.zoree = deps.localEngine;
  const defaultEngine = deps.defaultEngine && engines[deps.defaultEngine]
    ? deps.defaultEngine
    : (engines.zoree ? 'zoree' : 'otodus');

  function pickEngine(name) {
    const key = name || defaultEngine;
    const e = engines[key];
    if (!e) throw badRequest(`engine '${key}' is not configured on this server`);
    return { key, e };
  }

  async function loadOrders({ orderIds, limit }, tenantConfig) {
    if (orderIds.length) {
      // Chunked: PostgREST puts `in.(…)` in the URL, and thousands of ids
      // in one request overflows the URL length limit.
      const rows = [];
      for (let i = 0; i < orderIds.length; i += ID_CHUNK) {
        const chunk = orderIds.slice(i, i + ID_CHUNK);
        rows.push(...await dbSelect('orders', { filters: [['id', 'in', chunk]], limit: chunk.length }, tenantConfig));
      }
      const found = new Set(rows.map((o) => String(o.id)));
      return { orders: rows, notFound: orderIds.filter((id) => !found.has(id)) };
    }
    // No ids → unplanned orders only. Preflight still re-checks status,
    // this filter just keeps the batch from filling up with planned rows.
    const rows = await dbSelect('orders', { filters: [['shipment_id', 'is', null]], limit }, tenantConfig);
    return { orders: rows, notFound: [] };
  }

  /**
   * Build the engine payload from live data, without calling the engine.
   * @returns {Promise<object>} everything the caller needs to explain the batch
   */
  async function buildPayload(opts, tenantConfig = null) {
    await zipGeo.load(tenantConfig);

    const [{ orders, notFound }, carriers, rates, shipments, equipment] = await Promise.all([
      loadOrders(opts, tenantConfig),
      dbSelect('carriers', {}, tenantConfig),
      dbSelect('rates', { limit: 20000 }, tenantConfig),
      dbSelect('shipments', { limit: 5000 }, tenantConfig),
      dbSelect('equipment_types', {}, tenantConfig),
    ]);

    const pre = preflightOrders(orders, { allow: opts.allow });

    const S = mapper.toEngineShipments(pre.eligible, {
      resolveGeo: zipGeo.resolveGeo,
      milesByOrderId: buildMilesByOrderId(shipments),
      assumedDensityLbPerCuft: opts.density,
    });
    const C = mapper.toEngineCarriers(carriers, { capsByCarrierId: buildCapsByCarrierId(carriers, equipment) });
    const R = mapper.toEngineRateTable(rates, { regionOf: zipGeo.regionOf });

    const blockers = [];
    if (!S.shipments.length) blockers.push('No orders could be mapped — the engine would receive an empty batch.');
    if (!C.carriers.length) blockers.push('No carriers could be mapped — nothing to assign freight to.');
    if (!R.rate_table.length) blockers.push('Rate table is empty — the engine would silently fall back to its own internal pricing.');

    // Absolute service windows for the mapped shipments. The Otodus
    // contract only has sla_hours; the Zoree engine also uses ready/due to
    // check that consolidated members are delivered on time.
    const mappedIds = new Set(S.shipments.map((s) => s.id));
    const windows = {};
    for (const o of pre.eligible) {
      if (mappedIds.has(String(o.id))) windows[String(o.id)] = { ready: o.ready || null, due: o.due || null };
    }

    const volumeHint = S.skipped.some((s) => /volume/.test(s.reason)) && !opts.density
      ? 'Orders carry no volume. Pass densityLbPerCuft (12 matches a 53\' dry van) to estimate it.'
      : null;

    return {
      payload: { shipments: S.shipments, carriers: C.carriers, rate_table: R.rate_table },
      blockers,
      windows,
      engineCarriers: C.carriers,
      summary: {
        orders_requested: opts.orderIds.length || orders.length,
        orders_not_found: notFound,
        orders_loaded: orders.length,
        preflight: { eligible: pre.eligible.length, excluded: pre.excluded.length, by_rule: pre.counts },
        shipments: { mapped: S.shipments.length, skipped: S.skipped.length, by_reason: countReasons(S.skipped) },
        carriers: { mapped: C.carriers.length, of: carriers.length, by_reason: countReasons(C.skipped) },
        rate_table: { mapped: R.rate_table.length, of: rates.length, by_reason: countReasons(R.skipped) },
        volume_estimated_ids: S.meta.estimated,
        density_lb_per_cuft: opts.density || null,
        hint: volumeHint,
      },
      detail: {
        excluded: pre.excluded,
        skipped_shipments: S.skipped,
        skipped_carriers: C.skipped,
      },
    };
  }

  /**
   * Run one planning task end to end.
   *
   * status:
   *   'dry_run'  payload built, engine not called (payload included)
   *   'blocked'  readiness gate failed, engine not called
   *   'ok'       engine answered; for consolidate, groups re-validated
   */
  async function plan(rawOpts = {}, tenantConfig = null) {
    const opts = normaliseOptions(rawOpts);
    const { key: engineName, e: engine } = pickEngine(opts.engine);
    const built = await buildPayload(opts, tenantConfig);
    const base = { task: opts.task, engine: engineName, summary: built.summary, detail: built.detail, writes: 'none — proposal only' };

    if (built.blockers.length) {
      return { ...base, status: 'blocked', blockers: built.blockers };
    }
    if (opts.dryRun) {
      return { ...base, status: 'dry_run', payload: built.payload };
    }

    // Second argument is ignored by the Otodus client; the Zoree engine
    // uses it for service windows, reproducibility and QUBO export.
    const ctx = {
      windows: built.windows,
      seed: opts.seed,
      exportQubo: opts.exportQubo,
      sampler: opts.sampler,
      dwaveParams: opts.dwaveTimeLimit ? { time_limit: opts.dwaveTimeLimit } : undefined,
      optimalityGap: opts.optimalityGap || undefined,
    };
    const t0 = Date.now();
    const result = opts.task === 'rates'
      ? await engine.optimizeRates(built.payload, ctx)
      : await engine.optimizeConsolidate(built.payload, ctx);
    const elapsed_ms = Date.now() - t0;

    if (opts.task === 'rates') {
      // The engine has no capacity or service-level enforcement on this
      // path either; its answer is returned untouched and labelled so.
      return { ...base, status: 'ok', elapsed_ms, validated: false, engine_result: result };
    }

    // Re-validated regardless of engine. The Zoree engine already prices
    // and checks every load exactly, so infeasible should be empty — if it
    // ever is not, that is a bug surfaced here rather than a plan shipped.
    const v = mapper.validateConsolidation(result, built.engineCarriers);
    const out = {
      ...base,
      status: 'ok',
      elapsed_ms,
      validated: true,
      totals: v.totals,
      feasible: v.feasible,
      infeasible: v.infeasible,
    };
    if (engineName === 'zoree') {
      out.unconsolidated = result.unconsolidated;
      out.unpriced = result.unpriced;
      out.benchmark = result.benchmark;
      out.solver = result.solver;
      if (result.qubos) out.qubos = result.qubos;
    }
    return out;
  }

  async function engineStatus(key) {
    const e = engines[key];
    const configured = key === 'otodus'
      ? { url: e.baseUrl || null, api_key_set: Boolean(process.env.QUANTUM_ENGINE_API_KEY) }
      : { url: e.baseUrl || 'in-process', api_key_set: null };
    try {
      return { reachable: true, configured, health: await e.checkHealth() };
    } catch (err) {
      return { reachable: false, configured, error: err.message };
    }
  }

  /**
   * Is the default engine configured and answering? Never throws.
   * Top-level fields describe the default engine (unchanged shape for the
   * UI); `engines` lists every configured engine.
   */
  async function status({ dwave = false } = {}) {
    const all = {};
    for (const key of Object.keys(engines)) all[key] = await engineStatus(key);
    // D-Wave readiness spawns Python and lists solvers (no solver time
    // used), so it only runs when asked: GET /api/quantum/status?dwave=1
    if (dwave && engines.zoree && typeof engines.zoree.checkDwave === 'function' && all.zoree) {
      all.zoree.dwave = await engines.zoree.checkDwave();
    }
    return { ...all[defaultEngine], engine: defaultEngine, engines: all };
  }

  return { plan, buildPayload, status };
}

function defaultInstance() {
  return createQuantumPlanning({
    dbSelect: require('./supabase').dbSelect,
    zipGeo: require('./zipGeo'),
    mapper: require('./quantumEngineMapper'),
    preflightOrders: require('./quantumPreflight').preflightOrders,
    engine: require('./quantumEngine'),
    localEngine: require('./quantumLocal'),
    defaultEngine: process.env.QUANTUM_ENGINE_MODE || 'zoree',
  });
}

let _instance = null;
function instance() { return (_instance = _instance || defaultInstance()); }

module.exports = {
  createQuantumPlanning,
  plan: (opts, tenantConfig) => instance().plan(opts, tenantConfig),
  buildPayload: (opts, tenantConfig) => instance().buildPayload(normaliseOptions(opts), tenantConfig),
  status: (o) => instance().status(o),
  TASKS,
  ENGINES,
  SAMPLERS,
  _internals: { normaliseOptions, buildMilesByOrderId, buildCapsByCarrierId, countReasons },
};
