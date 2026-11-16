// ═══════════════════════════════════════════════════════════════════
// Exact set-packing solver — api/services/quantumLocal/exact.js
// ─────────────────────────────────────────────────────────────────────
// The yardstick for every other sampler. Given the candidate loads
// (columns) of one bucket, find the combination with the highest total
// savings in which no shipment rides twice:
//
//   maximise  Σ_c S_c · z_c    subject to  Σ_{c ∋ i} z_c ≤ 1  for every shipment i
//
// This is the same problem the set-packing QUBO encodes, solved to proven
// optimality by depth-first branch and bound:
//
//   • Branch on the undecided shipment with the fewest still-usable
//     columns: either one of those columns carries it, or it stays out of
//     every new load. Each packing is reached exactly once.
//   • Bound: the smaller of two valid upper bounds on what the undecided
//     shipments can still add —
//       (a) each shipment's best savings-per-shipment over usable columns;
//       (b) the Lagrangian bound Σ_j u_j + Σ_c max(0, S_c − Σ_{j∈c} u_j),
//           with shipment prices u ≥ 0 tuned once at the root by
//           subgradient descent (it bounds the LP relaxation for any u).
//     If the current savings plus the bound cannot beat the best plan
//     found so far, the subtree is skipped.
//   • The incumbent starts from a known plan (the greedy plan), so pruning
//     is strong from the first node.
//
// "Proven optimal" means optimal OVER THE CANDIDATE POOL that
// consolidation.js generated (pairs, beam-grown larger loads, the greedy
// plan's loads). A load that was never generated cannot be chosen; the
// exact polish step that follows can still find such loads. That is why
// the response says "pool optimum", not "global optimum".
//
// Limits (time, nodes) keep it safe on unusually large buckets: when hit,
// the best plan found is returned with proven = false.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const EPS = 1e-9;

/**
 * @param {Array<{ids:string[], savings:number}>} columns
 * @param {object} [opts]
 * @param {number[]} [opts.incumbent]   column indices of a known valid plan
 * @param {number} [opts.timeLimitMs=2000]
 * @param {number} [opts.nodeLimit=2e6]
 * @returns {{chosen:number[], savings:number, proven:boolean, nodes:number, ms:number}}
 */
