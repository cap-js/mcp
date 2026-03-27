const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('@cds.api.ignore annotation', () => {

  describe('entities', () => {
    it('hides ignored entity from tools/list entity enum', async () => {
      const { mcp } = mcpClient('/mcp/api-ignore-test')
      const response = await mcp('tools/list')
      const queryTool = response.result.tools.find(t => t.name === 'query')
      const entityEnum = queryTool.inputSchema.properties.entity.enum

      expect(entityEnum).to.include('BooksWithIgnored')
      expect(entityEnum).to.include('VisibleAuthors')
      expect(entityEnum).to.not.include('HiddenEntity')
    })

    it('hides ignored entity from describe output', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')
      const { content, error } = await callTool('describe')

      expect(error).to.be.null
      expect(content.entities).to.have.property('BooksWithIgnored')
      expect(content.entities).to.have.property('VisibleAuthors')
      expect(content.entities).to.not.have.property('HiddenEntity')
    })

    it('cannot query ignored entity', async () => {
      const { callTool, mcp } = mcpClient('/mcp/api-ignore-test')

      // First check what entities are in the tools/list
      const toolsResponse = await mcp('tools/list')
      const queryTool = toolsResponse.result.tools.find(t => t.name === 'query')
      const entityEnum = queryTool.inputSchema.properties.entity.enum

      // HiddenEntity should not be in the enum
      expect(entityEnum).to.not.include('HiddenEntity')

      // Try to call query with the hidden entity
      // MCP SDK validates enum and returns an error
      const { error } = await callTool('query', { entity: 'HiddenEntity' })

      // Should get a validation error
      expect(error).to.exist
      expect(error).to.include('Invalid')
    })
  })

  describe('elements', () => {
    it('hides ignored elements from describe output', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')
      const { content, error } = await callTool('describe', { entity: ['BooksWithIgnored'] })

      expect(error).to.be.null
      const elements = content.entities.BooksWithIgnored.elements

      // Visible elements should be present
      expect(elements).to.have.property('ID')
      expect(elements).to.have.property('title')
      expect(elements).to.have.property('stock')

      // Ignored elements should not be present
      expect(elements).to.not.have.property('price')
      expect(elements).to.not.have.property('currency')
    })

    it('returns error when selecting ignored element', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')
      const { error } = await callTool('query', {
        entity: 'BooksWithIgnored',
        select: [{ ref: ['title'] }, { ref: ['price'] }]  // price is @cds.api.ignore
      })

      expect(error).to.exist
      expect(error).to.include('Invalid select field')
      expect(error).to.include('price')
    })

    it('allows selecting visible elements', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')
      const { content, error } = await callTool('query', {
        entity: 'BooksWithIgnored',
        select: [{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['stock'] }]
      })

      expect(error).to.be.null
      expect(content.data).to.be.an('array')
    })
  })

  describe('actions', () => {
    it('hides ignored action from tools/list action enum', async () => {
      const { mcp } = mcpClient('/mcp/api-ignore-test')
      const response = await mcp('tools/list')
      const callActionTool = response.result.tools.find(t => t.name === 'call_action')
      const actionEnum = callActionTool.inputSchema.properties.action.enum

      expect(actionEnum).to.include('visibleAction')
      expect(actionEnum).to.include('visibleFunction')
      expect(actionEnum).to.not.include('hiddenAction')
      expect(actionEnum).to.not.include('hiddenFunction')
    })

    it('hides ignored actions from describe output', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')
      const { content, error } = await callTool('describe')

      expect(error).to.be.null
      expect(content.actions).to.have.property('visibleAction')
      expect(content.actions).to.have.property('visibleFunction')
      expect(content.actions).to.not.have.property('hiddenAction')
      expect(content.actions).to.not.have.property('hiddenFunction')
    })

    it('cannot call ignored action', async () => {
      const { callTool } = mcpClient('/mcp/api-ignore-test')

      // Try to call the hidden action
      // MCP SDK validates enum and returns an error
      const { error } = await callTool('call_action', {
        action: 'hiddenAction',
        parameters: {}
      })

      // Should get a validation error
      expect(error).to.exist
      expect(error).to.include('Invalid')
    })
  })
})
