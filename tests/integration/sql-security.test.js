const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'sql'
cds.env.mcp.toon_format = false

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

/**
 * Security test suite for SQL format query tool.
 *
 * Attack surface: cds.env.mcp.format='sql' accepts raw SQL strings
 * which are parsed via cds.parse.cql() → CQN → srv.run().
 *
 * Threats:
 *   1. Information disclosure via system functions in SELECT columns
 *      (CURRENT_USER, SESSION_USER, SYSUUID, etc.)
 *   2. Non-entity column refs pointing to database pseudo-columns
 *      (CURRENT_SCHEMA, CURRENT_DATABASE)
 *   3. DoS via missing LIMIT
 *   4. DoS via extremely large SQL input
 *   5. DML disguised or bypassing SELECT check
 *   6. Entity validation bypass (cross-service, HANA system views)
 */
describe('SQL Format Security', () => {
  describe('Information disclosure via system functions in SELECT columns', () => {
    it('blocks CURRENT_USER function', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT CURRENT_USER FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
      expect(error).to.match(/function|not allowed|CURRENT_USER/i)
    })

    it('blocks SESSION_USER function', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT SESSION_USER FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
      expect(error).to.match(/function|not allowed|SESSION_USER/i)
    })

    it('blocks SYSUUID function', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT SYSUUID FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
      expect(error).to.match(/function|not allowed|SYSUUID/i)
    })

    it('blocks dangerous functions in mixed SELECT (with legitimate cols)', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT ID, title, CURRENT_USER FROM CatalogService.Books LIMIT 1'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })

    it('blocks dangerous functions in xpr (arithmetic)', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: "SELECT ID, CURRENT_USER || '-' || title as x FROM CatalogService.Books"
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })

    it('blocks dangerous functions in WHERE clause', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: "SELECT ID FROM CatalogService.Books WHERE CURRENT_USER = 'SYSTEM'"
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })

    it('blocks dangerous functions nested in aggregates', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT COUNT(CURRENT_USER) FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })
  })

  describe('Non-entity column ref attacks', () => {
    it('blocks CURRENT_SCHEMA as bare column', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT CURRENT_SCHEMA FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })

    it('blocks CURRENT_DATABASE as bare column', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT CURRENT_DATABASE FROM CatalogService.Books'
      })
      expect(error, `LEAK: ${JSON.stringify(content)}`).to.not.be.null
    })
  })

  describe('Allowed standard functions still work', () => {
    it('allows COUNT(*) aggregate', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT COUNT(*) as cnt FROM CatalogService.Books'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
    })

    it('allows SUM aggregate', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT SUM(stock) as total FROM CatalogService.Books'
      })
      expect(error).to.be.null
    })

    it('allows AVG aggregate', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT AVG(stock) as avg_stock FROM CatalogService.Books'
      })
      expect(error).to.be.null
    })

    it('allows MIN/MAX aggregates', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT MIN(stock) as mn, MAX(stock) as mx FROM CatalogService.Books'
      })
      expect(error).to.be.null
    })

    it('allows LOWER string function', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT LOWER(title) as t FROM CatalogService.Books LIMIT 3'
      })
      expect(error).to.be.null
    })

    it('allows UPPER string function', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT UPPER(title) as t FROM CatalogService.Books LIMIT 3'
      })
      expect(error).to.be.null
    })

    it('allows CONCAT string function', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: "SELECT CONCAT(title, '!') as t FROM CatalogService.Books LIMIT 3"
      })
      expect(error).to.be.null
    })

    it('allows YEAR date function', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT YEAR(createdAt) as y FROM CatalogService.Books LIMIT 3'
      })
      expect(error).to.be.null
    })

    it('allows entity column refs (path expressions)', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID, title FROM CatalogService.Books LIMIT 3'
      })
      expect(error).to.be.null
    })
  })

  describe('LIMIT enforcement', () => {
    it('auto-injects default LIMIT when SQL has none', async () => {
      const { callTool } = mcpClient()
      // No LIMIT in SQL — should be auto-clamped to prevent unbounded results
      const { error, content } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books'
      })
      expect(error).to.be.null
      // Result must be bounded (default limit or entity/service max)
      expect(content.data.length).to.be.at.most(1000)
    })

    it('clamps user LIMIT to service max (respects cds.env.query.limit.max)', async () => {
      const { callTool } = mcpClient()
      // Request more than max — CAP's max is 1000 by default
      const { error, content } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books LIMIT 999999'
      })
      expect(error).to.be.null
      expect(content.data.length).to.be.at.most(1000)
    })

    it('respects user LIMIT within max', async () => {
      const { callTool } = mcpClient()
      const { error, content } = await callTool('query', {
        sql: 'SELECT ID FROM CatalogService.Books LIMIT 3'
      })
      expect(error).to.be.null
      expect(content.data.length).to.be.at.most(3)
    })
  })

  describe('SQL length cap (DoS prevention)', () => {
    it('rejects SQL exceeding max length', async () => {
      const { callTool } = mcpClient()
      const huge = 'SELECT ' + 'a,'.repeat(10_000) + '1 FROM CatalogService.Books'
      const { error } = await callTool('query', { sql: huge })
      expect(error).to.not.be.null
      expect(error).to.match(/length|too large|max/i)
    })

    it('accepts SQL within max length', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID, title FROM CatalogService.Books LIMIT 5'
      })
      expect(error).to.be.null
    })
  })

  describe('Entity validation (regression tests)', () => {
    it('blocks DUMMY table access', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT * FROM DUMMY'
      })
      expect(error).to.not.be.null
    })

    it('blocks HANA SYS.M_TABLES access', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT * FROM SYS.M_TABLES'
      })
      expect(error).to.not.be.null
    })

    it('blocks subselect targeting other service in column', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'SELECT ID, (SELECT name FROM AdminService.Authors LIMIT 1) as leaked FROM CatalogService.Books'
      })
      expect(error).to.not.be.null
    })
  })

  describe('DML rejection (regression tests)', () => {
    it('rejects INSERT', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: "INSERT INTO CatalogService.Books (ID, title) VALUES (99999, 'hack')"
      })
      expect(error).to.not.be.null
    })

    it('rejects UPDATE', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: "UPDATE CatalogService.Books SET title = 'hacked' WHERE ID = 201"
      })
      expect(error).to.not.be.null
    })

    it('rejects DELETE', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'DELETE FROM CatalogService.Books WHERE ID = 201'
      })
      expect(error).to.not.be.null
    })

    it('rejects DROP TABLE', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'DROP TABLE CatalogService.Books'
      })
      expect(error).to.not.be.null
    })

    it('rejects CREATE TABLE', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        sql: 'CREATE TABLE hacked (id INTEGER)'
      })
      expect(error).to.not.be.null
    })
  })
})
