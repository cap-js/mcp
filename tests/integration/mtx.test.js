const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop-mtx')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('MTX', () => {
  it('should not have toggled tools for default user', async () => {
    const { mcp } = mcpClient("/mcp/mcp")
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.include('myAction')
    expect(toolNames).not.to.include('myToggledAction')
    expect(toolNames).not.to.include('DummyEntity')
  })
  it('should have toggled tools for user with feature toggle enabled', async () => {
    const { mcp } = mcpClient("/mcp/mcp", "fred")
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.include('myAction')
    expect(toolNames).to.include('myToggledAction')
  })
})
