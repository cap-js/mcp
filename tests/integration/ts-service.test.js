const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.mcp ??= {}
cds.env.mcp.format = 'cql'
cds.env.mcp.toon_format = false

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('CatalogService — directly-defined entity', () => {

  describe('query — unqualified entity name on directly-defined entity', () => {
    it('accepts unqualified name: SELECT from Note', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, text FROM Note'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('text')
    })

    it('qualified name also works: SELECT from CatalogService.Note', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: 'SELECT ID, text FROM CatalogService.Note'
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
    })

    it('unqualified name with WHERE clause works', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: "SELECT ID, text FROM Note WHERE text = 'Hello World'"
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].text).to.equal('Hello World')
    })

    it('unqualified name with infix filter works (ref[0] as { id, where } object)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        cql: "select from Note[text = 'Hello World'] { ID, text }"
      })
      expect(error).to.be.null
      expect(content.data).to.have.lengthOf(1)
      expect(content.data[0].text).to.equal('Hello World')
    })
  })
})
