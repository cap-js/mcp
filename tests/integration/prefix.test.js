const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.prefix = true

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Tool Name Prefix (global prefix: true)', () => {
  let callTool, mcp, initialize

  beforeAll(() => {
    const client = mcpClient()
    callTool = client.callTool
    mcp = client.mcp
    initialize = client.initialize
  })

  it('tool names are prefixed with slugified service name', async () => {
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map((t) => t.name)
    expect(toolNames).to.include('catalog_query')
    expect(toolNames).to.include('catalog_describe')
    expect(toolNames).to.include('catalog_call_action')
    expect(toolNames).to.not.include('query')
    expect(toolNames).to.not.include('describe')
    expect(toolNames).to.not.include('call_action')
  })

  it('prefixed tools are callable', async () => {
    const { content, error } = await callTool('catalog_describe', {})
    expect(error).to.be.null
    expect(content.service).to.equal('CatalogService')
  })

  it.skip('prefixed query tool works', async () => {
    const { content, error } = await callTool('catalog_query', { entity: 'Books' })
    expect(error).to.be.null
    expect(content.entity).to.equal('Books')
    expect(content.data).to.be.an('array')
  })

  it('prefixed call_action tool works', async () => {
    const { content, error } = await callTool('catalog_call_action', {
      action: 'sum',
      parameters: { x: 3, y: 4 }
    })
    expect(error).to.be.null
    expect(content.result).to.equal(7)
  })

  it('default instructions reference prefixed tool names', async () => {
    const { initialize: limitInit } = mcpClient('/mcp/limit', 'alice:')
    const response = await limitInit()
    expect(response.result.instructions).to.include('limit_describe')
    expect(response.result.instructions).to.include('limit_query')
  })

  it('custom @mcp.instructions are not modified by prefix', async () => {
    const response = await initialize()
    expect(response.result.instructions).to.equal(
      'Use describe to explore available books, genres, and actions. Use query to search the catalog. Use call_action to place orders or perform calculations.'
    )
  })
})
