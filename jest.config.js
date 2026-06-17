const config = {
  testTimeout: 120000,
  testMatch: ['**/tests/**/*.test.js'],
  moduleFileExtensions: ['js'],
  collectCoverageFrom: ['lib/**', 'cds-plugin.js'],
  coverageReporters: ['json'],
  silent: true,
  detectOpenHandles: true,
  // Pre-load ESM modules for require() compatibility
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
}
module.exports = config
