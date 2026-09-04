const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'cql'

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('SQL Format Mode (cds.env.mcp.format = "cql")', () => {
  describe('tools/list', () => {
    it('query tool accepts sql input schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const queryTool = response.result.tools.find((t) => t.name === 'query')
      expect(queryTool).to.exist
      expect(queryTool.inputSchema.properties).to.have.property('cql')
      expect(queryTool.inputSchema.properties.cql.type).to.equal('string')
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
        cql: 'SELECT ID, title FROM CatalogService.Books'
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
        cql: 'SELECT ID, title FROM CatalogService.Books WHERE ID = 201'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('supports LIMIT', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books LIMIT 2'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(2)
    })

    it('supports ORDER BY', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, title FROM CatalogService.Books ORDER BY ID ASC LIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data[0].ID).to.equal(201)
    })

    it('rejects non-SELECT statements', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'DELETE FROM CatalogService.Books WHERE ID = 201'
      })
      expect(error).to.not.be.null
    })

    it('returns error for invalid SQL', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT FROM WHERE INVALID'
      })
      expect(error).to.not.be.null
    })

    it('returns clear error when FROM clause is missing', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT Books'
      })
      expect(error).to.not.be.null
      expect(error).to.match(/missing a FROM clause/i)
      expect(error).to.not.match(/Cannot read properties of undefined/i)
    })

    it('returns count in result', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books'
      })
      expect(error).to.be.null
      expect(content.count).to.equal(content.data.length)
    })

    it('count reflects total rows even with LIMIT', async () => {
      const { callTool } = mcpClient()
      const { content: allContent } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books'
      })
      const { content: limitedContent, error } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books LIMIT 2'
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
        cql: 'SELECT ID FROM CatalogService.Books LIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      const { amt } = await cds.run(
        SELECT.one.from('CatalogService.Books').columns('count(*) as amt')
      )
      expect(content.count).to.equal(amt)
    })

    it('handles multiline SQL (LLM often generates newlines before FROM/WHERE)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, title\nFROM CatalogService.Books\nWHERE ID = 201\nLIMIT 1'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('handles multiline SQL with string values in WHERE clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: "SELECT ID, title\nFROM CatalogService.Books\nWHERE title = 'Wuthering Heights'\nLIMIT 1"
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].ID).to.equal(201)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('supports implicit table aliases (SQL standard, no AS keyword)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT b.ID, b.title FROM CatalogService.Books b WHERE b.ID = 201'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('supports implicit aliases with JOIN', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT b.ID, b.title FROM CatalogService.Books b INNER JOIN CatalogService.Genres g ON b.genre_ID = g.ID'
      })
      // Should not fail with parse/alias error — implicit aliases are SQL standard
      // (may fail at CAP runtime for other reasons like unsupported JOIN)
      if (error) {
        expect(error).to.not.include('compilation failed')
        expect(error).to.not.include('cannot be resolved')
      }
    })

    it('supports OFFSET without false alias detection', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books LIMIT 2 OFFSET 1'
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(2)
    })

    it('supports infix filter on FROM entity', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        cql: "select from Authors[contains(placeOfBirth,'Thornton')] { name, books { title, price } }"
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      // Emily and Charlotte Brontë were both born in Thornton, Yorkshire
      const names = content.data.map((a) => a.name)
      expect(names).to.include('Emily Brontë')
      expect(names).to.include('Charlotte Brontë')
      // expand into books must be present as an array
      content.data.forEach((a) => expect(a.books).to.be.an('array'))
    })
  })

  describe('Security — cross-service access prevention', () => {
    it('rejects JOIN with entity from another service', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT b.ID FROM CatalogService.Books as b INNER JOIN AdminService.Authors as a ON b.authorID = a.ID'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects subselect referencing another service entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT ID FROM CatalogService.Books WHERE author_ID IN (SELECT ID FROM AdminService.Authors)'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects direct access to raw DB entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT ID, name FROM sap.capire.bookshop.Authors'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('rejects UNION with another service entity', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT ID FROM (SELECT ID FROM CatalogService.Books UNION ALL SELECT ID FROM AdminService.Authors)'
      })
      expect(error).to.not.be.null
      expect(error).to.include('cannot be resolved')
    })

    it('allows JOIN within same service (passes validation)', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        cql: 'SELECT b.ID, b.title FROM CatalogService.Books as b INNER JOIN CatalogService.Genres as g ON b.genre_ID = g.ID'
      })
      // Should NOT be blocked by our cross-service validation
      // (may still fail at CAP runtime level for other reasons)
      if (error) {
        expect(error).to.not.include('cannot be resolved')
      }
    })
  })

  describe('query (CQL) — directly-defined entity', () => {
    it('accepts unqualified name: SELECT from User', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, text FROM User'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('text')
    })

    it('qualified name also works: SELECT from CatalogService.User', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, text FROM CatalogService.User'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
    })

    it('unqualified name with WHERE clause works', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: "SELECT ID, text FROM User WHERE text = 'Hello World'"
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].text).to.equal('Hello World')
    })

    it('unqualified name with infix filter works (ref[0] as { id, where } object)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: "select from User[text = 'Hello World'] { ID, text }"
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].text).to.equal('Hello World')
    })
  })
})
