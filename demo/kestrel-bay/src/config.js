'use strict';
// Loads .env from this folder; falls back to the main Zoree api/.env for the
// Anthropic key so the demo runs on the laptop with zero extra setup.
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.ANTHROPIC_API_KEY) {
  const fallback = path.join(__dirname, '..', '..', '..', 'api', '.env');
  if (fs.existsSync(fallback)) {
    const parsed = dotenv.parse(fs.readFileSync(fallback));
    if (parsed.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = parsed.ANTHROPIC_API_KEY;
  }
}

module.exports = {
  port: Number(process.env.PORT) || 4310,
  agentMode: (process.env.AGENT_MODE || 'shadow').toLowerCase(), // shadow | assist
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    timeoutMs: 30000,
  },
  dataDir: path.join(__dirname, 'data'),
};
