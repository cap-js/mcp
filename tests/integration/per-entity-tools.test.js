const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.features.mcp_per_entity_tool = true

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Per-Entity Tools', () => {
  describe('tools/list', () => {
    it('has per-entity read tools', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('read_Books')
      expect(toolNames).to.include('read_Genres')
    })

    it('has describe_model tool', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('describe_model')
    })

    it('does not have generic read_query tool', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('read_query')
    })
  })

  describe('tool execution', () => {
    it('executes read_Books tool and returns all books with titles', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_Books')
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
      expect(content.count).to.equal(5)
      const titles = content.data.map(b => b.title)
      expect(titles).to.include('Wuthering Heights')
      expect(titles).to.include('Catweazle')
    })

    it('executes read_Genres tool and returns genre names', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_Genres', { limit: 50 })
      expect(error).to.be.null
      expect(content.entity).to.equal('Genres')
      expect(content.count).to.equal(42)
      const names = content.data.map(g => g.name)
      expect(names).to.include('Fiction')
      expect(names).to.include('Science Fiction')
    })

    it('filters with read_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_Books', { 
        filter: [{ ref: ['ID'] }, '=', { val: 201 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].ID).to.equal(201)
    })

    it('selects fields with read_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_Books', { select: ['ID', 'title'] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.not.have.property('descr')
    })

    it('paginates with read_Books tool', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_Books', { limit: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })
  })
})
