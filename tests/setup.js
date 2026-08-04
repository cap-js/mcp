/**
 * Vitest setup file to make ESM-only @toon-format/toon available via require()
 *
 * The library under test calls `require('@toon-format/toon')`, but toon is an
 * ESM-only module. Vitest can resolve ESM natively, so we mock the module with
 * an async factory that imports the real ESM module and returns its namespace.
 */

import { vi } from 'vitest'

vi.mock('@toon-format/toon', async () => {
  const actual = await vi.importActual('@toon-format/toon')
  return { ...actual, default: actual.default ?? actual }
})
