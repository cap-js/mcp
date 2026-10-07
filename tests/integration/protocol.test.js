const cds = require('@sap/cds')

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

// Requests dispatched by the MCP adapter are tagged with `protocol: 'mcp'`,
// mirroring the OData/REST/GraphQL adapters, so handlers can tell an inbound
// MCP call apart from an internal programmatic service call.
describe('Request protocol tagging', () => {
  it('tags the call/action path with protocol: mcp', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('call', { action: 'whoami' })
    expect(error).to.be.null
    expect(content.result).to.equal('mcp')
  })

  it('tags the query path with protocol: mcp', async () => {
    const { callTool } = mcpClient()
    const { error } = await callTool('query', { cql: 'SELECT ID, title from Books' })
    expect(error).to.be.null
    expect(cds.services.CatalogService.lastReadProtocol).to.equal('mcp')
  })
})
