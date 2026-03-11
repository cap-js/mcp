const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('@cds.query.limit', () => {

  describe('limit resolution', () => {

    it('uses entity default when no limit specified', async () => {
      // FullLimitBooks has default: 5
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(5)
    })

    it('enforces entity max when user limit exceeds it', async () => {
      // FullLimitBooks has max: 25
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(25)
    })

    it('allows user limit within max', async () => {
      // FullLimitBooks has max: 25
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'FullLimitBooks', limit: 3 })
      expect(error).to.be.null
      expect(content.count).to.equal(3)
    })

    it('uses service default with entity shorthand annotation', async () => {
      // MaxOnlyBooks has @cds.query.limit: 15 (max only), inherits default=10 from service
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOnlyBooks' })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(10)
    })

    it('enforces entity shorthand max', async () => {
      // MaxOnlyBooks has @cds.query.limit: 15
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOnlyBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(15)
    })

    it('supports separate annotation syntax', async () => {
      // SeparateAnnotationBooks has @cds.query.limit.default: 3, @cds.query.limit.max: 30
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'SeparateAnnotationBooks' })
      expect(error).to.be.null
      expect(content.count).to.equal(3)
    })

    it('enforces separate annotation max', async () => {
      // SeparateAnnotationBooks has @cds.query.limit.max: 30
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'SeparateAnnotationBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(30)
    })

    it('uses service default when entity limit disabled with 0', async () => {
      // DisabledLimitBooks has @cds.query.limit: 0, should use service default of 10
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'DisabledLimitBooks' })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(10)
    })

    it('uses service max when entity limit disabled', async () => {
      // DisabledLimitBooks has @cds.query.limit: 0, service has max: 50
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'DisabledLimitBooks', limit: 100 })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(50)
    })

    it('uses service defaults when no entity annotation', async () => {
      // ServiceDefaultBooks has no annotation, service has default: 10, max: 50
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'ServiceDefaultBooks' })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(10)
    })

    it('allows entity to override only max', async () => {
      // MaxOverrideBooks has only @cds.query.limit.max: 100, inherits default: 10 from service
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOverrideBooks' })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(10)
    })

    it('enforces entity max override', async () => {
      // MaxOverrideBooks has @cds.query.limit.max: 100
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('query', { entity: 'MaxOverrideBooks', limit: 200 })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(100)
    })

  })

  describe('describe tool includes queryLimits', () => {

    it('includes queryLimits in entity description', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entity: ['FullLimitBooks'] })
      expect(error).to.be.null
      expect(content.entities.FullLimitBooks.queryLimits).to.deep.equal({
        default: 5,
        max: 25
      })
    })

    it('shows inherited service limits in queryLimits', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entity: ['ServiceDefaultBooks'] })
      expect(error).to.be.null
      expect(content.entities.ServiceDefaultBooks.queryLimits).to.deep.equal({
        default: 10,
        max: 50
      })
    })

    it('shows service default in queryLimits for disabled entity', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entity: ['DisabledLimitBooks'] })
      expect(error).to.be.null
      expect(content.entities.DisabledLimitBooks.queryLimits).to.deep.equal({
        default: 10,  // from service (entity disabled with 0)
        max: 50       // from service
      })
    })

    it('shows shorthand max with inherited default', async () => {
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entity: ['MaxOnlyBooks'] })
      expect(error).to.be.null
      expect(content.entities.MaxOnlyBooks.queryLimits).to.deep.equal({
        default: 10,  // from service
        max: 15       // from entity shorthand
      })
    })

  })

  describe('MCP fallback', () => {

    it('uses MCP default of 20 when no @cds.query.limit annotations exist', async () => {
      // CatalogService has no @cds.query.limit annotations at service or entity level
      // MCP fallback of 20 should apply
      const { callTool } = mcpClient('/mcp/catalog')
      const { content, error } = await callTool('query', { entity: 'Books' })
      expect(error).to.be.null
      // MCP default of 20 applies, but we only have 5 books
      expect(content.count).to.equal(5)
    })

    it('includes MCP fallback default in describe output', async () => {
      // CatalogService has no @cds.query.limit annotations
      // MCP fallback default of 20 should be in the describe output
      const { callTool } = mcpClient('/mcp/catalog')
      const { content, error } = await callTool('describe', { entity: ['Books'] })
      expect(error).to.be.null
      expect(content.entities.Books.queryLimits).to.deep.equal({
        default: 20,   // MCP fallback (no annotations exist)
        max: 1000      // CAP global default
      })
    })

  })

  describe('global config (cds.env.query.limit)', () => {
    // Save and restore original config to avoid affecting other tests
    let originalQueryLimit

    beforeAll(() => {
      originalQueryLimit = cds.env.query?.limit
      // Set explicit global config for testing
      cds.env.query = {
        ...cds.env.query,
        limit: { default: 15, max: 200 }
      }
    })

    afterAll(() => {
      // Restore original config
      if (originalQueryLimit) {
        cds.env.query.limit = originalQueryLimit
      } else {
        delete cds.env.query.limit
      }
    })

    it('uses global default when no annotations exist', async () => {
      // CatalogService has no @cds.query.limit annotations
      // Should use global config default: 15
      const { callTool } = mcpClient('/mcp/catalog')
      const { content, error } = await callTool('describe', { entity: ['Books'] })
      expect(error).to.be.null
      expect(content.entities.Books.queryLimits.default).to.equal(15)
    })

    it('uses global max when no annotations exist', async () => {
      const { callTool } = mcpClient('/mcp/catalog')
      const { content, error } = await callTool('describe', { entity: ['Books'] })
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
      const { content, error } = await callTool('describe', { entity: ['ServiceDefaultBooks'] })
      expect(error).to.be.null
      expect(content.entities.ServiceDefaultBooks.queryLimits).to.deep.equal({
        default: 10,  // from service (overrides global 15)
        max: 50       // from service (overrides global 200)
      })
    })

    it('entity annotation overrides both service and global', async () => {
      // FullLimitBooks has @cds.query.limit: { default: 5, max: 25 }
      // Should override service (default: 10, max: 50) and global (default: 15, max: 200)
      const { callTool } = mcpClient('/mcp/limit')
      const { content, error } = await callTool('describe', { entity: ['FullLimitBooks'] })
      expect(error).to.be.null
      expect(content.entities.FullLimitBooks.queryLimits).to.deep.equal({
        default: 5,   // from entity
        max: 25       // from entity
      })
    })

  })

  describe('@cds.query.limit: 0 edge case', () => {

    it('falls back to MCP default when @cds.query.limit: 0 disables entity limit', async () => {
      // NoServiceLimitService has no service-level limits
      // DisabledBooks has @cds.query.limit: 0 which disables at entity level
      // Falls through to service (none) -> global (none) -> MCP fallback (20)
      const { callTool } = mcpClient('/mcp/no-service-limit')
      const { content, error } = await callTool('describe', { entity: ['DisabledBooks'] })
      expect(error).to.be.null
      // MCP fallback should still apply for safety
      expect(content.entities.DisabledBooks.queryLimits.default).to.equal(20)
      expect(content.entities.DisabledBooks.queryLimits.max).to.equal(1000)
    })

    it('applies MCP fallback when entity has no annotation', async () => {
      // NormalBooks has no annotation
      // Expected: MCP fallback default = 20, max = 1000
      const { callTool } = mcpClient('/mcp/no-service-limit')
      const { content, error } = await callTool('describe', { entity: ['NormalBooks'] })
      expect(error).to.be.null
      expect(content.entities.NormalBooks.queryLimits.default).to.equal(20)
      expect(content.entities.NormalBooks.queryLimits.max).to.equal(1000)
    })

  })

})
