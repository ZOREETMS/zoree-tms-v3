// Which client domain an inbound email belongs to.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { addressMap, resolve, addressFor } = require('../services/emailIntake/domainRouting');

const MAP = addressMap('KESTREL_BAY=Sridhar+KestrelBay@zoree.io, acme = ap+acme@zoree.io ,bad,=x@y.z,BAD CODE!=a@b.c');

test('addressMap parses pairs, lower-cases addresses, drops bad entries', () => {
  assert.deepEqual([...MAP], [['sridhar+kestrelbay@zoree.io', 'KESTREL_BAY'], ['ap+acme@zoree.io', 'ACME']]);
  assert.equal(addressMap('').size, 0);
});

test('an email addressed to a domain address is routed to that domain', () => {
  assert.equal(resolve({ toAddresses: ['someone@x.com', 'SRIDHAR+kestrelbay@zoree.io'] }, MAP), 'KESTREL_BAY');
  assert.equal(resolve({ toAddresses: ['ap+acme@zoree.io'] }, MAP), 'ACME');
});

test('anything else goes to the default domain', () => {
  assert.equal(resolve({ toAddresses: ['sridhar@zoree.io'] }, MAP), 'ZOREE');
  assert.equal(resolve({ toAddresses: [] }, MAP), 'ZOREE');
  assert.equal(resolve({}, MAP), 'ZOREE');
});

test('addressFor returns the routing address of a domain', () => {
  assert.equal(addressFor('KESTREL_BAY', MAP), 'sridhar+kestrelbay@zoree.io');
  assert.equal(addressFor('ZOREE', MAP), null);
});

test('addressFor prefers the address that lands in the mailbox being read', () => {
  const m = addressMap('KB=ap+kb@zoree.io,KB=ap@zoree.io,KB=sridhar+kb@zoree.io');
  assert.equal(addressFor('KB', m, 'sridhar@zoree.io'), 'sridhar+kb@zoree.io');
  assert.equal(addressFor('KB', m, 'AP@zoree.io'), 'ap+kb@zoree.io');
  assert.equal(addressFor('KB', m, 'other@zoree.io'), 'ap+kb@zoree.io');
});
