const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

// F1/F2 fix verification + CQN function allowlist
describe('CQN function allowlist (unified with SQL mode)', () => {
  it('blocks CURRENT_USER in select (rejected at Zod schema)', async () => {
    const { callTool } = mcpClient()
    const { error, content } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['ID'] }, { func: 'CURRENT_USER' }],
      limit: 1
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    // Zod enum rejects non-allowlisted funcs; also unified validator would catch
    expect(error).to.match(/invalid|not allowed/i)
  })

  it('blocks SESSION_USER in where (rejected at Zod schema)', async () => {
    const { callTool } = mcpClient()
    const { error, content } = await callTool('query', {
      entity: 'Books',
      where: [{ func: 'SESSION_USER' }, '=', { val: 'x' }],
      limit: 1
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
  })

  it('blocks CURRENT_SCHEMA pseudo-column in select', async () => {
    const { callTool } = mcpClient()
    const { error, content } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['CURRENT_SCHEMA'] }],
      limit: 1
    })
    expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
  })

  it('allows COUNT aggregate', async () => {
    const { callTool } = mcpClient()
    const { error } = await callTool('query', {
      entity: 'Books',
      select: [{ func: 'count', args: ['*'], as: 'cnt' }]
    })
    expect(error).to.be.null
  })

  it('allows LOWER in select', async () => {
    const { callTool } = mcpClient()
    const { error } = await callTool('query', {
      entity: 'Books',
      select: [{ ref: ['ID'] }, { func: 'lower', args: [{ ref: ['title'] }], as: 't' }],
      limit: 3
    })
    expect(error).to.be.null
  })
})
