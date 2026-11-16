// ZoreeTMS MCP server — entry point. See README.md for setup.
const path = require('path');

// Load zoree-mcp/.env when present (Node 20.12+ built-in; no dotenv needed).
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env — use real env */ }

const { loadConfig } = require('./config');
const { createApp } = require('./app');

const config = loadConfig();
createApp(config).listen(config.port, () => {
  console.log(`[zoree-mcp] listening on :${config.port}`);
  console.log(`[zoree-mcp] MCP endpoint ${config.publicUrl}${config.mcpPath} → API ${config.apiUrl}`);
});
