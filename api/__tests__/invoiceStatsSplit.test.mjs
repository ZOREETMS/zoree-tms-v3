// Overbilling vs extras awaiting approval, on the Kestrel Bay data pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../../frontend/src/services/invoiceService.js';

const inv = (num, status, amount, agreed, extrasBilled = 0) => ({ num, status, amount, agreed: agreed ?? 0, agreedKnown: agreed != null, extrasBilled });
const KB = [
  inv('RF-88213', 'Approved', 510.88, 510.88),
  inv('RF-88219', 'Approved', 510.88, 510.88),
  inv('PE-0931', 'Approved', 442.64, 442.64, 150),     // approved detention is part of agreed
  inv('BW-5521', 'On Hold', 1561.6, 1439.6),           // base + fuel over contract
  inv('RF-88214', 'On Hold', 595.88, 510.88, 85),      // liftgate with no approval
  inv('BW-5527', 'On Hold', 1439.6, null),             // shipment not in the TMS
  inv('RF-88230', 'On Hold', 510.88, 510.88),          // cancelled shipment, amounts match
];

test('overbilling is $122 on 1 invoice; the $85 liftgate is an extra awaiting approval', () => {
  const s = computeStats(KB);
  assert.equal(s.overbilledAmt, 122);
  assert.equal(s.overbilledCount, 1);
  assert.equal(s.extrasAwaitingAmt, 85);
  assert.equal(s.extrasAwaitingCount, 1);
});

test('an invoice with no shipment is never counted as overbilled', () => {
  const s = computeStats([inv('BW-5527', 'On Hold', 1439.6, null)]);
  assert.equal(s.overbilledAmt, 0);
  assert.equal(s.extrasAwaitingAmt, 0);
});
