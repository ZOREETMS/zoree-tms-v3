const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../shared');

const config = {
  watchFolders: [sharedRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(projectRoot, '..', 'node_modules'),
    ],
    extraNodeModules: {
      '@zoree/shared': sharedRoot,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
