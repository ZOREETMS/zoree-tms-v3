// ═══════════════════════════════════════════════════════════════════
// Simulated Quantum-Inspired Annealer — api/services/quantumLocal/annealer.js
// ─────────────────────────────────────────────────────────────────────
// Solves a Qubo (./qubo.js) by simulated annealing: the classical
// counterpart of a quantum annealer, and the same algorithm D-Wave ships
// as its reference sampler (dwave-samplers / "neal"). Same input, same
// output contract (best sample + energy over N reads), so swapping in real
// hardware changes the sampler, not the model.
//
// Algorithm (Metropolis, single-bit flips):
//   • Keep a local field f_i = h_i + Σ_j Q_ij x_j for every variable, so the
//     energy change of flipping i is O(1):  ΔE = (1 − 2x_i) · f_i.
//   • Sweep all variables in order; accept a flip if ΔE ≤ 0, else with
//     probability exp(−β·ΔE). β rises geometrically from β_hot to β_cold.
//   • β range is derived from the problem's own coefficient scale (as neal
//     does): hot enough to accept the largest single-flip uphill move half
//     the time, cold enough to reject the smallest one 99% of the time.
//   • Repeat for `reads` independent starts; keep the lowest energy.
//
// Deterministic: a seeded PRNG (mulberry32) means the same batch + seed
// always produces the same plan, which matters for audit and for tests.
// ═══════════════════════════════════════════════════════════════════

'use strict';

/** Small, fast, seedable PRNG. Returns floats in [0, 1). */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Default β range from the coefficient magnitudes (neal-style). */
function betaRange(adj) {
  const n = adj.h.length;
  let maxField = 0;
  let minAbs = Infinity;
  for (let i = 0; i < n; i++) {
    let s = Math.abs(adj.h[i]);
    if (adj.h[i] !== 0) minAbs = Math.min(minAbs, Math.abs(adj.h[i]));
    for (let p = adj.start[i]; p < adj.start[i + 1]; p++) {
      const a = Math.abs(adj.w[p]);
      s += a;
      if (a > 0) minAbs = Math.min(minAbs, a);
    }
    maxField = Math.max(maxField, s);
  }
  if (!(maxField > 0)) return [0.1, 1];
  if (!Number.isFinite(minAbs)) minAbs = maxField;
  const hot = Math.log(2) / maxField;   // P(accept worst move) = 0.5
  const cold = Math.log(100) / minAbs;  // P(accept smallest move) = 0.01
  return [hot, Math.max(cold, hot * 10)];
}

/**
 * @param {import('./qubo').Qubo} qubo
 * @param {object} [opts]
 * @param {number} [opts.reads=16]      independent restarts
 * @param {number} [opts.sweeps=1000]   full passes over the variables per read
 * @param {number} [opts.seed=1]
 * @param {[number,number]} [opts.beta] override the β schedule end points
 * @param {number} [opts.timeLimitMs]   stop starting new reads after this
 * @param {Uint8Array} [opts.initial]   warm start for the first read
 * @returns {{sample:Uint8Array, energy:number, reads:number, sweeps:number, beta:[number,number], energies:number[]}}
 */
function anneal(qubo, opts = {}) {
  const reads = Math.max(1, opts.reads ?? 16);
  const sweeps = Math.max(1, opts.sweeps ?? 1000);
  const rand = mulberry32(opts.seed ?? 1);
  const adj = qubo.adjacency();
  const n = adj.h.length;
  const [b0, b1] = opts.beta || betaRange(adj);
  const t0 = Date.now();

  if (n === 0) {
    return { sample: new Uint8Array(0), energy: qubo.offset, reads: 0, sweeps, beta: [b0, b1], energies: [] };
  }

  const ratio = sweeps > 1 ? Math.pow(b1 / b0, 1 / (sweeps - 1)) : 1;
  const x = new Uint8Array(n);
  const f = new Float64Array(n);
  let best = null;
  let bestE = Infinity;
  const energies = [];
  let done = 0;

  for (let r = 0; r < reads; r++) {
    if (r > 0 && opts.timeLimitMs && Date.now() - t0 > opts.timeLimitMs) break;

    // Initial state: warm start on read 0 if given, otherwise random.
    for (let i = 0; i < n; i++) x[i] = r === 0 && opts.initial ? opts.initial[i] : (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      let s = adj.h[i];
      for (let p = adj.start[i]; p < adj.start[i + 1]; p++) if (x[adj.nbr[p]]) s += adj.w[p];
      f[i] = s;
    }

    let e = qubo.energy(x);
    let readBest = e;
    let readBestX = x.slice();
    let beta = b0;

    for (let s = 0; s < sweeps; s++) {
      for (let i = 0; i < n; i++) {
        const dE = x[i] ? -f[i] : f[i];
        if (dE <= 0 || rand() < Math.exp(-beta * dE)) {
          const delta = x[i] ? -1 : 1;
          x[i] ^= 1;
          e += dE;
          for (let p = adj.start[i]; p < adj.start[i + 1]; p++) f[adj.nbr[p]] += delta * adj.w[p];
        }
      }
      if (e < readBest - 1e-9) { readBest = e; readBestX = x.slice(); }
      beta *= ratio;
    }

    // Recompute exactly — the running total accumulates float error.
    const exact = qubo.energy(readBestX);
    energies.push(exact);
    if (exact < bestE) { bestE = exact; best = readBestX; }
    done++;
  }

  return { sample: best, energy: bestE, reads: done, sweeps, beta: [b0, b1], energies };
}

module.exports = { anneal, mulberry32, _internals: { betaRange } };
