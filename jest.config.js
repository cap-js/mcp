const config = {
  testTimeout: 120000,
  testMatch: ['**/tests/**/*.test.js'],
  moduleFileExtensions: ['js'],
  collectCoverageFrom: ['lib/**', 'cds-plugin.js'],
  coverageReporters: ['json'],
  silent: true,
  detectOpenHandles: true,
};
module.exports = config;