function solvePacking(columns, opts = {}) {
  const t0 = Date.now();
  const timeLimitMs = opts.timeLimitMs ?? 2000;
  const nodeLimit = opts.nodeLimit ?? 2e6;

  // Index shipments; drop columns that cannot help (non-positive savings).
  const shipIdx = new Map();
  const cols = [];
  columns.forEach((c, k) => {
    if (!(c.savings > EPS) || !c.ids.length) return;
    const members = [...new Set(c.ids)].map((id) => {
      if (!shipIdx.has(id)) shipIdx.set(id, shipIdx.size);
      return shipIdx.get(id);
    });
    cols.push({ k, members, savings: c.savings, ratio: c.savings / members.length });
  });
  const U = shipIdx.size;
  const shipCols = Array.from({ length: U }, () => []);
  cols.forEach((c, ci) => c.members.forEach((j) => shipCols[j].push(ci)));
  for (const list of shipCols) list.sort((a, b) => cols[b].savings - cols[a].savings);

  // Incumbent from the given plan, if it is a valid packing of known columns.
  let bestVal = 0;
  let bestSet = [];
  if (Array.isArray(opts.incumbent) && opts.incumbent.length) {
    const pos = new Map(cols.map((c, ci) => [c.k, ci]));
    const used = new Set();
    let ok = true;
    let val = 0;
    const set = [];
    for (const k of opts.incumbent) {
      const ci = pos.get(k);
      if (ci === undefined) continue;
      if (cols[ci].members.some((j) => used.has(j))) { ok = false; break; }
      cols[ci].members.forEach((j) => used.add(j));
      val += cols[ci].savings;
      set.push(ci);
    }
    if (ok) { bestVal = val; bestSet = set; }
  }

  const u = rootPrices(cols, U, Math.max(bestVal, greedyValue(cols, U)));

  const decided = new Uint8Array(U);
  const best = new Float64Array(U);
  const usable = new Uint32Array(U);
  const stack = [];
  let nodes = 0;
  let aborted = false;

  const compatible = (ci) => cols[ci].members.every((j) => !decided[j]);

  function dfs(value) {
    if (aborted) return;
    if (++nodes > nodeLimit || ((nodes & 1023) === 0 && Date.now() - t0 > timeLimitMs)) { aborted = true; return; }

    // Bound + branching shipment in one pass over the usable columns.
    best.fill(0);
    usable.fill(0);
    let lagr = 0;
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      if (!compatible(ci)) continue;
      let reduced = c.savings;
      for (const j of c.members) {
        usable[j]++;
        if (c.ratio > best[j]) best[j] = c.ratio;
        reduced -= u[j];
      }
      if (reduced > 0) lagr += reduced;
    }
    let ratioBound = 0;
    let pick = -1;
    for (let j = 0; j < U; j++) {
      if (decided[j] || usable[j] === 0) continue;
      ratioBound += best[j];
      lagr += u[j];
      if (pick < 0 || usable[j] < usable[pick]) pick = j;
    }
    const bound = value + Math.min(ratioBound, lagr);
    if (value > bestVal + EPS) { bestVal = value; bestSet = stack.slice(); }
    if (pick < 0 || bound <= bestVal + EPS) return;

    // Branch 1..m: a usable column carries `pick` (best savings first).
    for (const ci of shipCols[pick]) {
      if (!compatible(ci)) continue;
      const m = cols[ci].members;
      m.forEach((j) => { decided[j] = 1; });
      stack.push(ci);
      dfs(value + cols[ci].savings);
      stack.pop();
      m.forEach((j) => { decided[j] = 0; });
      if (aborted) return;
    }
    // Last branch: `pick` joins no new load.
    decided[pick] = 1;
    dfs(value);
    decided[pick] = 0;
  }

  dfs(0);
  return {
    chosen: bestSet.map((ci) => cols[ci].k).sort((a, b) => a - b),
    savings: bestVal,
    proven: !aborted,
    nodes,
    ms: Date.now() - t0,
  };
}

/** Greedy packing value (best savings first) — a target for the root prices. */
function greedyValue(cols, U) {
  const used = new Uint8Array(U);
  let v = 0;
  for (const c of [...cols].sort((a, b) => b.savings - a.savings)) {
    if (c.members.some((j) => used[j])) continue;
    c.members.forEach((j) => { used[j] = 1; });
    v += c.savings;
  }
  return v;
}

/**
 * Shipment prices u ≥ 0 minimising the Lagrangian bound
 *   L(u) = Σ_j u_j + Σ_c max(0, S_c − Σ_{j∈c} u_j)
 * by projected subgradient with Polyak steps toward a known plan value.
 * Any u gives a valid bound; better u only prunes more.
 */
function rootPrices(cols, U, target, iterations = 300) {
  const u = new Float64Array(U);
  for (const c of cols) for (const j of c.members) u[j] = Math.max(u[j], c.ratio);
  const bestU = u.slice();
  let bestL = Infinity;
  let lambda = 1;
  const g = new Float64Array(U);
  for (let it = 0; it < iterations; it++) {
    g.fill(1);
    let L = 0;
    for (let j = 0; j < U; j++) L += u[j];
    for (const c of cols) {
      let r = c.savings;
      for (const j of c.members) r -= u[j];
      if (r > 0) { L += r; for (const j of c.members) g[j] -= 1; }
    }
    if (L < bestL - 1e-9) { bestL = L; bestU.set(u); } else if (it % 20 === 19) lambda /= 2;
    let norm = 0;
    for (let j = 0; j < U; j++) norm += g[j] * g[j];
    if (norm === 0 || L - target < 1e-6) break;
    const step = (lambda * (L - target)) / norm;
    for (let j = 0; j < U; j++) u[j] = Math.max(0, u[j] - step * g[j]);
  }
  return bestU;
}

module.exports = { solvePacking, _internals: { rootPrices, greedyValue } };
