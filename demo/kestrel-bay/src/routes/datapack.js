'use strict';
const express = require('express');
const dataPack = require('../services/dataPack');

const router = express.Router();

// GET /api/datapack — TMS + contract extracts, AP/IT rules, and intake checks
router.get('/', (req, res) => {
  const pack = dataPack.load();
  res.json({ policy: pack.policy, contracts: pack.contracts, shipments: pack.shipments, checks: pack.checks });
});

module.exports = router;
