'use strict';
// Kestrel Bay carrier-invoice agent — local demo server. Bootstrap only;
// all logic lives in src/services and src/routes.
const path = require('path');
const express = require('express');
const config = require('./src/config');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/inbox', express.static(path.join(__dirname, 'inbox'))); // original PDFs, for side-by-side review

app.use('/api/datapack', require('./src/routes/datapack'));
app.get('/api/inbox', (req, res) => res.json(require('./src/services/agentPipeline').listInbox()));
app.use('/api/audit', require('./src/routes/audit'));
app.use('/api/decisions', require('./src/routes/decisions'));
app.use('/api/export', require('./src/routes/export'));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: config.agentMode, explainer: config.anthropic.apiKey ? config.anthropic.model : 'rules-only' }));

const server = app.listen(config.port, () => {
  if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
    require('child_process').exec(`start "" http://localhost:${config.port}`);
  }
  console.log(`Kestrel Bay invoice agent → http://localhost:${config.port}  (mode: ${config.agentMode}, explainer: ${config.anthropic.apiKey ? config.anthropic.model : 'rules-only'})`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use — the demo may already be running. Open http://localhost:${config.port} or close the other window.`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
});
