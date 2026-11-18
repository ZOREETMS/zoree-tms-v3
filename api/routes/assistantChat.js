// /api/assistant/* — the in-app chat assistant. Signed-in users only.
//   GET  /status   { configured }
//   POST /chat     { system, messages:[{role,content}] } → { text }
'use strict';

const express = require('express');
const assistant = require('../services/ai/assistantChat');

function createAssistantRouter({ verifyToken }) {
  const router = express.Router();
  router.get('/status', async (req, res) => {
    if (!(await verifyToken(req, res))) return;
    res.json({ configured: assistant.isConfigured() });
  });
  router.post('/chat', async (req, res) => {
    if (!(await verifyToken(req, res))) return;
    try {
      res.json(await assistant.chat({ system: req.body && req.body.system, messages: req.body && req.body.messages }));
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createAssistantRouter };
