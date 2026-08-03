import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 120000,
    include: ['**/tests/**/*.test.js'],
    silent: true,
    setupFiles: ['./tests/setup.js'],
    coverage: {
      include: ['lib/**', 'cds-plugin.js'],
      reporter: ['json']
    }
  }
})
