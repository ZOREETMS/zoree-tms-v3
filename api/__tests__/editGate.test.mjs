// QA #147 / QA #148 / QA #149 — useEditGate's runtime decisions are
// driven by two pure helpers (buildEditProps, runIfCanEdit) so we can
// unit-test them without React.
//
// Run with: node --test api/__tests__/editGate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEditProps, runIfCanEdit } from '../../frontend/src/hooks/editGateHelpers.js';

// ── buildEditProps ─────────────────────────────────────────────────

test('buildEditProps returns extra unchanged when canEdit is true', () => {
  const out = buildEditProps(true, { onClick: () => {}, className: 'btn' });
  assert.equal(out.disabled, undefined);
  assert.equal(out.title, undefined);
  assert.equal(out.className, 'btn');
  assert.equal(typeof out.onClick, 'function');
});

test('buildEditProps forces disabled + tooltip when canEdit is false', () => {
  const out = buildEditProps(false, { onClick: () => {} });
  assert.equal(out.disabled, true);
  assert.equal(out['aria-disabled'], true);
  assert.match(out.title, /Read-only/);
});

test('buildEditProps preserves an explicit title from the caller', () => {
  const out = buildEditProps(false, { title: 'Custom reason' });
  assert.equal(out.disabled, true);
  assert.equal(out.title, 'Custom reason');
});

test('buildEditProps tolerates being called without an extra arg', () => {
  const a = buildEditProps(true);
  assert.deepEqual(a, {});
  const b = buildEditProps(false);
  assert.equal(b.disabled, true);
  assert.match(b.title, /Read-only/);
});

// ── runIfCanEdit ────────────────────────────────────────────────────

test('runIfCanEdit invokes fn and returns its value when canEdit is true', () => {
  let called = 0;
  const result = runIfCanEdit(true, () => { called++; return 42; });
  assert.equal(called, 1);
  assert.equal(result, 42);
});

test('runIfCanEdit short-circuits when canEdit is false', () => {
  let called = 0;
  const result = runIfCanEdit(false, () => { called++; return 'x'; });
  assert.equal(called, 0);
  assert.equal(result, undefined);
});

test('runIfCanEdit tolerates non-function arguments', () => {
  assert.equal(runIfCanEdit(true, null), undefined);
  assert.equal(runIfCanEdit(true, undefined), undefined);
  assert.equal(runIfCanEdit(false, () => 'x'), undefined);
});
