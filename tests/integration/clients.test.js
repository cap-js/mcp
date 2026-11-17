const cds = require('@sap/cds')
const os = require('os')
const { fs, path } = cds.utils

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
  cds.env.protocols.mcp.clients.testClient = testClient
})

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test

describe('Custom MCP Client Registration', () => {
  let home
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-clients-'))
    vi.spyOn(os, 'homedir').mockReturnValue(home)
  })
  afterAll(() => {
    vi.restoreAllMocks()
    fs.rmSync(home, { recursive: true, force: true })
  })

  describe('export()', () => {
    it('is not called automatically in tests, but can be exercised explicitly', async () => {
      await test
      expect(exportCalls.length).to.equal(0)
      const services = cds.service.providers.filter((srv) =>
        srv.endpoints.some((ep) => ep.kind === 'mcp')
      )
      await require('../../lib/clients').exportAll(services, test.url)
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

      await cds.shutdown()

      expect(purgeCalls.length).to.equal(1)

      expect(purgeCalls[0].services).to.include('CatalogService')
      expect(purgeCalls[0].services).to.include('AdminService')
    })
  })
})
