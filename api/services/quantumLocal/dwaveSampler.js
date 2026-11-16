// ═══════════════════════════════════════════════════════════════════
// D-Wave sampler bridge — api/services/quantumLocal/dwaveSampler.js
// ─────────────────────────────────────────────────────────────────────
// Sends a Qubo to D-Wave (Leap hybrid solver or the annealing QPU) through
// scripts/quantum/dwave_sampler.py, which uses D-Wave's own Ocean SDK.
//
// Why a Python sidecar and not a Node HTTP client: the hybrid solver
// takes problems as uploaded dimod-serialised files, and the QPU needs
// minor-embedding onto the chip's topology (minorminer). Both live in
// Ocean; re-implementing them in Node would be large and untestable
// without paid solver time. The sidecar is one process per call, JSON
// in / JSON out, and it is the only place that knows about Ocean.
//
// Config (api/.env):
//   DWAVE_API_TOKEN   Leap project API token (paid plan or LaunchPad
//                     trial — self sign-up trial accounts get no token)
//   DWAVE_PYTHON      python executable with dwave-ocean-sdk installed
//                     (default: "python" on Windows, "python3" elsewhere)
//   DWAVE_TIMEOUT_MS  per-call timeout, default 300000
//
// Errors carry .status: 503 when D-Wave is not configured (no Python,
// no Ocean, no token), 502 when D-Wave answered with a failure.
// ═══════════════════════════════════════════════════════════════════

'use strict';

const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'quantum', 'dwave_sampler.py');
const SAMPLERS = Object.freeze({ 'dwave-hybrid': 'hybrid', 'dwave-qpu': 'qpu', 'dwave-sa': 'sa' });

function pythonExe() {
  return process.env.DWAVE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function run(args, input, timeoutMs, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonExe(), [SCRIPT, ...args], { env: process.env, windowsHide: true });
    } catch (err) {
      reject(Object.assign(new Error(`D-Wave sidecar could not start (${pythonExe()}): ${err.message}`), { status: 503 }));
      return;
    }
    let out = '';
    let errText = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error(`D-Wave call timed out after ${timeoutMs} ms`), { status: 504 }));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`D-Wave sidecar could not start (${pythonExe()}): ${err.message}. Install Python and run: pip install dwave-ocean-sdk`), { status: 503 }));
    });
    child.on('close', () => {
      clearTimeout(timer);
      let parsed;
      try { parsed = JSON.parse(out); } catch {
        reject(Object.assign(new Error(`D-Wave sidecar returned no JSON: ${(errText || out).slice(-400)}`), { status: 502 }));
        return;
      }
      if (parsed.error && !raw) {
        const status = parsed.kind === 'config' ? 503 : parsed.kind === 'input' ? 400 : 502;
        reject(Object.assign(new Error(`D-Wave ${parsed.kind} error: ${parsed.error}`), { status, kind: parsed.kind }));
        return;
      }
      resolve(parsed);
    });
    if (input !== undefined) child.stdin.end(JSON.stringify(input));
    else child.stdin.end();
  });
}

/**
 * Sample one BQM on D-Wave.
 * @param {{linear:object, quadratic:object, offset:number}} bqm  Qubo#toBqm()
 * @param {'dwave-hybrid'|'dwave-qpu'|'dwave-sa'} which
 * @param {{time_limit?:number, num_reads?:number, solver?:string, seed?:number}} [params]
 * @returns {Promise<{sample:Object<string,number>, energy:number, solver:string, problem_id:string|null, timing:object}>}
 */
function sample(bqm, which, params = {}, label = 'Zoree consolidation') {
  const sampler = SAMPLERS[which];
  if (!sampler) return Promise.reject(Object.assign(new Error(`unknown D-Wave sampler ${which}`), { status: 400 }));
  const timeout = Number(process.env.DWAVE_TIMEOUT_MS) || 300000;
  return run([], { sampler, bqm, params, label }, timeout);
}

/** Readiness without spending solver time. Never throws. */
async function check() {
  try {
    return await run(['--check'], undefined, 60000, { raw: true });
  } catch (err) {
    return { ocean: null, token_set: Boolean(process.env.DWAVE_API_TOKEN), token_valid: null, error: err.message };
  }
}

module.exports = { sample, check, SAMPLERS, _internals: { SCRIPT, pythonExe } };
