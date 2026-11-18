const cds = require('@sap/cds')
const z = require('zod')
const { createPerActionInputSchema } = require('../../lib/utils/cds-to-schema')

const { exec } = require('child_process')
const { promisify } = require('util')
const path = require('path')

const execAsync = promisify(exec)
const bookshopPath = path.join(__dirname, '../bookshop')

describe('cds compile -2 mcp', () => {
  it('matches expected server card snapshot', async () => {
    // to regenerate snapshots: npm run generate:snapshots
    const { stdout } = await execAsync('cds c srv -s CatalogService -2 mcp', { cwd: bookshopPath })
    const result = JSON.parse(stdout)
    const expected = require(path.join(bookshopPath, '__snapshots__/catalog-service-card.json'))

    expect(result).toEqual(expected)
  })

  it('throws when no services found', async () => {
    await expect(
      execAsync('cds compile db/schema.cds -2 mcp', { cwd: bookshopPath })
    ).rejects.toThrow(/No service definitions found/)
  })

  it('throws when multiple services without -s flag', async () => {
    await expect(execAsync('cds compile srv -2 mcp', { cwd: bookshopPath })).rejects.toThrow(
      /Found multiple service definitions/
    )
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
    const { stdout } = await execAsync('cds compile srv -2 mcp -s CatalogService', {
      cwd: bookshopPath
    })
    const result = JSON.parse(stdout)
    expect(result.name).toBe('sap.cds.services/catalog')
  })

  it('throws for non-existent service', async () => {
    await expect(
      execAsync('cds compile srv/cat-service.cds -2 mcp -s NonExistent', { cwd: bookshopPath })
    ).rejects.toThrow(/No service definition matching NonExistent/)
  })

  it('generates correct path for CatalogService', async () => {
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', {
      cwd: bookshopPath
    })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('/mcp/catalog')
  })

  it('generates correct path for AdminService', async () => {
    const { stdout } = await execAsync('cds compile srv -2 mcp -s AdminService', {
      cwd: bookshopPath
    })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('/mcp/admin')
  })

  it('generates correct path for RestrictedService', async () => {
    const { stdout } = await execAsync('cds compile srv -2 mcp -s RestrictedService', {
      cwd: bookshopPath
    })
    const result = JSON.parse(stdout)
    expect(result.remotes[0].url).toBe('/mcp/restricted')
  })

  it('generates query and describe tools in default mode', async () => {
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', {
      cwd: bookshopPath
    })
    const result = JSON.parse(stdout)
    const toolNames = result.tools.map((t) => t.name)
    expect(toolNames).toContain('query')
    expect(toolNames).toContain('describe')
  })
})

describe('nested action parameter constraints', () => {
  let schema

  beforeAll(async () => {
    const model = cds.compile.for.nodejs(
      await cds.load(__dirname + '/../bookshop/srv/nested-schema-service.cds')
    )
    schema = createPerActionInputSchema(model.definitions['NestedSchemaService.apply'], model)
  })
  const factor = { category: 'CLCH', value: 10, unit: 'KG' }
  const input = (changes = {}) => ({ entries: [{ factors: [{ ...factor, ...changes }] }] })

  it('exposes enum, required fields, descriptions, range and format inside nested arrays', () => {
    const json = z.toJSONSchema(schema)
    const entry = json.properties.entries.items
    const nested = entry.properties.factors.items
    expect(json.required).toEqual(['entries'])
    expect(entry.required).toEqual(['factors'])
    expect(nested.required).toEqual(['category', 'value'])
    expect(nested.properties.category.enum).toEqual(['CLCH'])
    expect(nested.properties.category.description).toContain('ClimateChange=CLCH')
    expect(nested.properties.value).toMatchObject({
      minimum: 0,
      maximum: 100,
      description: 'Factor value'
    })
    expect(nested.properties.unit.pattern).toBe('^[A-Z]{2,3}$')
    expect(json.properties.settings.properties.category.enum).toEqual(['CLCH'])
    expect(json.properties.category.enum).toEqual(['CLCH'])
  })

  it('accepts valid input and optional fields', () => {
    expect(schema.safeParse(input()).success).toBe(true)
    expect(schema.safeParse(input({ value: 0, unit: undefined })).success).toBe(true)
    expect(schema.safeParse(input({ value: 100 })).success).toBe(true)
  })

  it.each([
    { category: 'ADPF' },
    { category: undefined },
    { value: undefined },
    { value: -1 },
    { value: 101 },
    { unit: 'kg' }
  ])('rejects invalid nested field %j', (changes) => {
    expect(schema.safeParse(input(changes)).success).toBe(false)
  })

  it('rejects missing nested arrays and invalid inline structures', () => {
    expect(schema.safeParse({ entries: [{}] }).success).toBe(false)
    expect(schema.safeParse({ ...input(), settings: { category: 'ADPF' } }).success).toBe(false)
  })
})
