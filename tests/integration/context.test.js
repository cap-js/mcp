const cds = require('@sap/cds')

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Context Resolution', () => {
  it('returns only descriptions in overview mode (no params)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    // Should have entity descriptions but no elements
    expect(content.entities.Books.description).to.exist
    expect(content.entities.Books.elements).to.be.undefined
    expect(content.entities.Books.queryLimits).to.be.undefined
    // Should have action descriptions but no parameters
    expect(content.actions.sum.kind).to.equal('function')
    expect(content.actions.sum.description).to.exist
    expect(content.actions.sum.parameters).to.be.undefined
    expect(content.actions.sum.returns).to.be.undefined
  })

  it('returns element details when entity param is specified', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // Should have elements with types
    expect(content.entities.Books.elements).to.exist
    expect(content.entities.Books.elements.ID.type).to.equal('Integer')
    expect(content.entities.Books.elements.title.type).to.equal('String')
    // Should have queryLimits
    expect(content.entities.Books.queryLimits).to.exist
    // Associations should have type, target, cardinality
    expect(content.entities.Books.elements.genre.type).to.equal('Association (1-1)')
    expect(content.entities.Books.elements.genre.target).to.equal('CatalogService.Genres')

    // Should not have isAssociation or key fields on elements
    expect(content.entities.Books.elements.ID.isAssociation).to.be.undefined
    expect(content.entities.Books.elements.ID.key).to.be.undefined
    // Key fields should be in a dedicated keys array on the entity
    expect(content.entities.Books.keys).to.be.an('array')
    expect(content.entities.Books.keys).to.include('ID')
  })

  it('returns parameter details when action param is specified', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum'] })
    expect(error).to.be.null
    // Should have parameters with types (without cds. prefix)
    expect(content.actions.sum.parameters).to.exist
    expect(content.actions.sum.parameters.x.type).to.equal('Integer')
    expect(content.actions.sum.parameters.y.type).to.equal('Integer')
    // Should have returns (without cds. prefix)
    expect(content.actions.sum.returns).to.equal('Integer')
  })

  it('resolves doc comment on services', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.description).to.include('Catalog service for browsing books')
  })

  it('resolves doc comment on entities', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Genres'] })
    expect(error).to.be.null
    expect(content.entities.Genres.description).to.include('Hierarchical classification system')
  })

  it('resolves @description on elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    expect(content.entities.Books.elements.ID.description).to.include('Unique book identifier')
  })

  it('resolves @description on functions', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum'] })
    expect(error).to.be.null
    expect(content.actions.sum.description).to.equal('Add two integers')
  })

  it('resolves @description on actions', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['add'] })
    expect(error).to.be.null
    expect(content.actions.add.description).to.equal('Add a value to an accumulator')
  })

  it('resolves @description on parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum'] })
    expect(error).to.be.null
    expect(content.actions.sum.parameters.x.description).to.equal('First operand')
    expect(content.actions.sum.parameters.y.description).to.equal('Second operand')
    // stock.id has no annotation or doc — should return null
    const { content: stockContent } = await callTool('describe', { actions: ['stock'] })
    expect(stockContent.actions.stock.parameters.id.description).to.be.null
  })

  it('resolves @mandatory as notNull for action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['submitOrder'] })
    expect(error).to.be.null
    expect(content.actions.submitOrder.parameters.book.notNull).to.be.true
    expect(content.actions.submitOrder.parameters.quantity.notNull).to.be.false
  })

  it('resolves @mandatory as notNull for entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // title has @mandatory in schema.cds
    expect(content.entities.Books.elements.title.notNull).to.be.true
    // stock has no @mandatory
    expect(content.entities.Books.elements.stock).to.not.have.property('notNull')
  })

  it('resolves enum values on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    const status = content.entities.Books.elements.status
    expect(status.enum).to.deep.equal({ available: 'A', out_of_stock: 'O', discontinued: 'D' })
  })

  it('resolves enum values on action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['submitOrder'] })
    expect(error).to.be.null
    expect(content.actions.submitOrder.parameters.priority.enum).to.deep.equal({
      standard: 'S',
      express: 'E'
    })
  })

  it('resolves @assert.range on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // Closed range: stock @assert.range: [0, 999] → human-readable format
    expect(content.entities.Books.elements.stock.range).to.equal('[0, 999]')
  })

  it('resolves @assert.range with open intervals on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // Open interval: discount @assert.range: [(0), (100)] → exclusive on both
    expect(content.entities.Books.elements.discount.range).to.equal('(0, 100)')
  })

  it('resolves @assert.range with infinity on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // Infinity: markup @assert.range: [(0), _] → positive numbers only
    expect(content.entities.Books.elements.markup.range).to.equal('(0, +∞)')
  })

  it('resolves @assert.range for date/time on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    // Date range: publishedAt @assert.range: ['2000-01-01T00:00:00Z', '2099-12-31T23:59:59Z']
    expect(content.entities.Books.elements.publishedAt.range).to.equal(
      '[2000-01-01T00:00:00Z, 2099-12-31T23:59:59Z]'
    )
  })

  it('resolves @assert.range on action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['submitOrder'] })
    expect(error).to.be.null
    expect(content.actions.submitOrder.parameters.quantity.range).to.equal('[1, 100]')
  })

  it('resolves @assert.range with open intervals on action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['applyDiscount'] })
    expect(error).to.be.null
    // percentage: @assert.range: [(0), (100)]
    expect(content.actions.applyDiscount.parameters.percentage.range).to.equal('(0, 100)')
    // markup: @assert.range: [(0), _]
    expect(content.actions.applyDiscount.parameters.markup.range).to.equal('(0, +∞)')
    // effectiveDate: @assert.range: ['2020-01-01T00:00:00Z', '2030-12-31T23:59:59Z']
    expect(content.actions.applyDiscount.parameters.effectiveDate.range).to.equal(
      '[2020-01-01T00:00:00Z, 2030-12-31T23:59:59Z]'
    )
  })

  it('resolves @assert.format on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    expect(content.entities.Books.elements.isbn.format).to.equal('/^[0-9]{13}$/')
  })

  it('resolves @assert.format on action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['validateEmail'] })
    expect(error).to.be.null
    expect(content.actions.validateEmail.parameters.email.format).to.equal('/^\\S+@\\S+\\.\\S+$/')
  })

  it('resolves array of scalar type on parameters (many String)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withArrayParams'] })
    expect(error).to.be.null
    expect(content.actions.withArrayParams.parameters.manyStringParam.type).to.equal(
      'Array of String'
    )
    expect(content.actions.withArrayParams.parameters.arrayOfStringParam.type).to.equal(
      'Array of String'
    )
  })

  it('resolves array of inline struct type on parameters (many {...})', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withArrayParams'] })
    expect(error).to.be.null
    expect(content.actions.withArrayParams.parameters.manyStructParam.type).to.equal(
      'Array of {name: String, value: Integer}'
    )
  })

  it('resolves array of custom type on parameters (many CustomType)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withArrayParams'] })
    expect(error).to.be.null
    expect(content.actions.withArrayParams.parameters.customTypeParam.type).to.equal(
      'Array of {ID: String, abc: String, def: DateTime, prop1: String}'
    )
    expect(content.actions.withArrayParams.parameters.customTypeParam.description).to.equal(
      'A many custom type parameter'
    )
  })

  it('resolves array of custom type on dedicated action (many CustomType)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withManyCustomTypes'] })
    expect(error).to.be.null
    expect(content.actions.withManyCustomTypes.parameters.updates.type).to.equal(
      'Array of {ID: String, abc: String, def: DateTime, prop1: String}'
    )
  })

  it('resolves scalar custom type alias on parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withCustomTypes'] })
    expect(error).to.be.null
    expect(content.actions.withCustomTypes.parameters.prop1.type).to.equal('String')
  })

  it('resolves structured custom type on returns', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withCustomTypes'] })
    expect(error).to.be.null
    expect(content.actions.withCustomTypes.returns).to.equal(
      '{ID: String, abc: String, def: DateTime, prop1: String}'
    )
  })

  it('resolves array of structured custom type on returns', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withManyCustomTypes'] })
    expect(error).to.be.null
    expect(content.actions.withManyCustomTypes.returns).to.equal(
      'Array of {ID: String, abc: String, def: DateTime, prop1: String}'
    )
  })

  it('resolves array of inline struct on returns', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['withMany'] })
    expect(error).to.be.null
    expect(content.actions.withMany.returns).to.equal('Array of {ID: String}')
  })

  it('resolves {i18n>key} references and respects Accept-Language header', async () => {
    // English locale - Books entity has @title: '{i18n>Books}'
    const { callTool: callToolEn } = mcpClient('/mcp/catalog', null, 'en')
    const { content: contentEn } = await callToolEn('describe', { entities: ['Books'] })
    expect(contentEn.entities.Books.description).to.include('Books')

    // German locale - should resolve to 'Bücher'
    const { callTool: callToolDe } = mcpClient('/mcp/catalog', null, 'de')
    const { content: contentDe } = await callToolDe('describe', { entities: ['Books'] })
    expect(contentDe.entities.Books.description).to.include('Bücher')
  })
})
