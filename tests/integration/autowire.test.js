const { readFileSync } = require('node:fs')
const { runInNewContext } = require('node:vm')
const { EventEmitter } = require('node:events')
const source = readFileSync(require.resolve('../../cds-plugin'), 'utf8')

describe('MCP client autowiring test exclusion', () => {
  const run = ({ nodeEnv = 'development', profiles = ['development'], it } = {}) => {
    const cds = new EventEmitter()
    cds.debug = () => undefined
    cds.env = { mcp: { autowire: true }, profiles }
    cds.service = { providers: [{ name: 'CatalogService', endpoints: [{ kind: 'mcp' }] }] }
    const exportAll = vi.fn()
    runInNewContext(source, {
      global: { it },
      process: { env: { NODE_ENV: nodeEnv } },
      require: (id) => {
        if (id === '@sap/cds') return cds
        if (id === './lib/api') return { registerCompileTargets() {} }
        if (id === './lib/clients') return { exportAll }
        throw new Error(`Unexpected module: ${id}`)
      }
    })
    cds.emit('listening', { url: 'http://localhost:4004' })
    return { cds, exportAll }
  }

  it.each([
    ['NODE_ENV', { nodeEnv: 'test' }],
    ['profile', { profiles: ['development', 'test'] }],
    ['runner', { it: () => {} }]
  ])('does not export client configs in tests detected by %s', (_name, settings) => {
    const { cds, exportAll } = run(settings)
    expect(exportAll).not.toHaveBeenCalled()
    expect(cds.listeners('shutdown')).toHaveLength(0)
  })

  it('continues to export client configs in development', () => {
    const { cds, exportAll } = run()
    expect(exportAll).toHaveBeenCalledWith(cds.service.providers, 'http://localhost:4004')
  })
})
