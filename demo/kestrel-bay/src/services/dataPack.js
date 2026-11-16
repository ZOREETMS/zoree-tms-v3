'use strict';
// Loads the TMS and contract extracts and checks them before anyone trusts them.
const fs = require('fs');
const path = require('path');
const config = require('../config');

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8'));

function load() {
  const policy = readJson('policy.json');
  const contracts = readJson('contracts.json');
  const shipments = readJson('shipments.json');
  return { policy, contracts, shipments, checks: intakeChecks({ policy, contracts, shipments }) };
}

function intakeChecks({ policy, contracts, shipments }) {
  const findings = [];
  const added = shipments.filter((s) => s.addedForDemo).map((s) => s.id);
  if (added.length) findings.push({ level: 'info', detail: `Added to your sample for this demo: ${added.join(', ')} — to show a phone-scanned invoice and one whose total does not add up.` });
  findings.push({ level: 'info', detail: `TMS extract: ${shipments.length} shipments. Contract file: ${contracts.length} lanes across ${new Set(contracts.map((c) => c.carrier)).size} carriers.` });
  for (const s of shipments) {
    const lane = contracts.find((c) => c.carrier === s.carrier && c.origin === s.origin && c.destination === s.destination);
    if (!lane) findings.push({ level: 'warn', detail: `${s.id}: no contract rate for ${s.carrier} ${s.origin} → ${s.destination}.` });
  }
  const notDelivered = shipments.filter((s) => s.status !== 'Delivered');
  if (notDelivered.length) findings.push({ level: 'warn', detail: `Not delivered in TMS: ${notDelivered.map((s) => `${s.id} (${s.status})`).join(', ')} — any invoice for these is held.` });
  const withExtras = shipments.filter((s) => s.approvedExtras.length);
  if (withExtras.length) findings.push({ level: 'info', detail: `Approved extras on file: ${withExtras.map((s) => `${s.id} ${s.approvedExtras.map((a) => `${a.type} up to ${a.maxHours} hrs at $${a.ratePerHour}/hr`).join(', ')}`).join('; ')}.` });
  findings.push({ level: 'info', detail: `AP rules loaded: contract rate, fuel as % of base, extras need TMS approval, never pay twice, disputes and anything over $${policy.apRules.personReviewOver.toLocaleString()} go to a person.` });
  return findings;
}

module.exports = { load };
