// Regression tests for QA #135 — Item Master save error
// "DB update failed (400) – Could not find the 'desc' column in the
// schema cache".
//
// The form posted `desc` as the column key but the items table has
// `description`. The fix centralises the payload shape in
// itemMasterPayload.js, which writes `description` and never `desc`.
//
// 2026-05-11 follow-up: the same bug class affected several other
// keys — the payload was writing `item_class`, `fclass`, `len`, `wid`,
// `hgt` while the DB columns are `class`, `freight_class`, `length`,
// `width`, `height`. The test below was previously pinning the WRONG
// names, so it passed while live saves failed with PGRST204. New
// assertions verify the payload uses the real DB column names.
//
// Run with: node --test api/__tests__/itemMasterPayload.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(
  __dirname,
  '../../frontend/src/services/itemMasterPayload.js',
);
const mod = await import(pathToFileURL(modPath).href);
const {
  buildItemRow,
  buildPackagingRow,
  readItemDescription,
  readPkgDescription,
} = mod;

const sampleItemForm = {
  id: 'sku-001',
  description: 'Network Switch',
  customer: 'Cisco',
  class: 'Electronics',
  nmfc: '70150',
  freight_class: '85',
  weight_unit: '12.5',
  value_unit: '850',
  len: '24', wid: '18', hgt: '6',
  units_per_pallet: '20',
  pkg: 'Carton',
  stack: '4',
  hazmat: false, fragile: true, temp_ctrl: false, top_load: true,
  un: '', haz_class: '',
  status: 'Active',
};

test('QA #135 — buildItemRow writes `description` and never `desc`', () => {
  const row = buildItemRow(sampleItemForm);
  assert.equal(row.description, 'NETWORK SWITCH');
  assert.equal('desc' in row, false, 'row must NOT carry a `desc` key');
});

test('buildItemRow uppercases id / description / customer / nmfc', () => {
  const row = buildItemRow(sampleItemForm);
  assert.equal(row.id,          'SKU-001');
  assert.equal(row.description, 'NETWORK SWITCH');
  assert.equal(row.customer,    'CISCO');
  assert.equal(row.nmfc,        '70150');
});

test('buildItemRow coerces numeric strings → numbers', () => {
  const row = buildItemRow(sampleItemForm);
  assert.equal(typeof row.weight_unit,      'number');
  assert.equal(row.weight_unit,             12.5);
  assert.equal(typeof row.value_unit,       'number');
  assert.equal(row.value_unit,              850);
  assert.equal(typeof row.length,           'number');
  assert.equal(row.length,                  24);
  assert.equal(typeof row.width,            'number');
  assert.equal(row.width,                   18);
  assert.equal(typeof row.height,           'number');
  assert.equal(row.height,                  6);
  assert.equal(typeof row.units_per_pallet, 'number');
  assert.equal(row.units_per_pallet,        20);
  assert.equal(typeof row.stack,            'number');
  assert.equal(row.stack,                   4);
});

test('buildItemRow defaults sensible fallbacks when form is sparse', () => {
  const row = buildItemRow({ id: 'A', description: 'X' });
  assert.equal(row.class,            'General');
  assert.equal(row.freight_class,    '70');
  assert.equal(row.pkg,              'Carton');
  assert.equal(row.stack,            1);
  assert.equal(row.units_per_pallet, 1);
  assert.equal(row.status,           'Active');
  assert.equal(row.weight_unit,      0);
});

test('buildItemRow writes the actual items table column names (PGRST204 guard)', () => {
  // Live items table columns (verified via information_schema 2026-05-11):
  // class, freight_class, length, width, height — NOT item_class,
  // fclass, len, wid, hgt. Any drift here surfaces as
  // "Could not find the 'X' column of 'items' in the schema cache".
  const row = buildItemRow(sampleItemForm);
  const keys = Object.keys(row);
  for (const col of ['class', 'freight_class', 'length', 'width', 'height',
                     'stack', 'un', 'haz_class']) {
    assert.ok(keys.includes(col), `row MUST carry the '${col}' key`);
  }
  for (const bad of ['item_class', 'fclass', 'len', 'wid', 'hgt']) {
    assert.ok(!keys.includes(bad), `row MUST NOT carry the legacy '${bad}' key`);
  }
});

test('buildItemRow coerces handling flags to booleans', () => {
  const row = buildItemRow({
    id: 'A', description: 'X',
    hazmat: 'truthy', fragile: 0, temp_ctrl: '', top_load: 1,
  });
  assert.equal(row.hazmat,    true);
  assert.equal(row.fragile,   false);
  assert.equal(row.temp_ctrl, false);
  assert.equal(row.top_load,  true);
});

test('QA #135 — buildPackagingRow writes `description` and never `desc`', () => {
  const row = buildPackagingRow({
    id: 'CTN-001',
    description: 'Standard Carton',
    type: 'Carton',
  });
  assert.equal(row.description, 'STANDARD CARTON');
  assert.equal('desc' in row, false, 'row must NOT carry a `desc` key');
});

test('buildPackagingRow accepts legacy `desc` form field as a fallback', () => {
  const row = buildPackagingRow({
    id: 'CTN-002',
    desc: 'Legacy Carton',
    type: 'Carton',
  });
  assert.equal(row.description, 'LEGACY CARTON');
  assert.equal('desc' in row, false);
});

test('readItemDescription tolerates rows that still have `desc`', () => {
  assert.equal(readItemDescription({ description: 'New Style' }), 'New Style');
  assert.equal(readItemDescription({ desc: 'Old Style' }),        'Old Style');
  assert.equal(
    readItemDescription({ description: 'New Style', desc: 'Old Style' }),
    'New Style',
    'description wins over desc',
  );
  assert.equal(readItemDescription({}),    '');
  assert.equal(readItemDescription(null),  '');
  assert.equal(readItemDescription(),      '');
});

test('readPkgDescription same fallback logic for packaging_units', () => {
  assert.equal(readPkgDescription({ description: 'Carton A' }), 'Carton A');
  assert.equal(readPkgDescription({ desc: 'Carton B' }),        'Carton B');
  assert.equal(readPkgDescription({}),                          '');
});

test('No `desc:` key appears in the items column set (regression guard)', () => {
  const keys = Object.keys(buildItemRow(sampleItemForm));
  assert.ok(keys.includes('description'), 'must write description');
  assert.ok(!keys.includes('desc'),       'must NOT write desc');
});

test('No `desc:` key appears in the packaging_units column set (regression guard)', () => {
  const keys = Object.keys(buildPackagingRow({
    id: 'X', description: 'Y',
  }));
  assert.ok(keys.includes('description'));
  assert.ok(!keys.includes('desc'));
});
