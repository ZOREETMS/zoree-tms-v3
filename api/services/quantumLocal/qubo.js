// ═══════════════════════════════════════════════════════════════════
// QUBO model — api/services/quantumLocal/qubo.js
// ─────────────────────────────────────────────────────────────────────
// A Quadratic Unconstrained Binary Optimization problem:
//
//     minimise  E(x) = offset + Σ_i h_i x_i + Σ_{i<j} Q_ij x_i x_j,   x ∈ {0,1}^n
//
// This is the native input format of quantum annealers (D-Wave) and of
// QAOA on gate-based machines, and it is what quantumLocal/annealer.js
// solves classically. Keeping the model separate from the solver is the
// point: the same QUBO can go to the in-process annealer today and to
// D-Wave Leap (scripts/quantum/solve_bqm_dwave.py) without re-deriving it.
//
// Variables are registered by string label so a solution can be decoded
// without knowing the index layout ("x|<shipmentId>|<slot>", "z|<slot>|w|3").
// Storage is sparse: consolidation QUBOs are mostly zeros.
// ═══════════════════════════════════════════════════════════════════

'use strict';

class Qubo {
  constructor() {
    this.labels = [];            // index → label
    this.index = new Map();      // label → index
    this.linear = [];            // index → h_i
    this.quad = new Map();       // "i,j" (i<j) → Q_ij
    this.offset = 0;
  }

  /** Index for a label, registering it on first use. */
  v(label) {
    let i = this.index.get(label);
    if (i === undefined) {
      i = this.labels.length;
      this.labels.push(label);
      this.index.set(label, i);
      this.linear.push(0);
    }
    return i;
  }

  get size() { return this.labels.length; }

  addLinear(i, w) {
    if (w) this.linear[i] += w;
  }

  addQuadratic(i, j, w) {
    if (!w) return;
    if (i === j) { this.linear[i] += w; return; } // x² = x for binaries
    const k = i < j ? `${i},${j}` : `${j},${i}`;
    this.quad.set(k, (this.quad.get(k) || 0) + w);
  }

  addOffset(w) { this.offset += w; }

  /**
   * Add  weight · (Σ_k c_k x_k + constant)²  — the workhorse for equality
   * constraints. Expands to linear, quadratic and offset terms.
   * @param {Array<[number, number]>} terms  [varIndex, coefficient]
   */
  addSquaredLinear(terms, constant, weight) {
    if (!weight) return;
    for (let a = 0; a < terms.length; a++) {
      const [i, ci] = terms[a];
      // (c_i x_i)² = c_i² x_i ; cross term with the constant: 2 c_i K x_i
      this.addLinear(i, weight * (ci * ci + 2 * ci * constant));
      for (let b = a + 1; b < terms.length; b++) {
        const [j, cj] = terms[b];
        this.addQuadratic(i, j, weight * 2 * ci * cj);
      }
    }
    this.addOffset(weight * constant * constant);
  }

  /** Energy of a full assignment (Uint8Array or number[] of 0/1). */
  energy(x) {
    let e = this.offset;
    for (let i = 0; i < this.linear.length; i++) if (x[i]) e += this.linear[i];
    for (const [k, w] of this.quad) {
      const c = k.indexOf(',');
      if (x[+k.slice(0, c)] && x[+k.slice(c + 1)]) e += w;
    }
    return e;
  }

  /**
   * Compressed adjacency for the solver: for each variable, the list of
   * neighbours and their coupling. Built once per solve.
   */
  adjacency() {
    const n = this.size;
    const deg = new Uint32Array(n);
    for (const k of this.quad.keys()) {
      const c = k.indexOf(',');
      deg[+k.slice(0, c)]++; deg[+k.slice(c + 1)]++;
    }
    const start = new Uint32Array(n + 1);
    for (let i = 0; i < n; i++) start[i + 1] = start[i] + deg[i];
    const nbr = new Uint32Array(start[n]);
    const w = new Float64Array(start[n]);
    const fill = start.slice(0, n);
    for (const [k, q] of this.quad) {
      const c = k.indexOf(',');
      const i = +k.slice(0, c), j = +k.slice(c + 1);
      nbr[fill[i]] = j; w[fill[i]++] = q;
      nbr[fill[j]] = i; w[fill[j]++] = q;
    }
    return { start, nbr, w, h: Float64Array.from(this.linear) };
  }

  /**
   * Serialise as a binary quadratic model that dimod can load directly:
   *   dimod.BinaryQuadraticModel(linear, quadratic, offset, 'BINARY')
   * Quadratic keys are "labelA||labelB" because JSON has no tuple keys;
   * the Python bridge splits them back.
   */
  toBqm() {
    const linear = {};
    this.labels.forEach((l, i) => { linear[l] = this.linear[i]; });
    const quadratic = {};
    for (const [k, w] of this.quad) {
      const c = k.indexOf(',');
      quadratic[`${this.labels[+k.slice(0, c)]}||${this.labels[+k.slice(c + 1)]}`] = w;
    }
    return { vartype: 'BINARY', linear, quadratic, offset: this.offset };
  }
}

module.exports = { Qubo };
