'use strict';
const express = require('express');
const runStore = require('../services/runStore');
const apExport = require('../services/apExport');

const router = express.Router();

function rows() {
  const job = runStore.getJob();
  return job && job.status === 'done' ? apExport.readyToPostRows(job.results, runStore.getDecisions()) : null;
}

router.get('/ready-to-post.csv', (req, res) => {
  const r = rows();
  if (!r) return res.status(409).send('Finish a run first');
  runStore.log('export.ready_to_post', { rows: r.length });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kestrel-bay-ready-to-post.csv"');
  res.send(apExport.toCsv(r));
});

router.get('/ready-to-post.json', (req, res) => {
  const r = rows();
  if (!r) return res.status(409).json({ error: 'Finish a run first' });
  res.json(r);
});

module.exports = router;
