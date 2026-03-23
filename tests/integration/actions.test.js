const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('call_action tool', () => {
  describe('tool listing', () => {
    it('includes call_action tool with proper schema', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const callActionTool = response.result.tools.find(t => t.name === 'call_action')
      expect(callActionTool).to.have.property('description')
      expect(callActionTool).to.have.property('inputSchema')
      expect(callActionTool.inputSchema.properties).to.have.property('action')
      expect(callActionTool.inputSchema.properties).to.have.property('parameters')
    })

    it('lists available actions in action enum', async () => {
      const { mcp } = mcpClient()
      const response = await mcp('tools/list')
      const callActionTool = response.result.tools.find(t => t.name === 'call_action')
      const actionEnum = callActionTool.inputSchema.properties.action.enum
      expect(actionEnum).to.include('sum')
      expect(actionEnum).to.include('stock')
      expect(actionEnum).to.include('add')
      expect(actionEnum).to.include('submitOrder')
    })
  })

  describe('calling functions', () => {
    it('calls sum function with two integers', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'sum',
        parameters: { x: 3, y: 5 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('sum')
      expect(content.kind).to.equal('function')
      expect(content.result).to.equal(8)
    })

    it('sum returns 0 with no parameters', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'sum'
      })
      expect(error).to.be.null
      expect(content.result).to.equal(0)
    })

    it('sum handles partial parameters', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'sum',
        parameters: { x: 10 }
      })
      expect(error).to.be.null
      expect(content.result).to.equal(10)
    })

    it('calls stock function to get book stock', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'stock',
        parameters: { id: 201 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('stock')
      expect(content.kind).to.equal('function')
      expect(content.result).to.equal(12) // Book 201 has stock=12
    })

    it('stock returns 0 for non-existent book', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'stock',
        parameters: { id: 9999 }
      })
      expect(error).to.be.null
      expect(content.result).to.equal(0)
    })
  })

  describe('calling actions', () => {
    it('calls add action', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'add',
        parameters: { x: 10, to: 5 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('add')
      expect(content.kind).to.equal('action')
      expect(content.result).to.equal(15)
    })

    it('add returns 0 with no parameters', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('call_action', {
        action: 'add'
      })
      expect(error).to.be.null
      expect(content.result).to.equal(0)
    })
  })

  describe('error handling', () => {
    it('returns error for unknown action', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('call_action', {
        action: 'nonExistentAction'
      })
      expect(error).to.match(/not found|invalid/i)
    })
  })
})

describe('call_action authorization', () => {
  describe('AdminService (requires admin role)', () => {
    it('includes sum, stock, add actions for admin user', async () => {
      const { mcp } = mcpClient('/mcp/admin', 'alice:')
      const response = await mcp('tools/list')
      const callActionTool = response.result.tools.find(t => t.name === 'call_action')
      const actionEnum = callActionTool.inputSchema.properties.action.enum
      expect(actionEnum).to.include('sum')
      expect(actionEnum).to.include('stock')
      expect(actionEnum).to.include('add')
    })

    it('admin can call sum function', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('call_action', {
        action: 'sum',
        parameters: { x: 100, y: 200 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('sum')
      expect(content.result).to.equal(300)
    })

    it('admin can call stock function', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('call_action', {
        action: 'stock',
        parameters: { id: 252 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('stock')
      expect(content.result).to.equal(555) // Book 252 has stock=555
    })

    it('admin can call add action', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('call_action', {
        action: 'add',
        parameters: { x: 7, to: 3 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('add')
      expect(content.result).to.equal(10)
    })

    it('rejects unauthenticated call_action with 401', async () => {
      const { mcp } = mcpClient('/mcp/admin')
      const response = await mcp('tools/call', {
        name: 'call_action',
        arguments: { action: 'sum', parameters: { x: 1, y: 2 } }
      })
      expect(response.error).to.exist
      expect(response.error.code).to.equal(-32001)
      expect(response.error.message).to.match(/401/i)
    })

    it('rejects unauthorized user call_action with 403', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('call_action', {
        action: 'sum',
        parameters: { x: 1, y: 2 }
      })
      expect(error).to.match(/403/i)
    })
  })
})

describe('RestrictedService action authorization', () => {
  // RestrictedService has add action with @requires: 'admin'
  // alice has admin role, bob has editor role

  describe('tool listing', () => {
    it('includes add in action enum for admin', async () => {
      const { mcp } = mcpClient('/mcp/restricted', 'alice:')
      const response = await mcp('tools/list')
      const callActionTool = response.result.tools.find(t => t.name === 'call_action')
      const actionEnum = callActionTool.inputSchema.properties.action.enum
      expect(actionEnum).to.include('add')
    })

    it('does not list call_action tool for non-admin user (bob)', async () => {
      // bob has editor role but add requires admin
      const { mcp } = mcpClient('/mcp/restricted', 'bob:')
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('call_action')
    })
  })

  describe('action execution', () => {
    it('admin (alice) can call add action', async () => {
      const { callTool } = mcpClient('/mcp/restricted', 'alice:')
      const { content, error } = await callTool('call_action', {
        action: 'add',
        parameters: { x: 25, to: 75 }
      })
      expect(error).to.be.null
      expect(content.action).to.equal('add')
      expect(content.result).to.equal(100)
    })

    it('unauthenticated user cannot see call_action tool', async () => {
      // Unauthenticated users have no accessible actions
      const { mcp } = mcpClient('/mcp/restricted')
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('call_action')
    })
  })
})
