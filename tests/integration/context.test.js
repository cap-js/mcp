const cds = require('@sap/cds')
const { promisify } = require('util')
const { exec } = require('child_process')
const execAsync = promisify(exec)
const path = require('path')

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)
const bookshopPath = path.join(__dirname, '../bookshop')

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
    const { content, error } = await callTool('describe', { entity: 'Books' })
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
    
    // Should not have isAssociation or key fields
    expect(content.entities.Books.elements.ID.isAssociation).to.be.undefined
    expect(content.entities.Books.elements.ID.key).to.be.undefined
  })

  it('returns parameter details when action param is specified', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { action: 'sum' })
    expect(error).to.be.null
    // Should have parameters with types (without cds. prefix)
    expect(content.actions.sum.parameters).to.exist
    expect(content.actions.sum.parameters.x.type).to.equal('Integer')
    expect(content.actions.sum.parameters.y.type).to.equal('Integer')
    // Should have returns (without cds. prefix)
    expect(content.actions.sum.returns).to.equal('Integer')
  })

  it('combines @Common.Label + @Core.Description + @Core.LongDescription for entities and elements', async () => {
    const { callTool } = mcpClient()
    // Entity description (detail mode to also check elements)
    const { content, error } = await callTool('describe', { entity: 'Genres' })
    expect(error).to.be.null
    const entityDesc = content.entities.Genres.description
    expect(entityDesc).to.include('Genre Categories')
    expect(entityDesc).to.include('List of book genres')
    expect(entityDesc).to.include('\n\n')
    expect(entityDesc).to.include('Hierarchical classification system')

    // Element descriptions
    const { content: booksContent } = await callTool('describe', { entity: 'Books' })
    expect(booksContent.entities.Books.elements.title.description).to.include('Book Title')
    const stockDesc = booksContent.entities.Books.elements.stock.description
    expect(stockDesc).to.include('Current inventory count')
    expect(stockDesc).to.include('\n\n')
    expect(stockDesc).to.include('Number of copies available')
  })

  it('resolves @Core.Description > @description for actions and parameters', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { action: 'sum' })
    expect(error).to.be.null
    expect(content.actions.sum.description).to.equal('Add two integers')
    // Param x has @description, param y has @Core.Description
    expect(content.actions.sum.parameters.x.description).to.equal('First operand')
    expect(content.actions.sum.parameters.y.description).to.equal('Second operand')

    // Parameter without annotation returns null
    const { content: stockContent } = await callTool('describe', { action: 'stock' })
    expect(stockContent.actions.stock.parameters.id.description).to.be.null
  })

  it('resolves {i18n>key} references and respects Accept-Language header', async () => {
    // English locale - Books entity has @title: '{i18n>Books}'
    const { callTool: callToolEn } = mcpClient('/mcp/catalog', null, 'en')
    const { content: contentEn } = await callToolEn('describe', { entity: 'Books' })
    expect(contentEn.entities.Books.description).to.include('Books')

    // German locale - should resolve to 'Bücher'
    const { callTool: callToolDe } = mcpClient('/mcp/catalog', null, 'de')
    const { content: contentDe } = await callToolDe('describe', { entity: 'Books' })
    expect(contentDe.entities.Books.description).to.include('Bücher')
  })

  it('includes service description in MCP Server Card and describe tool', async () => {
    // Compile-time: MCP Server Card
    const { stdout } = await execAsync('cds compile srv/cat-service.cds -2 mcp', { cwd: bookshopPath })
    const serverCard = JSON.parse(stdout)
    expect(serverCard.description).to.include('Catalog service for browsing books')
    expect(serverCard.description).to.include('\n\n')
    expect(serverCard.description).to.include('Provides read access to the book catalog')

    // Runtime: describe tool
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.description).to.include('Catalog service for browsing books')
    expect(content.description).to.include('\n\n')
    expect(content.description).to.include('Provides read access to the book catalog')
  })
})
