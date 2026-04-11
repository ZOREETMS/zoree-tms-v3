const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

// Monorepo: pick up changes in workspace `shared/` (if linked), without watching the Node API app.
const monorepoRoot = path.resolve(projectRoot, '..');
const sharedRoot = path.join(monorepoRoot, 'shared');
config.watchFolders = [
  ...new Set([...(config.watchFolders || []), sharedRoot]),
];

// Never bundle the Express API (Node-only: fs, path, etc.). If this throws, something imported the backend.
const origResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const normalized = String(moduleName || '').replace(/\\/g, '/');
  if (
    normalized === 'zoree-tms-api' ||
    normalized.endsWith('/api/server') ||
    normalized.endsWith('/api/server.js') ||
    /(^|\/)api\/server(\.js)?$/.test(normalized)
  ) {
    throw new Error(
      '[Zoree TMS] The mobile app cannot import the Node backend (api/server.js). Use HTTP via src/lib/api.ts only. Run Expo from the mobile folder: cd mobile && npx expo start.',
    );
  }
  if (origResolveRequest) {
    return origResolveRequest(context, moduleName, platform);
  }
  return require('metro-resolver').resolve(context, moduleName, platform);
};

module.exports = config;
