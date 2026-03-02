/**
 * Jest setup file to make ESM-only @toon-format/toon available via require()
 */

let mockToonModule

// Load the ESM module before all tests
beforeAll(async () => {
  mockToonModule = await import('@toon-format/toon')
})

// Mock @toon-format/toon to return the dynamically imported module
jest.mock('@toon-format/toon', () => {
  return new Proxy({}, {
    get(target, prop) {
      if (!mockToonModule) {
        throw new Error('@toon-format/toon not yet loaded - ensure beforeAll has run')
      }
      return mockToonModule[prop]
    }
  })
})
