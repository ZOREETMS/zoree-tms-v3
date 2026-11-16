// ═══════════════════════════════════════════════════════════════════
// Jev question builders — the three System One primitives as the raw
// JSON shapes POST /v1/systemone expects.
//
//   choice → one option from a named set   (answer: choice, probabilities, confidence)
//   noul   → yes/no as a probability 0..1   (answer: noul)
//   score  → position on an ordered rubric  (answer: score, probabilities, confidence)
//
// Kept separate from the HTTP client so callers build questions without
// knowing the wire format, and so the shapes are unit-testable.
// ═══════════════════════════════════════════════════════════════════

'use strict';

function choice(instructions, criteria) {
  return { type: 'choice', instructions, criteria };
}

// criteria is optional: { true: '…', false: '…' } sharpens what yes/no mean.
function noul(instructions, criteria) {
  const q = { type: 'noul', instructions };
  if (criteria) q.criteria = criteria;
  return q;
}

// levels: 2–10 descriptions, lowest first (index 0 = lowest).
function score(instructions, levels) {
  return { type: 'score', instructions, criteria: levels };
}

module.exports = { choice, noul, score };
