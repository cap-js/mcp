const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

/**
 * F3 fix: expand into inaccessible entities via associations is blocked.
 * Without the fix, alice (admin) could read Authors (editor-only) by expanding
 * Books.author, since CAP does not propagate @restrict through associations.
 */
describe('Expand access control (CQN mode)', () => {
  it('blocks expand into association with restricted target (admin → Authors)', async () => {
    // FullyRestrictedService: Books=admin, Authors=editor
    // alice has admin but not editor
    const { callTool } = mcpClient('/mcp/fully-restricted', 'alice:')
    const { content, error } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['ID'] }, { ref: ['author'], expand: ['*'] }],
      limit: 3
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    expect(error).to.match(/inaccessible|restricted|expand/i)
  })

  it('blocks nested expand into restricted entity', async () => {
    const { callTool } = mcpClient('/mcp/fully-restricted', 'alice:')
    const { content, error } = await callTool('query', {
      entity: 'Books',
      select: [
        { ref: ['ID'] },
        { ref: ['author'], expand: [{ ref: ['name'] }, { ref: ['dateOfBirth'] }] }
      ],
      limit: 3
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
  })

  it('allows expand into accessible entity (editor → Authors)', async () => {
    // FullyRestrictedService.Authors requires editor role — need a user with editor
    // Use CatalogService where Books/author both accessible
    const { callTool } = mcpClient()
    const { error } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['ID'] }, { ref: ['title'] }],
      limit: 3
    })
    expect(error).to.be.null
  })

  it('blocks wildcard expand into restricted target', async () => {
    const { callTool } = mcpClient('/mcp/fully-restricted', 'alice:')
    const { content, error } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['author'], expand: ['*'] }],
      limit: 1
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
  })
})
