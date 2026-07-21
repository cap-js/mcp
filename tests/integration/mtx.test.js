const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop-mtx')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('MTX', () => {
  it('should not have toggled tools for default user', async () => {
    const { mcp } = mcpClient('/mcp/mcp')
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map((t) => t.name)
    expect(toolNames).to.include('myAction')
    expect(toolNames).not.to.include('myToggledAction')
    expect(toolNames).not.to.include('DummyEntity')
    // Draft tools for toggled entity should not appear
    expect(toolNames).not.to.include('create-toggled-books')
    expect(toolNames).not.to.include('activate-toggled-books')
  })
  it('should have toggled tools for user with feature toggle enabled', async () => {
    const { mcp } = mcpClient('/mcp/mcp', 'fred')
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map((t) => t.name)
    expect(toolNames).to.include('myAction')
    expect(toolNames).to.include('myToggledAction')
  })
  it('should have draft tools for toggled entity when feature toggle enabled', async () => {
    const { mcp } = mcpClient('/mcp/mcp', 'fred')
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map((t) => t.name)
    expect(toolNames).to.include('create-toggled-books')
    expect(toolNames).to.include('activate-toggled-books')
    expect(toolNames).to.include('update-toggled-books')
    expect(toolNames).to.include('discard-toggled-books')
  })
  it('should resolve drafts entity for toggled entity via model', async () => {
    const { callTool } = mcpClient('/mcp/mcp', 'fred')
    // Calling create dispatches NEW on the .drafts entity — no error means entity resolved correctly
    const created = await callTool('create-toggled-books', {
      title: 'Toggled Draft',
      isbn: '1234567890123'
    })
    expect(created.error).to.be.null
  })
})
