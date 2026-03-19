const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}; cds.env.mcp.per_entity_tool = true

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Per-Entity Tools', () => {
  describe('tools/list', () => {
    it('has per-entity query tools with query_ prefix', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('query_Books')
      expect(toolNames).to.include('query_Genres')
    })

    it('has describe tool', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('describe')
    })

    it('does not have generic query tool', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('query')
    })
  })

  describe('tool execution', () => {
    it('executes query_Books tool and returns all books with titles', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query_Books')
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
      expect(content.count).to.equal(5)
      const titles = content.data.map(b => b.title)
      expect(titles).to.include('Wuthering Heights')
      expect(titles).to.include('Catweazle')
    })

    it('executes query_Genres tool and returns genre names', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query_Genres', { limit: 50 })
      expect(error).to.be.null
      expect(content.entity).to.equal('Genres')
      expect(content.count).to.equal(42)
      const names = content.data.map(g => g.name)
      expect(names).to.include('Fiction')
      expect(names).to.include('Science Fiction')
    })

    it('filters with query_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query_Books', { 
        where: [{ ref: ['ID'] }, '=', { val: 201 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].ID).to.equal(201)
    })

    it('selects fields with query_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query_Books', { select: ['ID', 'title'] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.not.have.property('descr')
    })

    it('paginates with query_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query_Books', { limit: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })
  })

  describe('autoexposed entities', () => {
    it('does not register tools for composition-only autoexposed entities', async () => {
      const { mcp } = mcpClient('/mcp/restricted')
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      // Books.chapters is a composition target (@cds.autoexposed only) - should be filtered out
      expect(toolNames).to.not.include('query_Books.chapters')
    })

    it('registers tools for entities with @cds.autoexpose', async () => {
      const { mcp } = mcpClient('/mcp/restricted')
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      // Currencies has @cds.autoexpose - READ is allowed, tool should exist
      expect(toolNames).to.include('query_Currencies')
      // Genres has @cds.autoexpose - tool should exist
      expect(toolNames).to.include('query_Genres')
    })
  })
})
