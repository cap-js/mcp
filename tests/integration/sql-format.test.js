const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'sql'
cds.env.mcp.toon_format = false

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('SQL Format Mode (cds.env.mcp.format = "sql")', () => {
  describe('tools/list', () => {
    it('query tool accepts sql input schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const queryTool = response.result.tools.find((t) => t.name === 'query')
      expect(queryTool).to.exist
      expect(queryTool.inputSchema.properties).to.have.property('sql')
      expect(queryTool.inputSchema.properties.sql.type).to.equal('string')
      // Should NOT have entity/where/select CQN properties
      expect(queryTool.inputSchema.properties).to.not.have.property('entity')
      expect(queryTool.inputSchema.properties).to.not.have.property('where')
      expect(queryTool.inputSchema.properties).to.not.have.property('select')
    })

    it('describe tool is still available', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('describe')
    })
  })

  describe('query (SQL)', () => {
    it('executes a simple SELECT query', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID, title FROM CatalogService.Books'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('title')
    })

    it('supports WHERE clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID, title FROM CatalogService.Books WHERE ID = 201'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('supports LIMIT', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books LIMIT 2'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(2)
    })

    it('supports ORDER BY', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID, title FROM CatalogService.Books ORDER BY ID ASC LIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data[0].ID).to.equal(201)
    })

    it('rejects non-SELECT statements', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'DELETE FROM CatalogService.Books WHERE ID = 201'
      })
      expect(error).to.not.be.null
    })

    it('returns error for invalid SQL', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT FROM WHERE INVALID'
      })
      expect(error).to.not.be.null
    })

    it('returns count in result', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books'
      })
      expect(error).to.be.null
      expect(content.count).to.equal(content.data.length)
    })

    it('count reflects total rows even with LIMIT', async () => {
      const { callTool } = mcpClient()
      const { content: allContent } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books'
      })
      const { content: limitedContent, error } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books LIMIT 2'
      })
      expect(error).to.be.null
      expect(limitedContent.data).to.have.lengthOf(2)
      // $count should reflect total available rows, not the limited result
      expect(limitedContent.count).to.equal(allContent.count)
      expect(limitedContent.count).to.be.greaterThan(limitedContent.data.length)
    })

    it('$count reports true total even when LIMIT is 1', async () => {
      const { callTool } = mcpClient()
      // Only fetch 1 row but total should be all books (5)
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books LIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      const { amt } = await cds.run(
        SELECT.one.from('CatalogService.Books').columns('count(*) as amt')
      )
      expect(content.count).to.equal(amt)
    })

    it('returns original sql in result', async () => {
      const { callTool } = mcpClient()
      const sql = 'SELECT ID FROM CatalogService.Books LIMIT 1'
      const { content, error } = await callTool('query', { sql })
      expect(error).to.be.null
      expect(content.sql).to.equal(sql)
    })

    it('handles multiline SQL (LLM often generates newlines before FROM/WHERE)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        sql: 'SELECT ID, title\nFROM CatalogService.Books\nWHERE ID = 201\nLIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })
  })

  describe('describe (CDL)', () => {
    it('returns CDS definition for entities', async () => {
      const { mcp } = mcpClient()
      const res = await mcp('tools/call', { name: 'describe', arguments: { entities: ['Books'] } })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      // Should contain entity keyword and field names
      expect(text).to.include('entity')
      expect(text).to.include('title')
      expect(text).to.include('ID')
    })

    it('returns CDL with element types', async () => {
      const { mcp } = mcpClient()
      const res = await mcp('tools/call', { name: 'describe', arguments: { entities: ['Books'] } })
      const text = res.result.content[0].text
      // cds.compile.to.cdl includes element names and types
      expect(text).to.include('ID')
      expect(text).to.include('title')
      expect(text).to.include('stock')
    })

    it('does not contain draft elements in CDL output', async () => {
      const { mcp } = mcpClient('/mcp/admin', 'alice:')
      const res = await mcp('tools/call', { name: 'describe', arguments: { entities: ['Books'] } })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      expect(text).to.not.include('IsActiveEntity')
      expect(text).to.not.include('DraftAdministrativeData')
    })

    it('overview mode lists entities without full definitions', async () => {
      const { mcp } = mcpClient()
      const res = await mcp('tools/call', { name: 'describe', arguments: {} })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      // Should have multiple entity references
      expect(text).to.include('Books')
      expect(text).to.include('Genres')
    })

    it('does not include autoexposed composition targets', async () => {
      const { mcp } = mcpClient()
      const res = await mcp('tools/call', { name: 'describe', arguments: {} })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      // Books.chapters is @cds.autoexposed (composition target) - should be filtered out
      expect(text).to.not.include('chapters')
    })

    it('returns action definitions', async () => {
      const { mcp } = mcpClient()
      const res = await mcp('tools/call', { name: 'describe', arguments: { actions: ['sum'] } })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      expect(text).to.include('sum')
    })

    it('describes entity with aspects (includes) without referencing external types', async () => {
      const { mcp } = mcpClient()
      // Genres entity uses aspects: cuid, sap.common.CodeList
      const res = await mcp('tools/call', { name: 'describe', arguments: { entities: ['Genres'] } })
      const text = res.result.content[0].text
      expect(res.result.isError).to.not.be.true
      // Should contain entity definition with its elements
      expect(text).to.include('Genres')
      expect(text).to.include('ID')
      expect(text).to.include('name')
      // Should NOT reference aspect includes (confusing for LLM SQL generation)
      expect(text).to.not.include(': cuid')
      expect(text).to.not.include('sap.common.CodeList')
    })
  })

  describe('Security — cross-service access prevention', () => {
    it('rejects JOIN with entity from another service', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT b.ID FROM CatalogService.Books as b INNER JOIN AdminService.Authors as a ON b.authorID = a.ID'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects subselect referencing another service entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books WHERE author_ID IN (SELECT ID FROM AdminService.Authors)'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects direct access to raw DB entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID, name FROM sap.capire.bookshop.Authors'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects UNION with another service entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID FROM (SELECT ID FROM CatalogService.Books UNION ALL SELECT ID FROM AdminService.Authors)'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('allows JOIN within same service (passes validation)', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT b.ID, b.title FROM CatalogService.Books as b INNER JOIN CatalogService.Genres as g ON b.genre_ID = g.ID'
      })
      // Should NOT be blocked by our cross-service validation
      // (may still fail at CAP runtime level for other reasons)
      if (error) {
        expect(error).to.not.include('cannot be resolved')
      }
    })
  })
})
