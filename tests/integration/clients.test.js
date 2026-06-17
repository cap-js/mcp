const cds = require('@sap/cds')

const exportCalls = []
const purgeCalls = []

const testClient = {
  export(services, url) {
    exportCalls.push({ services: services.map((s) => s.name), url })
  },
  purge(services) {
    purgeCalls.push({ services: services.map((s) => s.name) })
  }
}

// fires after plugins are loaded but before server starts
cds.on('bootstrap', () => {
  // Remove 'test' profile so client config export runs for this test
  const profiles = cds.env.profiles
  const idx = profiles.indexOf('test')
  if (idx !== -1) profiles.splice(idx, 1)

  cds.env.protocols.mcp.clients.testClient = testClient
})

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const { executePerActionTool } = require('../../lib/tools')

describe('Custom MCP Client Registration', () => {
  describe('export()', () => {
    it('is called when server starts', async () => {
      await test
      expect(exportCalls.length).to.equal(1)
    })

    it('receives MCP services with correct names', async () => {
      await test
      expect(exportCalls[0].services).to.include('CatalogService')
      expect(exportCalls[0].services).to.include('AdminService')
    })

    it('receives the server URL', async () => {
      await test
      expect(exportCalls[0].url).to.match(/http:\/\/localhost:\d+/)
    })
  })

  describe('purge()', () => {
    it('is called once on shutdown with correct services', async () => {
      await test

      cds.emit('shutdown')

      expect(purgeCalls.length).to.equal(1)

      expect(purgeCalls[0].services).to.include('CatalogService')
      expect(purgeCalls[0].services).to.include('AdminService')
    })
  })

  describe('custom log option (consumer reuse)', () => {
    it('routes execute* logs through a caller-supplied logger', async () => {
      // Mirrors how @cap-js/a2a reuses execute* with its own cds.log('a2a')
      // instance so tool-call logs surface under [a2a] instead of [mcp].
      await test

      const calls = []
      const log = (...args) => calls.push({ method: 'info', args })
      log.info = (...args) => calls.push({ method: 'info', args })
      log.debug = (...args) => calls.push({ method: 'debug', args })
      log.warn = (...args) => calls.push({ method: 'warn', args })
      log.error = (...args) => calls.push({ method: 'error', args })

      const srv = await cds.connect.to('CatalogService')
      const action = srv.operations?.sum || srv.definition?.actions?.sum

      const result = await executePerActionTool(srv, 'sum', action, { x: 2, y: 3 }, { log })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.result).to.equal(5)

      const tags = calls.map((c) => c.args[0])
      expect(tags).to.include('sum')
    })
  })
})
