const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')

const execAsync = promisify(exec)
const bookshopPath = path.join(__dirname, '../bookshop')

describe('cds compile -2 mcp', () => {
  it('matches expected server card structure', async () => {
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    const expected = require('../bookshop/expected-catalog-service-card.json')

    expect(result).toEqual(expected)
  })

  it('throws when no services found', async () => {
    await expect(
      execAsync('cds compile db/schema.cds -2 mcp', { cwd: bookshopPath })
    ).rejects.toThrow(/No service definitions found/)
  })

  it('throws when multiple services without -s flag', async () => {
    await expect(
      execAsync('cds compile srv -2 mcp', { cwd: bookshopPath })
    ).rejects.toThrow(/Found multiple service definitions/)
  })

  it('lists available services in error message', async () => {
    try {
      await execAsync('cds compile srv -2 mcp', { cwd: bookshopPath })
      fail('Expected error to be thrown')
    } catch (err) {
      expect(err.message).toMatch(/-s CatalogService/)
      expect(err.message).toMatch(/-s AdminService/)
    }
  })

  it('compiles specific service with -s flag', async () => {
    const { stdout } = await execAsync('cds compile srv -2 mcp -s CatalogService', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    expect(result.name).toBe('<namespace>/catalog')
  })

  it('throws for non-existent service', async () => {
    await expect(
      execAsync('cds compile srv/cat-service.cds -2 mcp -s NonExistent', { cwd: bookshopPath })
    ).rejects.toThrow(/No service definition matching NonExistent/)
  })

  it('generates correct path for CatalogService', async () => {
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('<baseUrl>/mcp/catalog')
  })

  it('generates correct path for AdminService', async () => {
    const { stdout } = await execAsync('cds compile srv -2 mcp -s AdminService', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('<baseUrl>/mcp/admin')
  })

  it('generates correct path for RestrictedService', async () => {
    const { stdout } = await execAsync('cds compile srv -2 mcp -s RestrictedService', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('<baseUrl>/mcp/restricted')
  })

  it('generates query and describe tools in default mode', async () => {
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    const toolNames = result.tools.map(t => t.name)
    expect(toolNames).toContain('query')
    expect(toolNames).toContain('describe')
    expect(toolNames).not.toContain('read_Books')
  })

  it('generates read_<Entity> tools in per-entity mode', async () => {
    const perEntityEnv = { 
      ...process.env, 
      CDS_CONFIG: JSON.stringify({ features: { mcp_per_entity_tool: true } })
    }
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { 
      cwd: bookshopPath, 
      env: perEntityEnv 
    })
    const result = JSON.parse(stdout)
    const toolNames = result.tools.map(t => t.name)
    expect(toolNames).toContain('read_Books')
    expect(toolNames).toContain('read_Genres')
    expect(toolNames).toContain('describe')
    expect(toolNames).not.toContain('query')
  })
})
