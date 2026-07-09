const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Draft Tools', () => {
  // AdminService.Books is @odata.draft.enabled
  const client = () => mcpClient('/mcp/admin', 'alice:')

  describe('tools/list', () => {
    it('registers draft tools for draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('activate-books')
      expect(toolNames).to.include('edit-books')
      expect(toolNames).to.include('create-books')
      expect(toolNames).to.include('update-books')
      expect(toolNames).to.include('discard-books')
    })

    it('registers composition child tools', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      // Books has composition 'chapters' -> should generate chapter tools
      expect(toolNames).to.include('create-chapter')
      expect(toolNames).to.include('update-chapter')
      expect(toolNames).to.include('discard-chapter')
    })

    it('does not register draft tools for non-draft entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.not.include('activate-authors')
      expect(toolNames).to.not.include('create-authors')
      expect(toolNames).to.not.include('activate-genres')
    })

    it('activate tool has key parameter schema', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('ID')
    })

    it('activate tool is flagged with _meta.requiresHITL for agent plugins', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-books')
      expect(tool).to.exist
      expect(tool._meta).to.exist
      expect(tool._meta.requiresHITL).to.equal(true)
    })

    it('non-activate tools do not carry requiresHITL', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const create = response.result.tools.find((t) => t.name === 'create-books')
      const update = response.result.tools.find((t) => t.name === 'update-books')
      expect(create._meta?.requiresHITL).to.not.equal(true)
      expect(update._meta?.requiresHITL).to.not.equal(true)
    })

    it('agent plugin can filter HITL-required tools from tools/list', async () => {
      // Simulates how deepagents interruptOn would discover HITL tools
      const { mcp } = client()
      const response = await mcp('tools/list')
      const hitlToolNames = response.result.tools
        .filter((t) => t._meta?.requiresHITL === true)
        .map((t) => t.name)
      // Only activate-* tools should surface as HITL-required
      expect(hitlToolNames.length).to.be.greaterThan(0)
      for (const name of hitlToolNames) {
        expect(name.startsWith('activate-')).to.equal(true)
      }
    })

    it('create tool has writable field parameters', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('title')
      expect(tool.inputSchema.properties).to.have.property('stock')
      // Should NOT include draft/managed fields or keys
      expect(tool.inputSchema.properties).to.not.have.property('IsActiveEntity')
      expect(tool.inputSchema.properties).to.not.have.property('DraftAdministrativeData')
      expect(tool.inputSchema.properties).to.not.have.property('createdAt')
      expect(tool.inputSchema.properties).to.not.have.property('ID')
    })

    it('update tool has key + writable field parameters', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'update-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('ID')
      expect(tool.inputSchema.properties).to.have.property('title')
    })

    it('child create tool has parent key + writable params', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-chapter')
      expect(tool).to.exist
      // Should have parent key (Books.ID)
      expect(tool.inputSchema.properties).to.have.property('ID')
      // Should have writable child fields
      expect(tool.inputSchema.properties).to.have.property('title')
      // Should NOT have draft elements
      expect(tool.inputSchema.properties).to.not.have.property('IsActiveEntity')
    })
  })

  describe('draft lifecycle execution', () => {
    it('creates a new draft', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('create-books', {
        title: 'Test Draft Book',
        stock: 42,
        author_ID: 101
      })
      expect(error).to.be.null
      expect(content).to.exist
      expect(content.action).to.equal('create-books')
    })

    it('update tool invokes handler with correct args', async () => {
      const { callTool } = client()
      // Will fail at DB level (no draft with ID=999) but should NOT fail at schema validation
      const { error } = await callTool('update-books', {
        ID: 999,
        title: 'Updated Title'
      })
      // Error from DB (no row found) is acceptable; schema validation error is not
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('activate tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('activate-books', { ID: 999 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('edit tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('edit-books', { ID: 201 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('discard tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('discard-books', { ID: 999 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child create tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('create-chapter', {
        ID: 201,
        title: 'New Chapter'
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child update tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('update-chapter', {
        ID: 201,
        title: 'Updated Chapter'
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child discard tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('discard-chapter', {
        ID: 201
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })
  })

  describe('readonly entities', () => {
    it('does not register create tool for @readonly draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      // ReadOnlyAuthors is @readonly @odata.draft.enabled — no create tool
      expect(toolNames).to.not.include('create-read-only-author')
      // But other draft tools should still exist (activate, edit, update, discard)
      expect(toolNames).to.include('activate-read-only-authors')
      expect(toolNames).to.include('edit-read-only-authors')
      expect(toolNames).to.include('update-read-only-authors')
      expect(toolNames).to.include('discard-read-only-authors')
    })

    it('still registers create tool for non-readonly draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('create-books')
    })
  })

  describe('prefix handling', () => {
    it('draft tools are prefixed when cds.env.mcp.prefix is enabled', async () => {
      const originalValue = cds.env.mcp?.prefix
      cds.env.mcp ??= {}
      cds.env.mcp.prefix = true

      try {
        const { mcp } = client()
        const response = await mcp('tools/list')
        const toolNames = response.result.tools.map((t) => t.name)
        expect(toolNames).to.include('admin_activate-books')
        expect(toolNames).to.include('admin_edit-books')
        expect(toolNames).to.include('admin_create-books')
        expect(toolNames).to.include('admin_update-books')
        expect(toolNames).to.include('admin_discard-books')
        // Without prefix should not exist
        expect(toolNames).to.not.include('activate-books')
      } finally {
        if (originalValue === undefined) delete cds.env.mcp.prefix
        else cds.env.mcp.prefix = originalValue
      }
    })
  })
})
