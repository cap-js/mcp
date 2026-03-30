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
    expect(content.actions.submitOrder.parameters.priority.enum).to.deep.equal({ standard: 'S', express: 'E' })
  })

  it('resolves @assert.range on entity elements', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    expect(content.entities.Books.elements.stock.range).to.deep.equal([0, 999])
  })

  it('resolves @assert.range on action parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['submitOrder'] })
    expect(error).to.be.null
    expect(content.actions.submitOrder.parameters.quantity.range).to.deep.equal([1, 100])
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
