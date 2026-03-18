const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
cds.env.features.mcp_per_action_tool = true

const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Per-Action Tools', () => {
  describe('tools/list', () => {
    it('has per-action tools (sum, stock, add)', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('call_action')
      expect(toolNames).to.include('sum')
      expect(toolNames).to.include('stock')
      expect(toolNames).to.include('add')
    })

    it('has describe tool', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('describe')
    })

    it('sum tool has proper schema with typed parameters', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const sumTool = response.result.tools.find(t => t.name === 'sum')
      expect(sumTool).to.exist
      expect(sumTool.description).to.equal('Add two integers. Returns: Integer')
      expect(sumTool.inputSchema.properties).to.have.property('x')
      expect(sumTool.inputSchema.properties).to.have.property('y')
      expect(sumTool.inputSchema.properties.x.type).to.equal('integer')
      expect(sumTool.inputSchema.properties.y.type).to.equal('integer')
    })

    it('stock tool has proper schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const stockTool = response.result.tools.find(t => t.name === 'stock')
      expect(stockTool).to.exist
      expect(stockTool.description).to.equal('Get current stock for a book. Returns: Integer')
      expect(stockTool.inputSchema.properties).to.have.property('id')
      expect(stockTool.inputSchema.properties.id.type).to.equal('integer')
    })

    it('add tool has proper schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const addTool = response.result.tools.find(t => t.name === 'add')
      expect(addTool).to.exist
      expect(addTool.description).to.equal('Add a value to an accumulator. Returns: Integer')
      expect(addTool.inputSchema.properties).to.have.property('x')
      expect(addTool.inputSchema.properties).to.have.property('to')
    })

    it('function tools have readOnlyHint true', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const sumTool = response.result.tools.find(t => t.name === 'sum')
      const stockTool = response.result.tools.find(t => t.name === 'stock')
      expect(sumTool.annotations.readOnlyHint).to.be.true
      expect(sumTool.annotations.idempotentHint).to.be.true
      expect(stockTool.annotations.readOnlyHint).to.be.true
      expect(stockTool.annotations.idempotentHint).to.be.true
    })

    it('action tools have destructiveHint true', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const addTool = response.result.tools.find(t => t.name === 'add')
      expect(addTool.annotations.destructiveHint).to.be.true
      expect(addTool.annotations.readOnlyHint).to.be.false
    })

    it('marks @mandatory params as required in input schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const submitOrderTool = response.result.tools.find(t => t.name === 'submitOrder')
      expect(submitOrderTool).to.exist
      // book param has @mandatory — should be required
      expect(submitOrderTool.inputSchema.required).to.include('book')
      // quantity param has no @mandatory — should not be required
      expect(submitOrderTool.inputSchema.required || []).to.not.include('quantity')
    })
  })

})
