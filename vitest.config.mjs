export default {
  test: {
    globals: true,
    testTimeout: 120000,
    include: ['**/tests/**/*.test.js'],
    silent: true,
    setupFiles: ['./tests/setup.js'],
    sequence: {
      hooks: 'list'
    }
  }
}
