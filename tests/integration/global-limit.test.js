const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'cqn'
cds.env.query = {
  ...cds.env.query,
  limit: { default: 15, max: 200 }
}
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('global config (cds.env.query.limit)', () => {
  beforeAll(async () => {
    const db = await cds.connect.to('db')
    const { Books } = cds.entities('sap.capire.bookshop')
    const books = Array.from({ length: 200 }, (_, i) => ({
      ID: 2000 + i,
      title: `Generated Book ${i}`,
      author_ID: 101,
      stock: Math.floor(Math.random() * 100),
      price: +(Math.random() * 50 + 5).toFixed(2),
      currency_code: 'USD'
    }))
    await db.run(DELETE.from(Books).where('ID >=', 2000, 'and ID <', 2200))
    await db.run(INSERT.into(Books).entries(books))
  })

  afterAll(async () => {
    const db = await cds.connect.to('db')
    const { Books } = cds.entities('sap.capire.bookshop')
    await db.run(DELETE.from(Books).where('ID >=', 2000, 'and ID <', 2200))
  })

  it('uses global default when no annotations exist', async () => {
    // CatalogService has no @cds.query.limit annotations
    // Should use global config default: 15
    const { callTool } = mcpClient('/mcp/catalog')
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    expect(content.entities.Books.queryLimits.default).to.equal(15)
  })

  it('uses global max when no annotations exist', async () => {
    const { callTool } = mcpClient('/mcp/catalog')
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    expect(content.entities.Books.queryLimits.max).to.equal(200)
  })

  it('applies global default in query execution', async () => {
    const { callTool } = mcpClient('/mcp/catalog')
    const { content, error } = await callTool('query', { entity: 'Genres' })
    expect(error).to.be.null
    // Global default: 15
    expect(content.count).to.equal(15)
  })

  it('enforces global max when user limit exceeds it', async () => {
    const { callTool } = mcpClient('/mcp/catalog')
    const { content, error } = await callTool('query', { entity: 'Genres', limit: 500 })
    expect(error).to.be.null
    // Global max: 200, but Genres has 42 entries so we get all of them
    expect(content.count).to.equal(42)
  })

  it('service annotation overrides global config', async () => {
    // LimitService has @cds.query.limit.default: 10, @cds.query.limit.max: 50
    // Should override global config (default: 15, max: 200)
    const { callTool } = mcpClient('/mcp/limit')
    const { content, error } = await callTool('describe', { entities: ['ServiceDefaultBooks'] })
    expect(error).to.be.null
    expect(content.entities.ServiceDefaultBooks.queryLimits).to.deep.equal({
      default: 10, // from service (overrides global 15)
      max: 50 // from service (overrides global 200)
    })
  })

  it('entity annotation overrides both service and global', async () => {
    // FullLimitBooks has @cds.query.limit: { default: 5, max: 25 }
    // Should override service (default: 10, max: 50) and global (default: 15, max: 200)
    const { callTool } = mcpClient('/mcp/limit')
    const { content, error } = await callTool('describe', { entities: ['FullLimitBooks'] })
    expect(error).to.be.null
    expect(content.entities.FullLimitBooks.queryLimits).to.deep.equal({
      default: 5, // from entity
      max: 25 // from entity
    })
  })
})
