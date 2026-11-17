const cds = require('@sap/cds')
const z = require('zod')
const { createPerActionInputSchema } = require('../../lib/utils/cds-to-schema')

describe('nested action parameter constraints', () => {
  const model = cds.linked(
    cds.compile.for.nodejs(
      cds.parse.cdl(`
    service TestService {
      type Factor {
        @mandatory category: String enum { ClimateChange = 'CLCH'; };
        value: Decimal @mandatory @assert.range: [0, 100] @description: 'Factor value';
        unit: String @assert.format: '^[A-Z]{2,3}$';
        comment: String;
      };
      action apply(
        @mandatory entries: many { @mandatory factors: many Factor; },
        settings: { category: String enum { ClimateChange = 'CLCH'; }; },
        category: String enum { ClimateChange = 'CLCH'; }
      );
    }
  `)
    )
  )
  const schema = createPerActionInputSchema(model.definitions['TestService.apply'], model)
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
