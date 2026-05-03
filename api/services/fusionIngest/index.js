// ═══════════════════════════════════════════════════════════════════
// Fusion Ingest Service — barrel module.
//
// Re-exports the per-object ingest entry points so the route layer can
// import a single, stable surface:
//
//   const fusion = require('../services/fusionIngest');
//   await fusion.orders.ingestSalesOrder(body);
//   await fusion.inventory.ingestTransactions(body);
//   await fusion.masterData.ingestItems(body);
//
// Keep this file thin — Rule 6 (no big inline blocks). Real logic lives
// in the per-object modules below.
// ═══════════════════════════════════════════════════════════════════

const orders     = require('./orders');
const inventory  = require('./inventory');
const masterData = require('./masterData');
const eventLog   = require('./eventLog');

module.exports = { orders, inventory, masterData, eventLog };
