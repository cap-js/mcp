const cds = require('@sap/cds')
const { executeDescribe } = require('../../lib/tools/describe')

describe('nested action parameter descriptions', () => {
  const model = cds.linked(
    cds.compile.for.nodejs(
      cds.parse.cdl(`
        service DescribeService {
          type Category: String enum { ClimateChange = 'CLCH'; };
          type Factor {
            @mandatory category: Category;
            value: Decimal @mandatory @assert.range: [0, 100] @description: 'Factor value';
            unit: String @assert.format: '^[A-Z]{2,3}$';
            comment: String;
          };
          action apply(
            @mandatory entries: many { @mandatory factors: many Factor; },
            settings: { category: Category; },
            category: Category
          );
        }
      `)
    )
  )
  const srv = { name: 'DescribeService', definition: model.definitions.DescribeService, model }
  const actions = { apply: model.definitions['DescribeService.apply'] }
  const describeAction = () =>
    executeDescribe(srv, {}, actions, { actions: ['apply'] }, { log: () => {} })

  it('includes nested enum and constraints for inline arrays and named structures', async () => {
    const result = await describeAction()
    const parameters = result.structuredContent.actions.apply.parameters
    const entries = parameters.entries
    const factors = entries.items.elements.factors
    expect(entries.notNull).toBe(true)
    expect(factors.notNull).toBe(true)
    expect(factors.items.elements.category).toMatchObject({
      type: 'String',
      notNull: true,
      enum: { ClimateChange: 'CLCH' }
    })
    expect(factors.items.elements.value).toMatchObject({
      notNull: true,
      range: '[0, 100]',
      description: 'Factor value'
    })
    expect(factors.items.elements.unit.format).toBe('^[A-Z]{2,3}$')
    expect(factors.items.elements.comment.notNull).toBe(false)
    expect(parameters.settings.elements.category.enum).toEqual({ ClimateChange: 'CLCH' })
    expect(parameters.category.enum).toEqual({ ClimateChange: 'CLCH' })
    expect(result.content[0].text).toContain('ClimateChange')
    expect(result.content[0].text).toContain('CLCH')
  })

  it('preserves existing type strings and top-level parameter metadata', async () => {
    const parameters = (await describeAction()).structuredContent.actions.apply.parameters
    expect(parameters.entries.type).toBe(
      'Array of {factors: Array of {category: String, value: Decimal, unit: String, comment: String}}'
    )
    expect(parameters.category).toEqual({
      type: 'String',
      notNull: false,
      description: null,
      enum: { ClimateChange: 'CLCH' }
    })
  })

  it('keeps overview responses concise', async () => {
    const result = await executeDescribe(srv, {}, actions, {}, { log: () => {} })
    expect(result.structuredContent.actions.apply.parameters).toBeUndefined()
  })

  it('bounds recursive type expansion', async () => {
    const recursiveModel = { definitions: { Node: { elements: { next: { type: 'Node' } } } } }
    const result = await executeDescribe(
      { ...srv, model: recursiveModel },
      {},
      { recursive: { kind: 'action', params: { node: { type: 'Node' } } } },
      { actions: ['recursive'] },
      { log: () => {} }
    )
    let node = result.structuredContent.actions.recursive.parameters.node
    let depth = 0
    while (node.elements) {
      node = node.elements.next
      depth++
    }
    expect(depth).toBe(cds.env.mcp?.type_depth_limit ?? 20)
  })
})
