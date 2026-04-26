/**
 * Jest config for the Zoree TMS mobile app.
 *
 * Scope (current): pure-logic tests — service layer, utils, shared
 * helpers. These run under a Node environment because they don't
 * import any React Native modules.
 *
 * Component / screen tests (which would pull in RN, navigation, and
 * reanimated) are intentionally not configured here yet — adding them
 * requires a `jest-expo` preset and per-file mocks. Service-first
 * coverage is the priority while we close web/mobile parity gaps.
 */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(test|spec).(ts|tsx|js|jsx)',
    '<rootDir>/src/**/*.(test|spec).(ts|tsx|js|jsx)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Reset mocks between tests so individual cases never leak state.
  clearMocks: true,
};
