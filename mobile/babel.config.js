module.exports = function (api) {
  // Cache key is the current NODE_ENV — so the test-vs-runtime branch
  // below stays correct when babel re-evaluates the config.
  api.cache.using(() => process.env.NODE_ENV);
  const isTest = process.env.NODE_ENV === 'test';
  return {
    presets: ['babel-preset-expo'],
    // The reanimated plugin is required by the React Native runtime,
    // but it expects a worklet runtime that Jest's Node environment
    // doesn't provide. Skip it in tests so service-layer specs run
    // without pulling in the RN runtime stack.
    plugins: isTest ? [] : ['react-native-reanimated/plugin'],
  };
};
