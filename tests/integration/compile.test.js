const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')

const execAsync = promisify(exec)
const bookshopPath = path.join(__dirname, '../bookshop')

describe('cds compile -2 mcp', () => {
  describe('basic compilation', () => {
    it('returns valid JSON output', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      expect(result.version).toBe('1.0')
      expect(result.services).toBeDefined()
    })

    it('throws when no MCP services found', async () => {
      await expect(
        execAsync('cds compile db/schema.cds -2 mcp', { cwd: bookshopPath })
      ).rejects.toThrow(/No MCP services found/)
    })
  })

  describe('default mode (generic tools)', () => {
    it('generates read_query tool', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).toContain('read_query')
    })

    it('generates describe_model tool', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).toContain('describe_model')
    })

    it('does not generate per-entity tools', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).not.toContain('read_Books')
      expect(toolNames).not.toContain('read_Genres')
    })

    it('read_query has entity enum with available entities', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      const readQuery = result.services.CatalogService.tools.find(t => t.name === 'read_query')
      const entityEnum = readQuery.inputSchema.properties.entity.enum
      expect(entityEnum).toContain('Books')
      expect(entityEnum).toContain('Genres')
    })
  })

  describe('per-entity mode', () => {
    const perEntityEnv = { 
      ...process.env, 
      CDS_CONFIG: JSON.stringify({ features: { mcp_per_entity_tool: true } })
    }

    it('generates read_<Entity> tools', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { 
        cwd: bookshopPath, 
        env: perEntityEnv 
      })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).toContain('read_Books')
      expect(toolNames).toContain('read_Genres')
    })

    it('generates describe_model tool', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { 
        cwd: bookshopPath, 
        env: perEntityEnv 
      })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).toContain('describe_model')
    })

    it('does not generate read_query tool', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { 
        cwd: bookshopPath, 
        env: perEntityEnv 
      })
      const result = JSON.parse(stdout)
      const toolNames = result.services.CatalogService.tools.map(t => t.name)
      expect(toolNames).not.toContain('read_query')
    })
  })

  describe('input schema structure', () => {
    it('has filter, select, limit, orderBy, sort properties', async () => {
      const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
      const result = JSON.parse(stdout)
      const readQuery = result.services.CatalogService.tools.find(t => t.name === 'read_query')
      const props = readQuery.inputSchema.properties
      expect(props).toHaveProperty('filter')
      expect(props).toHaveProperty('select')
      expect(props).toHaveProperty('limit')
      expect(props).toHaveProperty('orderBy')
      expect(props).toHaveProperty('sort')
    })
  })
})
