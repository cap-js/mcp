const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'cqn'
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('@cds.query.limit', () => {
  beforeAll(async () => {
    const db = await cds.connect.to('db')
    const { Books } = cds.entities('sap.capire.bookshop')
    const books = Array.from({ length: 200 }, (_, i) => ({
      ID: 1000 + i,
      title: `Generated Book ${i}`,
      author_ID: 101,
      stock: Math.floor(Math.random() * 100),
      price: +(Math.random() * 50 + 5).toFixed(2),
      currency_code: 'USD'
    }))
    await db.run(INSERT.into(Books).entries(books))
  })

  // Service: @cds.query.limit.default: 10, @cds.query.limit.max: 50

  describe('FullLimitBooks — @cds.query.limit: { default: 5, max: 25 }', () => {
    it('describe reports default=5, max=25', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entities: ['FullLimitBooks'] })
      expect(error).to.be.null
      expect(content.entities.FullLimitBooks.queryLimits).to.deep.equal({
        default: 5,
        max: 25
      })
    })

    it('applies entity default of 5 when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(5)
    })

    it('enforces entity max of 25 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.equal(25)
    })

    it('allows user limit within max', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks', limit: 3 })
      expect(error).to.be.null
      expect(content.count).to.equal(3)
    })
  })

  describe('MaxOnlyBooks — @cds.query.limit: 15', () => {
    // Expected: default=15, max=50 (from service)

    it('describe reports default=15, max=50', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entities: ['MaxOnlyBooks'] })
      expect(error).to.be.null
      expect(content.entities.MaxOnlyBooks.queryLimits).to.deep.equal({
        default: 15,
        max: 50
      })
    })

    it('applies entity default of 15 when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOnlyBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(15)
    })

    it('enforces service max of 50 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOnlyBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.equal(50)
    })
  })

  describe('SeparateAnnotationBooks — @cds.query.limit.default: 3, @cds.query.limit.max: 30', () => {
    // Expected: default=3, max=30

    it('describe reports default=3, max=30', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', {
        entities: ['SeparateAnnotationBooks']
      })
      expect(error).to.be.null
      expect(content.entities.SeparateAnnotationBooks.queryLimits).to.deep.equal({
        default: 3,
        max: 30
      })
    })

    it('applies entity default of 3 when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'SeparateAnnotationBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(3)
    })

    it('enforces entity max of 30 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'SeparateAnnotationBooks',
        limit: 100
      })
      expect(error).to.be.null
      expect(content.count).to.equal(30)
    })
  })

  describe('DisabledLimitBooks — @cds.query.limit: 0', () => {
    // Expected: no default, max=50 (from service)

    it('describe reports no default and max=50 from service', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entities: ['DisabledLimitBooks'] })
      expect(error).to.be.null
      expect(content.entities.DisabledLimitBooks.queryLimits.default).to.not.be.ok
      expect(content.entities.DisabledLimitBooks.queryLimits.max).to.equal(50)
    })

    it('returns all results (up to max) when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'DisabledLimitBooks' })
      expect(error).to.be.null
      // No default, so no limit applied — but 205 books > max 50...
      // Actually no default means effectiveLimit is undefined, so no limit is set
      expect(content.count).to.equal(50)
    })

    it('enforces service max of 50 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'DisabledLimitBooks',
        limit: 100
      })
      expect(error).to.be.null
      expect(content.count).to.equal(50)
    })
  })

  describe('ServiceDefaultBooks — no entity annotation', () => {
    // Expected: default=10, max=50 (from service)
    it('describe reports default=10, max=50 from service', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entities: ['ServiceDefaultBooks'] })
      expect(error).to.be.null
      expect(content.entities.ServiceDefaultBooks.queryLimits).to.deep.equal({
        default: 10,
        max: 50
      })
    })

    it('applies service default of 10 when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'ServiceDefaultBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(10)
    })

    it('enforces service max of 50 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'ServiceDefaultBooks',
        limit: 100
      })
      expect(error).to.be.null
      expect(content.count).to.equal(50)
    })
  })

  describe('MaxOverrideBooks — @cds.query.limit.max: 100', () => {
    // Expected: default=10 (from service), max=100

    it('describe reports default=10 from service, max=100 from entity', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entities: ['MaxOverrideBooks'] })
      expect(error).to.be.null
      expect(content.entities.MaxOverrideBooks.queryLimits).to.deep.equal({
        default: 10,
        max: 100
      })
    })

    it('applies service default of 10 when no limit specified', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOverrideBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(10)
    })

    it('enforces entity max of 100 when user limit exceeds it', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOverrideBooks', limit: 200 })
      expect(error).to.be.null
      expect(content.count).to.equal(100)
    })
  })

  describe('NoServiceLimitService — no service-level limits', () => {
    it('NormalBooks: describe reports CAP global max of 1000', async () => {
      const { callTool } = mcpClient('/mcp/no-service-limit')
      const { content, error } = await callTool('describe', { entities: ['NormalBooks'] })
      expect(error).to.be.null
      expect(content.entities.NormalBooks.queryLimits.max).to.equal(1000)
    })

    it('DisabledBooks: @cds.query.limit: 0 disables default, max=1000 from global', async () => {
      const { callTool } = mcpClient('/mcp/no-service-limit')
      const { content, error } = await callTool('describe', { entities: ['DisabledBooks'] })
      expect(error).to.be.null
      expect(content.entities.DisabledBooks.queryLimits.default).to.not.be.ok
      expect(content.entities.DisabledBooks.queryLimits.max).to.equal(1000)
    })
  })

  describe('offset', () => {
    // Stable order helper — sort by ID to make page contents predictable
    const orderById = [{ ref: ['ID'], sort: 'asc' }]

    it('offset + limit returns the requested slice', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        limit: 5,
        offset: 5
      })
      expect(error).to.be.null
      expect(content.count).to.equal(5)
      const ids = content.data.map((b) => b.ID)
      // IDs should be in ascending order
      expect(ids).to.deep.equal([...ids].sort((a, b) => a - b))
      expect(ids).to.have.lengthOf(5)
    })

    it('offset: 0 behaves identically to omitting offset', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const baseline = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        limit: 10
      })
      const withOffset0 = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        limit: 10,
        offset: 0
      })
      expect(baseline.error).to.be.null
      expect(withOffset0.error).to.be.null
      expect(withOffset0.content.data.map((b) => b.ID)).to.deep.equal(
        baseline.content.data.map((b) => b.ID)
      )
    })

    it('two consecutive pages are disjoint and contiguous', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const page1 = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        limit: 5,
        offset: 0
      })
      const page2 = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        limit: 5,
        offset: 5
      })
      expect(page1.error).to.be.null
      expect(page2.error).to.be.null
      const ids1 = page1.content.data.map((b) => b.ID)
      const ids2 = page2.content.data.map((b) => b.ID)
      expect(ids1).to.have.lengthOf(5)
      expect(ids2).to.have.lengthOf(5)
      // No overlap
      expect(ids1.filter((id) => ids2.includes(id))).to.deep.equal([])
      // Contiguous when sorted
      expect([...ids1, ...ids2]).to.deep.equal([...ids1, ...ids2].sort((a, b) => a - b))
    })

    it('offset alone applies CAP default page size as rows', async () => {
      // FullLimitBooks has default=5 — offset without limit should still cap at 5
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'FullLimitBooks',
        orderBy: orderById,
        offset: 3
      })
      expect(error).to.be.null
      expect(content.count).to.equal(5)
    })

    it('respects entity max when (offset + limit) crosses it', async () => {
      // FullLimitBooks max=25 — request 100 starting at offset 10 → still capped at 25
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'FullLimitBooks',
        orderBy: orderById,
        limit: 100,
        offset: 10
      })
      expect(error).to.be.null
      expect(content.count).to.equal(25)
    })

    it('offset is ignored when one: true (single record returned)', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', {
        entity: 'MaxOverrideBooks',
        orderBy: orderById,
        offset: 5,
        one: true
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
    })

    it('offset is ignored when distinct: true', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content: withOffset, error: e1 } = await callTool('query', {
        entity: 'MaxOverrideBooks',
        select: [{ ref: ['currency_code'] }],
        distinct: true,
        offset: 100
      })
      const { content: noOffset, error: e2 } = await callTool('query', {
        entity: 'MaxOverrideBooks',
        select: [{ ref: ['currency_code'] }],
        distinct: true
      })
      expect(e1).to.be.null
      expect(e2).to.be.null
      expect(withOffset.count).to.equal(noOffset.count)
    })

    it('rejects negative offset via Zod validation', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { error } = await callTool('query', {
        entity: 'MaxOverrideBooks',
        offset: -1
      })
      expect(error).to.be.ok
    })
  })
})
