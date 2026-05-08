// QA #154 — Mobile and web INCOTERMS lists must stay in lock-step with
// the OMS HTML's Book Order dropdown. Drifting lists were the original
// bug: a Mobile user could pick 'EXW' that the web flow could never
// produce on the same order.
//
// This test compares all three sources by reading them as text — that
// way we don't pull a React or Expo runtime into Node, and the test
// trips on any future change to one source without the other.
//
// Run with: node --test api/__tests__/incotermsParity.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { INCOTERMS as WEB_INCOTERMS, DEFAULT_INCOTERM } from '../../frontend/src/constants/incoterms.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// QA #154: the canonical list is the 4-option set the OMS HTML ships.
const CANONICAL = ['FOB Origin', 'FOB Destination', 'CIF', 'DDP'];

test('web INCOTERMS exports the canonical 4-option list in canonical order', () => {
  assert.deepEqual([...WEB_INCOTERMS], CANONICAL);
});

test('DEFAULT_INCOTERM is one of the listed options', () => {
  assert.ok(WEB_INCOTERMS.includes(DEFAULT_INCOTERM));
  assert.equal(DEFAULT_INCOTERM, 'FOB Origin');
});

test('mobile INCOTERMS constant matches the web list 1:1', () => {
  // Read mobile constants as text so this test doesn't need to spin up
  // the React Native bundler. We extract the exported array literal.
  const src = readFileSync(
    path.join(REPO, 'mobile', 'src', 'shared', 'constants', 'orderConstants.js'),
    'utf8',
  );
  // Match the entire `export const INCOTERMS = [ ... ];` declaration.
  const m = src.match(/export\s+const\s+INCOTERMS\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'mobile orderConstants.js must export INCOTERMS');
  const items = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^['"`]|['"`]$/g, ''));
  assert.deepEqual(items, CANONICAL);
});

test('OMS HTML Book Order dropdown carries the same 4 options', () => {
  // Sanity-check the legacy OMS app since it was the original source of
  // truth for the canonical list.
  const html = readFileSync(
    path.join(REPO, 'frontend', 'zoree-oms.html'),
    'utf8',
  );
  for (const opt of CANONICAL) {
    assert.ok(
      html.includes(`<option>${opt}</option>`),
      `zoree-oms.html must include <option>${opt}</option> in the Incoterms dropdown`,
    );
  }
});
