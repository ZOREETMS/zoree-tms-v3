// ═══════════════════════════════════════════════════════════════════
// Simulated Bifurcation sampler — api/services/quantumLocal/bifurcation.js
// ─────────────────────────────────────────────────────────────────────
// Quantum-inspired solver for a Qubo (./qubo.js), after Toshiba's
// Simulated Bifurcation algorithm (Goto et al., Science Advances 2019;
// Goto, Endo, Suzuki et al., Science Advances 2021) — the algorithm behind
// Toshiba's commercial SQBM+ product.
//
// Where it comes from: a network of Kerr-nonlinear parametric oscillators
// (a proposed quantum annealing machine) goes through a bifurcation as its
// pump rises; each oscillator settles into one of two branches, and the
// branch pattern encodes a low-energy Ising state. SB simulates the
// classical equations of motion of that system:
//
//   ẏ_i = −(a0 − a(t)) · x_i − c0 · Σ_j J_ij φ(x_j)
//   ẋ_i =  a0 · y_i
//   |x_i| > 1  →  x_i = sign(x_i), y_i = 0        (inelastic walls)
//
// a(t) ramps 0 → a0. φ(x) = x is ballistic SB (bSB, fast); φ(x) = sign(x)
// is discrete SB (dSB, more accurate). Every oscillator moves at once, so
// the method is a smooth, parallel search rather than one bit flip at a
// time like simulated annealing (annealer.js).
//
// Mapping: x_i ∈ {0,1} ↔ s_i = 2x_i − 1. Linear terms become couplings to
// one auxiliary spin s_0 (the standard homogenisation), so the dynamics
// only see a pure coupling matrix; the answer is read as s_i · s_0.
//
// Run as many independent agents (random starts) as asked, keep the
// lowest QUBO energy. A final single-flip descent puts each agent's
// answer in a local minimum (same post-step Toshiba and dwave-samplers
// apply). Seeded PRNG: same QUBO + seed → same answer.
//
// Same output contract as annealer.js, so consolidation.js treats the two
// as interchangeable samplers.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { mulberry32 } = require('./annealer');

const MODES = Object.freeze(['discrete', 'ballistic']);

/**
 * Ising couplings with the auxiliary spin at index 0, in CSR form.
 * QUBO  E = c + Σ h_i x_i + Σ_{i<j} Q_ij x_i x_j,  x = (1 + s) / 2  gives
 *   J_ij = Q_ij / 4,   b_i = h_i / 2 + Σ_j Q_ij / 4   (field on spin i)
 * and b_i becomes the coupling between spin i+1 and auxiliary spin 0.
 */
function isingCsr(adj) {
  const n = adj.h.length;
  const N = n + 1;
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = adj.h[i] / 2;
    for (let p = adj.start[i]; p < adj.start[i + 1]; p++) s += adj.w[p] / 4;
    b[i] = s;
  }
  const deg = new Uint32Array(N);
  for (let i = 0; i < n; i++) {
    deg[i + 1] = adj.start[i + 1] - adj.start[i] + (b[i] !== 0 ? 1 : 0);
    if (b[i] !== 0) deg[0]++;
  }
  const start = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
  const nbr = new Uint32Array(start[N]);
  const w = new Float64Array(start[N]);
  const fill = start.slice(0, N);
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0) {
      nbr[fill[0]] = i + 1; w[fill[0]++] = b[i];
      nbr[fill[i + 1]] = 0; w[fill[i + 1]++] = b[i];
    }
    for (let p = adj.start[i]; p < adj.start[i + 1]; p++) {
      nbr[fill[i + 1]] = adj.nbr[p] + 1;
      w[fill[i + 1]++] = adj.w[p] / 4;
    }
  }
  return { N, start, nbr, w };
}

/** c0 per Goto et al.: 0.5 · sqrt(N − 1) / sqrt(Σ_{i≠j} J_ij²). */
function couplingScale(J) {
  let ss = 0;
  for (let p = 0; p < J.w.length; p++) ss += J.w[p] * J.w[p];
  return ss > 0 ? (0.5 * Math.sqrt(Math.max(1, J.N - 1))) / Math.sqrt(ss) : 1;
}

/** Single-flip descent to a local minimum (first improvement). */
function descend(x, adj) {
  const n = adj.h.length;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = adj.h[i];
    for (let p = adj.start[i]; p < adj.start[i + 1]; p++) if (x[adj.nbr[p]]) s += adj.w[p];
    f[i] = s;
  }
  let flipped = true;
  let guard = 0;
  while (flipped && guard++ < 100 * (n + 1)) {
    flipped = false;
    for (let i = 0; i < n; i++) {
      const dE = x[i] ? -f[i] : f[i];
      if (dE < -1e-12) {
        const d = x[i] ? -1 : 1;
        x[i] ^= 1;
        for (let p = adj.start[i]; p < adj.start[i + 1]; p++) f[adj.nbr[p]] += d * adj.w[p];
        flipped = true;
      }
    }
  }
  return x;
}

/**
 * @param {import('./qubo').Qubo} qubo
 * @param {object} [opts]
 * @param {number} [opts.agents=32]        independent oscillator networks
 * @param {number} [opts.steps=1500]       integration steps per agent
 * @param {number} [opts.dt=0.5]           time step
 * @param {'discrete'|'ballistic'} [opts.mode='discrete']
 * @param {number} [opts.seed=1]
 * @param {number} [opts.timeLimitMs]      stop integrating after this (answers are still read)
 * @param {boolean} [opts.descent=true]    finish each agent with single-flip descent
 * @param {number} [opts.c0Scale=1]        multiplier on the coupling scale c0
 * @param {boolean} [opts.earlyStop=true]  stop once no agent's spins change for
 *                                         `stableChecks` checks, 50 steps apart
 * @returns {{sample:Uint8Array, energy:number, agents:number, steps:number, mode:string, energies:number[]}}
 */
function bifurcate(qubo, opts = {}) {
  const agents = Math.max(1, Math.floor(opts.agents ?? 32));
  const steps = Math.max(1, Math.floor(opts.steps ?? 1000));
  const earlyStop = opts.earlyStop !== false;
  const stableChecks = Math.max(1, Math.floor(opts.stableChecks ?? 6));
  const dt = opts.dt ?? 0.5;
  const mode = opts.mode || 'discrete';
  if (!MODES.includes(mode)) throw new Error(`bifurcation mode must be one of ${MODES.join(', ')}`);
  const discrete = mode === 'discrete';
  const descent = opts.descent !== false;
  const rand = mulberry32(opts.seed ?? 1);
  const adj = qubo.adjacency();
  const n = adj.h.length;
  const t0 = Date.now();

  if (n === 0) return { sample: new Uint8Array(0), energy: qubo.offset, agents: 0, steps: 0, mode, energies: [] };

  const J = isingCsr(adj);
  const N = J.N;
  const a0 = 1;
  const c0 = couplingScale(J) * (opts.c0Scale ?? 1);
  const x = new Float64Array(agents * N);
  const y = new Float64Array(agents * N);
  for (let k = 0; k < x.length; k++) { x[k] = (rand() - 0.5) * 0.2; y[k] = (rand() - 0.5) * 0.2; }
  const phi = new Float64Array(N);
  const lastSigns = new Uint8Array(agents * N);
  let stable = 0;

  let done = 0;
  for (let t = 0; t < steps; t++) {
    if (opts.timeLimitMs && (t & 63) === 0 && t > 0 && Date.now() - t0 > opts.timeLimitMs) break;
    const pump = a0 - (a0 * t) / steps; // a0 − a(t)
    for (let a = 0; a < agents; a++) {
      const o = a * N;
      if (discrete) for (let i = 0; i < N; i++) phi[i] = x[o + i] > 0 ? 1 : x[o + i] < 0 ? -1 : 0;
      else for (let i = 0; i < N; i++) phi[i] = x[o + i];
      for (let i = 0; i < N; i++) {
        let g = 0;
        for (let p = J.start[i]; p < J.start[i + 1]; p++) g += J.w[p] * phi[J.nbr[p]];
        let yi = y[o + i] + dt * (-pump * x[o + i] - c0 * g);
        let xi = x[o + i] + dt * a0 * yi;
        if (xi > 1) { xi = 1; yi = 0; } else if (xi < -1) { xi = -1; yi = 0; }
        x[o + i] = xi; y[o + i] = yi;
      }
    }
    done = t + 1;
    if (earlyStop && done % 50 === 0 && done > steps / 2) {
      let changed = false;
      for (let k = 0; k < x.length; k++) {
        const sg = x[k] >= 0 ? 1 : 0;
        if (sg !== lastSigns[k]) { changed = true; lastSigns[k] = sg; }
      }
      stable = changed ? 0 : stable + 1;
      if (stable >= stableChecks) break;
    }
  }

  let best = null;
  let bestE = Infinity;
  const energies = [];
  for (let a = 0; a < agents; a++) {
    const o = a * N;
    const s0 = x[o] >= 0 ? 1 : -1;
    const bits = new Uint8Array(n);
    for (let i = 0; i < n; i++) bits[i] = (x[o + i + 1] >= 0 ? 1 : -1) * s0 > 0 ? 1 : 0;
    if (descent) descend(bits, adj);
    const e = qubo.energy(bits);
    energies.push(e);
    if (e < bestE) { bestE = e; best = bits; }
  }
  return { sample: best, energy: bestE, agents, steps: done, mode, energies };
}

module.exports = { bifurcate, MODES, _internals: { isingCsr, couplingScale, descend } };
