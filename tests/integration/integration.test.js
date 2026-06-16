const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('MCP Protocol', () => {
  it('responds to initialize request', async () => {
    const { initialize } = mcpClient()
    const response = await initialize()
    expect(response.result).to.exist
    expect(response.result.protocolVersion).to.be.a('string')
    expect(response.result.serverInfo).to.have.property('name')
    expect(response.result.serverInfo).to.have.property('description', 'Catalog service for browsing books.\nProvides read access to the book catalog including genres and author information.')
  })

  it('returns custom @mcp.instructions in initialize response', async () => {
    const { initialize } = mcpClient()
    const response = await initialize()
    expect(response.result.instructions).to.equal(
      'Use describe to explore available books, genres, and actions. Use query to search the catalog. Use call_action to place orders or perform calculations.'
    )
  })

  it('returns default instructions when @mcp.instructions is not set', async () => {
    const { initialize } = mcpClient('/mcp/admin', 'alice:')
    const response = await initialize()
    expect(response.result.instructions).to.equal(
      "Use the 'describe' tool to explore the data model and available actions/functions. Then use 'query' to read data or 'call_action' to invoke actions or functions."
    )
  })

  it('handles invalid JSON body gracefully', async () => {
    const response = await fetch(`${test.url}/mcp/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not valid json {'
    })

    // Server should not crash - should return an error response
    expect(response.status).to.equal(400)

    const result = await response.json()
    expect(result.jsonrpc).to.equal('2.0')
    expect(result.error).to.exist
    expect(result.id).to.be.null
  })

  it('lists query and describe tools', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.include('query')
    expect(toolNames).to.include('describe')
  })

  it('does not have per-entity tools by default', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.not.include('query_Books')
    expect(toolNames).to.not.include('query_Genres')
  })

  it('includes tool descriptions and input schemas', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const readQueryTool = response.result.tools.find(t => t.name === 'query')
    expect(readQueryTool).to.have.property('description')
    expect(readQueryTool).to.have.property('inputSchema')
    expect(readQueryTool.inputSchema).to.have.property('properties')
  })
})

describe('describe', () => {
  // NOTE: Basic describe behavior (overview mode, element metadata, associations,
  // action kinds, return types, descriptions) is covered in context.test.js

  it('identifies compositions', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    const chapterElement = content.entities.Books.elements.chapters
    expect(chapterElement.type).to.equal('Composition (1-*)')
    expect(chapterElement).to.have.property('target')
  })

  it('excludes draft elements from draft-enabled entities', async () => {
    const { callTool } = mcpClient('/mcp/admin', 'alice:')
    const { content, error } = await callTool('describe', { entities: ['Books'] })
    expect(error).to.be.null
    const elementNames = Object.keys(content.entities.Books.elements)
    expect(elementNames).to.include('ID')
    expect(elementNames).to.include('title')
    expect(elementNames).to.not.include('IsActiveEntity')
    expect(elementNames).to.not.include('HasActiveEntity')
    expect(elementNames).to.not.include('HasDraftEntity')
    expect(elementNames).to.not.include('DraftAdministrativeData')
    expect(elementNames).to.not.include('DraftAdministrativeData_DraftUUID')
    expect(elementNames).to.not.include('SiblingEntity')
  })

  it('excludes localized elements from entities', async () => {
    const { callTool } = mcpClient()
    // Genres inherits from sap.common.CodeList which has localized name/descr
    const { content, error } = await callTool('describe', { entities: ['Genres'] })
    expect(error).to.be.null
    const elementNames = Object.keys(content.entities.Genres.elements)
    expect(elementNames).to.include('name')
    expect(elementNames).to.not.include('localized')
    expect(elementNames).to.not.include('texts')
  })

  it('does not include autoexposed composition targets in overview', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    const entityNames = Object.keys(content.entities)
    // Books.chapters is @cds.autoexposed (composition target) - should be filtered out
    expect(entityNames).to.not.include('Books.chapters')
    // Entities with @cds.autoexpose (CodeLists) should still be present
    expect(entityNames).to.include('Genres')
    expect(entityNames).to.include('Currencies')
  })

  it('lists actions in describe output', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.actions).to.have.property('sum')
    expect(content.actions).to.have.property('stock')
    expect(content.actions).to.have.property('add')
  })

  it('includes action parameters', async () => {
    const { callTool } = mcpClient()
    // Need to specify action to get parameter details
    const { content: sumContent, error: sumError } = await callTool('describe', { actions: ['sum'] })
    expect(sumError).to.be.null
    expect(sumContent.actions.sum.parameters).to.have.property('x')
    expect(sumContent.actions.sum.parameters).to.have.property('y')
    expect(sumContent.actions.sum.parameters.x.type).to.equal('Integer')
    expect(sumContent.actions.sum.parameters.y.type).to.equal('Integer')

    const { content: stockContent } = await callTool('describe', { actions: ['stock'] })
    expect(stockContent.actions.stock.parameters).to.have.property('id')
    expect(stockContent.actions.stock.parameters.id.type).to.equal('Integer')

    const { content: addContent } = await callTool('describe', { actions: ['add'] })
    expect(addContent.actions.add.parameters).to.have.property('x')
    expect(addContent.actions.add.parameters).to.have.property('to')
  })

  it('schema includes action enum in array items', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const describeTool = response.result.tools.find(t => t.name === 'describe')
    expect(describeTool.inputSchema.properties).to.have.property('actions')
    const actionEnum = describeTool.inputSchema.properties.actions.items.enum
    expect(actionEnum).to.include('sum')
    expect(actionEnum).to.include('stock')
    expect(actionEnum).to.include('add')
    expect(actionEnum).to.include('submitOrder')
  })

  it('filters by specific action', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum'] })
    expect(error).to.be.null
    expect(content.actions).to.have.property('sum')
    expect(content.actions).to.not.have.property('add')
  })

  it('returns only action when filtering by action only (no entities)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum'] })
    expect(error).to.be.null
    // Should NOT have entities when only action is specified
    expect(content).to.not.have.property('entities')
    // Only the requested action
    expect(content.actions).to.have.property('sum')
    expect(Object.keys(content.actions)).to.deep.equal(['sum'])
  })

  it('filters by both entity and action independently', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { 
      entities: ['Books'], 
      actions: ['add'] 
    })
    expect(error).to.be.null
    // Only Books entity
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.not.have.property('Genres')
    // Only add action
    expect(content.actions).to.have.property('add')
    expect(content.actions).to.not.have.property('sum')
  })

  it('describes multiple entities at once', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entities: ['Books', 'Genres'] })
    expect(error).to.be.null
    // Both entities should have detail (elements)
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.have.property('Genres')
    expect(content.entities.Books.elements).to.exist
    expect(content.entities.Genres.elements).to.exist
    // No actions when only entities specified
    expect(content).to.not.have.property('actions')
  })

  it('describes multiple actions at once', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { actions: ['sum', 'add'] })
    expect(error).to.be.null
    // Both actions should have detail (parameters)
    expect(content.actions).to.have.property('sum')
    expect(content.actions).to.have.property('add')
    expect(content.actions.sum.parameters).to.exist
    expect(content.actions.add.parameters).to.exist
    // No entities when only actions specified
    expect(content).to.not.have.property('entities')
  })

  it('schema omits action field when no actions exist', async () => {
    // FullyRestrictedService has no actions defined
    const { mcp } = mcpClient('/mcp/fully-restricted', 'alice:')
    const response = await mcp('tools/list')
    const describeTool = response.result.tools.find(t => t.name === 'describe')
    expect(describeTool.inputSchema.properties).to.not.have.property('action')
  })
})

describe('query', () => {
  describe('basic queries', () => {
    it('queries Books entity and returns all 5 books', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books' })
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
      expect(content.count).to.equal(5)
      const titles = content.data.map(b => b.title)
      expect(titles).to.include('Wuthering Heights')
      expect(titles).to.include('Jane Eyre')
      expect(titles.some(t => t.startsWith('The Raven'))).to.be.true
    })

    it('queries Genres entity and returns genre hierarchy', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Genres', limit: 50 })
      expect(error).to.be.null
      expect(content.entity).to.equal('Genres')
      expect(content.count).to.equal(42)
      const names = content.data.map(g => g.name)
      expect(names).to.include('Fiction')
      expect(names).to.include('Non-Fiction')
      expect(names).to.include('Drama')
    })

    it('returns book data with all expected fields populated', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['ID'] }, '=', { val: 201 }] 
      })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book.ID).to.equal(201)
      expect(book.title).to.equal('Wuthering Heights')
      expect(book.stock).to.equal(12)
      expect(Number(book.price)).to.equal(11.11)
      expect(book.currency_code).to.equal('GBP')
    })
  })

  describe('where', () => {
    it('filters by equality', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['title'] }, '=', { val: 'Jane Eyre' }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('Jane Eyre')
    })

    it('filters by comparison (greater than)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['stock'] }, '>', { val: 10 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(book.stock).to.be.greaterThan(10))
    })

    it('filters by comparison (less than)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['price'] }, '<', { val: 12 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(Number(book.price)).to.be.lessThan(12))
    })

    it('filters with AND condition', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [
          { ref: ['stock'] }, '>', { val: 0 }, 
          'and', 
          { ref: ['price'] }, '<', { val: 15 }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => {
        expect(book.stock).to.be.greaterThan(0)
        expect(Number(book.price)).to.be.lessThan(15)
      })
    })

    it('filters with OR condition', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [
          { ref: ['ID'] }, '=', { val: 201 }, 
          'or', 
          { ref: ['ID'] }, '=', { val: 207 }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      const ids = content.data.map(b => b.ID)
      expect(ids).to.include(201)
      expect(ids).to.include(207)
    })

    it('filters with IN clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [
          { ref: ['ID'] }, 
          'in', 
          { list: [{ val: 201 }, { val: 207 }, { val: 251 }] }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(3)
      const ids = content.data.map(b => b.ID)
      expect(ids).to.include(201)
      expect(ids).to.include(207)
      expect(ids).to.include(251)
    })

    it('filters with LIKE clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['title'] }, 'like', { val: '%Raven%' }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(book.title).to.include('Raven'))
    })

    it('filters with BETWEEN clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [
          { ref: ['stock'] }, 
          'between', 
          { val: 10 }, 
          'and', 
          { val: 15 }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => {
        expect(book.stock).to.be.at.least(10)
        expect(book.stock).to.be.at.most(15)
      })
    })

    it('filters with nested xpr for grouping', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [
          { xpr: [{ ref: ['ID'] }, '=', { val: 201 }] }, 
          'or', 
          { xpr: [{ ref: ['ID'] }, '=', { val: 252 }] }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
    })

    it('returns empty array when where matches nothing', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        where: [{ ref: ['ID'] }, '=', { val: 99999 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(0)
      expect(content.data).to.be.an('array').that.is.empty
    })

    it('rejects where clause exceeding 1000 characters', async () => {
      const { callTool } = mcpClient()
      const longString = 'x'.repeat(1000)
      const { error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['title'] }, '=', { val: longString }]
      })
      console.log(error)
      expect(error).to.exist
      expect(error).to.match(/where clause exceeds maximum length/i)
    })

    it('supports is null and is not null checks', async () => {
      const { callTool } = mcpClient()
      // isbn is null for all test books (no CSV data for it)
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }, { ref: ['isbn'] }],
        where: [{ ref: ['isbn'] }, 'is', 'null']
      })
      expect(error).to.be.null
      expect(content.data.length).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row.isbn).to.be.null
      })

      // IS NOT NULL — title is never null
      const { content: content2, error: error2 } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }],
        where: [{ ref: ['title'] }, 'is', 'not', 'null']
      })
      expect(error2).to.be.null
      expect(content2.data.length).to.equal(5)
    })

    it('allows $now session variable in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['createdAt'] }, '<=', { ref: ['$now'] }]
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
    })

    it('allows $user session variable in where clause', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['title'] }, '=', { ref: ['$user'] }]
      })
      // $user is a structure in CDS runtime, so comparison may fail at runtime,
      // but it must NOT fail with "Invalid where field(s)" validation error
      if (error) {
        expect(error).to.not.match(/Invalid where field/)
      }
    })

    it('allows $user.id session variable in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['title'] }, '=', { ref: ['$user', 'id'] }]
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
    })

  })

  describe('select', () => {
    it('selects specific fields only', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', select: [{ ref: ['ID'] }, { ref: ['title'] }] })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book).to.have.property('ID')
      expect(book).to.have.property('title')
      expect(book).to.not.have.property('descr')
      expect(book).to.not.have.property('stock')
    })

    it('selects single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', select: [{ ref: ['title'] }] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(Object.keys(content.data[0])).to.have.lengthOf(1)
    })
  })

  describe('select with path expressions', () => {
    it('supports to-one association path expression', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }, { ref: ['genre', 'name'] }],
        limit: 3
      })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.have.property('genre_name')
    })

    it('supports ref objects in select with optional alias', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }, { ref: ['genre', 'name'], as: 'genreName' }],
        limit: 3
      })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.have.property('genreName')
    })

    it('supports expand for to-many associations as nested arrays', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        select: [{ ref: ['ID'] }, { ref: ['name'] }, { ref: ['books'], expand: [{ ref: ['title'] }, { ref: ['stock'] }] }],
        limit: 5
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      // Edgar Allen Poe (ID 150) has 2 books
      const poe = content.data.find(a => a.name === 'Edgar Allen Poe')
      expect(poe.books).to.be.an('array')
      expect(poe.books).to.have.length(2)
      expect(poe.books[0]).to.have.property('title')
      expect(poe.books[0]).to.have.property('stock')
    })

    it('supports deep path expressions (multiple levels)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }, { ref: ['genre', 'parent', 'name'] }],
        limit: 3
      })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.have.property('genre_parent_name')
    })

    it('mixes simple fields and path expressions', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['genre', 'name'] }],
        where: [{ ref: ['ID'] }, '=', { val: 201 }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.have.property('genre_name')
    })

    it('rejects invalid path with non-existent element', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre', 'invalid_field'] }]
      })
      expect(error).to.match(/Invalid select/)
      expect(error).to.match(/invalid_field/)
    })

    it('rejects path starting with non-existent element', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['nonexistent', 'name'] }]
      })
      expect(error).to.match(/Invalid select/)
      expect(error).to.match(/nonexistent/)
    })

    it('rejects select clause exceeding 1000 characters', async () => {
      const { callTool } = mcpClient()
      // Create a select clause that exceeds 1000 chars when serialized
      // Each ref object adds ~30 chars, so 50 fields should exceed 1000
      const manyFields = Array.from({ length: 50 }, (_, i) => ({ ref: [`field_${i.toString().padStart(3, '0')}`] }))
      const { error } = await callTool('query', {
        entity: 'Books',
        select: manyFields
      })
      expect(error).to.exist
      expect(error).to.match(/select clause exceeds maximum length/i)
    })

    it('accepts select clause within 1000 character limit', async () => {
      const { callTool } = mcpClient()
      const { error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['ID'] }, { ref: ['title'] }, { ref: ['stock'] }, { ref: ['price'] }]
      })
      expect(error).to.be.null
    })
    it('limits results with limit parameter', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', limit: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })
  })

  describe('orderBy', () => {
    it('orders by single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['title'] }], select: [{ ref: ['title'] }] })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by array of fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['stock'] }, { ref: ['title'] }], select: [{ ref: ['stock'] }, { ref: ['title'] }] })
      expect(error).to.be.null
      for (let i = 1; i < content.data.length; i++) {
        const prev = content.data[i - 1]
        const curr = content.data[i]
        const stockOk = prev.stock <= curr.stock
        const titleOk = prev.stock < curr.stock || prev.title <= curr.title
        expect(stockOk && titleOk).to.be.true
      }
    })

    it('orders by ID', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['ID'] }], select: [{ ref: ['ID'] }] })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => a - b))
    })

    it('orders by single field descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        orderBy: [{ ref: ['title'], sort: 'desc' }],
        select: [{ ref: ['title'] }] 
      })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort().reverse())
    })

    it('orders by ID descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        orderBy: [{ ref: ['ID'], sort: 'desc' }],
        select: [{ ref: ['ID'] }] 
      })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => b - a))
    })

    it('rejects orderBy clause exceeding 1000 character limit', async () => {
      const { callTool } = mcpClient()
      const manyOrders = Array.from({ length: 100 }, (_, i) => ({ ref: [`field_${i.toString().padStart(3, '0')}`] }))
      const { error } = await callTool('query', {
        entity: 'Books',
        orderBy: manyOrders,
        select: ['ID']
      })
      expect(error).to.exist
      expect(error).to.match(/order by clause exceeds maximum length/i)
    })
  })

  describe('groupBy', () => {
    it('groups by single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // Each genre_ID should appear only once
      const genreIds = content.data.map(b => b.genre_ID)
      const uniqueIds = [...new Set(genreIds)]
      expect(genreIds.length).to.equal(uniqueIds.length)
    })

    it('groups by multiple fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }, { ref: ['stock'] }],
        groupBy: ['genre_ID', 'stock']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // Each combination should be unique
      const combinations = content.data.map(b => `${b.genre_ID}-${b.stock}`)
      const uniqueCombinations = [...new Set(combinations)]
      expect(combinations.length).to.equal(uniqueCombinations.length)
    })

    it('groups with count(*) aggregate', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'count', args: ['*'], as: 'bookCount' }
        ],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('bookCount')
        expect(row.bookCount).to.be.a('number')
        expect(row.bookCount).to.be.greaterThan(0)
      })
    })

    it('groups with sum aggregate', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'sum', args: [{ ref: ['stock'] }], as: 'totalStock' }
        ],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('totalStock')
        expect(row.totalStock).to.be.a('number')
      })
    })

    it('groups with avg aggregate', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'avg', args: [{ ref: ['price'] }], as: 'avgPrice' }
        ],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('avgPrice')
        expect(row.avgPrice).to.be.a('number')
      })
    })

    it('groups with min/max aggregates', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'min', args: [{ ref: ['price'] }], as: 'minPrice' },
          { func: 'max', args: [{ ref: ['price'] }], as: 'maxPrice' }
        ],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('minPrice')
        expect(row).to.have.property('maxPrice')
        expect(row.minPrice).to.be.at.most(row.maxPrice)
      })
    })

    it('groups with where (WHERE before GROUP BY)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'count', args: ['*'], as: 'bookCount' }
        ],
        where: [{ ref: ['stock'] }, '>', { val: 5 }],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('bookCount')
      })
    })

    it('groups with multiple aggregates', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'count', args: ['*'], as: 'bookCount' },
          { func: 'sum', args: [{ ref: ['stock'] }], as: 'totalStock' },
          { func: 'avg', args: [{ ref: ['price'] }], as: 'avgPrice' }
        ],
        groupBy: ['genre_ID']
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row).to.have.property('genre_ID')
        expect(row).to.have.property('bookCount')
        expect(row).to.have.property('totalStock')
        expect(row).to.have.property('avgPrice')
      })
    })

    it('groups with orderBy on aggregate result', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'count', args: ['*'], as: 'bookCount' }
        ],
        groupBy: ['genre_ID'],
        orderBy: [{ ref: ['bookCount'], sort: 'desc' }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // Verify descending order
      for (let i = 1; i < content.data.length; i++) {
        expect(content.data[i - 1].bookCount).to.be.at.least(content.data[i].bookCount)
      }
    })

    it('rejects groupBy clause exceeding 1000 character limit', async () => {
      const { callTool } = mcpClient()
      const manyFields = Array.from({ length: 100 }, (_, i) => `field_${i.toString().padStart(3, '0')}`)
      const { error } = await callTool('query', {
        entity: 'Books',
        select: ['ID'],
        groupBy: manyFields
      })
      expect(error).to.exist
      expect(error).to.match(/group by clause exceeds maximum length/i)
    })
  })

  describe('having', () => {
    it('filters grouped results with having clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['genre_ID'] },
          { func: 'count', args: ['*'], as: 'bookCount' }
        ],
        groupBy: ['genre_ID'],
        having: [{ func: 'count', args: ['*'] }, '>', { val: 1 }]
      })
      expect(error).to.be.null
      // Only genres with more than 1 book should be returned
      content.data.forEach(row => {
        expect(row.bookCount).to.be.greaterThan(1)
      })
    })

    it('rejects having clause exceeding 1000 character limit', async () => {
      const { callTool } = mcpClient()
      const longConditions = Array.from({ length: 50 }, (_, i) =>
        [{ func: 'count', args: ['*'] }, '>', { val: i }]
      ).flat()
      const { error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }],
        groupBy: ['genre_ID'],
        having: longConditions
      })
      expect(error).to.exist
      expect(error).to.match(/having clause exceeds maximum length/i)
    })
  })

  describe('search', () => {
    it('searches across all string fields of an entity', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        search: 'Heights',
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.data).to.have.length(1)
      expect(content.data[0].title).to.equal('Wuthering Heights')
    })

    it('can combine search with where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        search: 'Raven',
        where: [{ ref: ['stock'] }, '>', { val: 100 }],
        select: [{ ref: ['title'] }, { ref: ['stock'] }]
      })
      expect(error).to.be.null
      // "Raven" matches only "The Raven" (stock 333), combined with stock > 100
      expect(content.data).to.have.length(1)
      expect(content.data[0].title).to.include('The Raven')
      expect(content.data[0].stock).to.be.greaterThan(100)
    })
  })

  describe('distinct', () => {
    it('returns distinct values for selected field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }],
        distinct: true
      })
      expect(error).to.be.null
      // Each genre_ID should appear only once
      const genreIds = content.data.map(b => b.genre_ID)
      const uniqueIds = [...new Set(genreIds)]
      expect(genreIds.length).to.equal(uniqueIds.length)
    })

    it('returns distinct combinations of multiple fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }, { ref: ['currency_code'] }],
        distinct: true
      })
      expect(error).to.be.null
      // Each combination should be unique
      const combinations = content.data.map(b => `${b.genre_ID}-${b.currency_code}`)
      const uniqueCombinations = [...new Set(combinations)]
      expect(combinations.length).to.equal(uniqueCombinations.length)
    })

    it('works with distinct and orderBy', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['genre_ID'] }],
        distinct: true,
        orderBy: [{ ref: ['genre_ID'], sort: 'asc' }]
      })
      expect(error).to.be.null
      const genreIds = content.data.map(b => b.genre_ID)
      // Should be sorted and unique
      expect(genreIds.length).to.equal([...new Set(genreIds)].length)
      for (let i = 1; i < genreIds.length; i++) {
        expect(genreIds[i - 1] <= genreIds[i]).to.be.true
      }
    })

    it('works with distinct and where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['currency_code'] }],
        distinct: true,
        where: [{ ref: ['stock'] }, '>', { val: 0 }]
      })
      expect(error).to.be.null
      const codes = content.data.map(b => b.currency_code)
      expect(codes.length).to.equal([...new Set(codes)].length)
    })
  })

  describe('one', () => {
    it('returns single object instead of array', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      expect(content.data).to.not.be.an('array')
      expect(content.data).to.have.property('ID')
      expect(content.data).to.have.property('title')
      expect(content.count).to.equal(1)
    })

    it('returns null when no match found', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['ID'] }, '=', { val: 99999 }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.null
    })

    it('returns specific record with where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['ID'] }, '=', { val: 201 }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      expect(content.data.ID).to.equal(201)
      expect(content.data.title).to.equal('Wuthering Heights')
    })

    it('respects orderBy and returns first result', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        orderBy: [{ ref: ['title'], sort: 'asc' }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      // First book alphabetically
      expect(content.data.title).to.equal('Catweazle')
    })

    it('respects orderBy descending and returns first result', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        orderBy: [{ ref: ['title'], sort: 'desc' }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      // Last book alphabetically (first in desc order)
      expect(content.data.title).to.equal('Wuthering Heights')
    })

    it('works with select to limit fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['ID'] }, { ref: ['title'] }],
        where: [{ ref: ['ID'] }, '=', { val: 201 }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.have.property('ID')
      expect(content.data).to.have.property('title')
      expect(content.data).to.not.have.property('stock')
      expect(content.data).to.not.have.property('price')
    })

    it('ignores limit when one is specified', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        one: true,
        limit: 100 // Should be ignored
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      expect(content.data).to.not.be.an('array')
    })
  })

  describe('portable string functions', () => {
    it('uses tolower in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'tolower', args: [{ ref: ['title'] }] }, '=', { val: 'jane eyre' }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('Jane Eyre')
    })

    it('uses toupper in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ func: 'toupper', args: [{ ref: ['title'] }], as: 'upperTitle' }],
        where: [{ ref: ['ID'] }, '=', { val: 201 }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].upperTitle).to.equal('WUTHERING HEIGHTS')
    })

    it('uses length in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['title'] }, { func: 'length', args: [{ ref: ['title'] }], as: 'titleLen' }],
        where: [{ ref: ['ID'] }, '=', { val: 251 }]
      })
      expect(error).to.be.null
      expect(content.data[0].title).to.equal('The Raven')
      expect(content.data[0].titleLen).to.equal(9)
    })

    it('uses length in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'length', args: [{ ref: ['title'] }] }, '<', { val: 10 }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => expect(row.title.length).to.be.lessThan(10))
    })

    it('uses substring in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ func: 'substring', args: [{ ref: ['title'] }, { val: 0 }, { val: 4 }], as: 'prefix' }],
        where: [{ ref: ['ID'] }, '=', { val: 251 }]
      })
      expect(error).to.be.null
      expect(content.data[0].prefix).to.equal('The ')
    })

    it('uses contains in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'contains', args: [{ ref: ['title'] }, { val: 'Raven' }] }, '=', { val: true }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('The Raven')
    })

    it('uses startswith in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'startswith', args: [{ ref: ['title'] }, { val: 'The' }] }, '=', { val: true }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => expect(row.title.startsWith('The')).to.be.true)
    })

    it('uses endswith in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'endswith', args: [{ ref: ['title'] }, { val: 'Eyre' }] }, '=', { val: true }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('Jane Eyre')
    })

    it('uses concat in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ func: 'concat', args: [{ ref: ['title'] }, { val: ' - Book' }], as: 'label' }],
        where: [{ ref: ['ID'] }, '=', { val: 271 }]
      })
      expect(error).to.be.null
      expect(content.data[0].label).to.equal('Catweazle - Book')
    })

    it('uses trim in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ func: 'trim', args: [{ ref: ['title'] }], as: 'trimmed' }],
        where: [{ ref: ['ID'] }, '=', { val: 207 }]
      })
      expect(error).to.be.null
      expect(content.data[0].trimmed).to.equal('Jane Eyre')
    })
  })

  describe('portable numeric functions', () => {
    it('uses round in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['price'] }, { func: 'round', args: [{ ref: ['price'] }], as: 'roundedPrice' }],
        where: [{ ref: ['ID'] }, '=', { val: 201 }]
      })
      expect(error).to.be.null
      // price is 11.11 so round should be 11
      expect(content.data[0].roundedPrice).to.equal(11)
    })

    it('uses floor in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['price'] }, { func: 'floor', args: [{ ref: ['price'] }], as: 'floorPrice' }],
        where: [{ ref: ['ID'] }, '=', { val: 207 }]
      })
      expect(error).to.be.null
      // price is 12.34 so floor should be 12
      expect(content.data[0].floorPrice).to.equal(12)
    })

    it('uses ceiling in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [{ ref: ['price'] }, { func: 'ceiling', args: [{ ref: ['price'] }], as: 'ceilPrice' }],
        where: [{ ref: ['ID'] }, '=', { val: 207 }]
      })
      expect(error).to.be.null
      // price is 12.34 so ceiling should be 13
      expect(content.data[0].ceilPrice).to.equal(13)
    })

    it('uses round in where clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ func: 'round', args: [{ ref: ['price'] }] }, '=', { val: 13 }],
        select: [{ ref: ['title'] }, { ref: ['price'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // price 13.13 rounds to 13
      content.data.forEach(row => expect(Math.round(row.price)).to.equal(13))
    })
  })

  describe('portable date/time functions', () => {
    it('uses year in select', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        select: [{ ref: ['name'] }, { func: 'year', args: [{ ref: ['dateOfBirth'] }], as: 'birthYear' }],
        where: [{ ref: ['ID'] }, '=', { val: 150 }]
      })
      expect(error).to.be.null
      expect(content.data[0].name).to.equal('Edgar Allen Poe')
      expect(content.data[0].birthYear).to.equal(1809)
    })

    it('uses year in where clause', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        where: [{ func: 'year', args: [{ ref: ['dateOfBirth'] }] }, '<', { val: 1815 }],
        select: [{ ref: ['name'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].name).to.equal('Edgar Allen Poe')
    })

    it('uses month in select', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        select: [{ ref: ['name'] }, { func: 'month', args: [{ ref: ['dateOfBirth'] }], as: 'birthMonth' }],
        where: [{ ref: ['ID'] }, '=', { val: 101 }]
      })
      expect(error).to.be.null
      // Emily Brontë born 1818-07-30
      expect(content.data[0].birthMonth).to.equal(7)
    })

    it('uses day in select', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        select: [{ ref: ['name'] }, { func: 'day', args: [{ ref: ['dateOfBirth'] }], as: 'birthDay' }],
        where: [{ ref: ['ID'] }, '=', { val: 107 }]
      })
      expect(error).to.be.null
      // Charlotte Brontë born 1818-04-21
      expect(content.data[0].birthDay).to.equal(21)
    })
  })

  describe('expression columns (xpr in select)', () => {
    it('uses arithmetic expression in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['title'] },
          { xpr: [{ ref: ['price'] }, '*', { ref: ['stock'] }], as: 'inventoryValue' }
        ],
        where: [{ ref: ['ID'] }, '=', { val: 201 }]
      })
      expect(error).to.be.null
      // price=11.11, stock=12 => 11.11*12 = 133.32
      expect(content.data[0].inventoryValue).to.be.closeTo(133.32, 0.01)
    })

    it('uses addition expression in select', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['title'] },
          { xpr: [{ ref: ['price'] }, '+', { val: 5 }], as: 'adjustedPrice' }
        ],
        where: [{ ref: ['ID'] }, '=', { val: 251 }]
      })
      expect(error).to.be.null
      // price=13.13 + 5 = 18.13
      expect(content.data[0].adjustedPrice).to.be.closeTo(18.13, 0.01)
    })
  })

  describe('expanded operators', () => {
    it('uses arithmetic operators in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ xpr: [{ ref: ['price'] }, '*', { ref: ['stock'] }] }, '>', { val: 1000 }],
        select: [{ ref: ['title'] }, { ref: ['price'] }, { ref: ['stock'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => expect(row.price * row.stock).to.be.greaterThan(1000))
    })
  })

  describe('expanded keywords', () => {
    it('uses is null in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['descr'] }, 'is', 'null'],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      content.data.forEach(row => expect(row.descr).to.not.exist)
    })

    it('uses is not null in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['descr'] }, 'is', 'not null'],
        select: [{ ref: ['title'] }, { ref: ['descr'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => expect(row.descr).to.exist)
    })

    it('uses not in in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['ID'] }, 'not in', { list: [{ val: 201 }, { val: 207 }] }],
        select: [{ ref: ['ID'] }, { ref: ['title'] }]
      })
      expect(error).to.be.null
      content.data.forEach(row => {
        expect(row.ID).to.not.equal(201)
        expect(row.ID).to.not.equal(207)
      })
    })

    it('uses not like in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        where: [{ ref: ['title'] }, 'not like', { val: 'The%' }],
        select: [{ ref: ['title'] }]
      })
      expect(error).to.be.null
      content.data.forEach(row => expect(row.title.startsWith('The')).to.be.false)
    })

    it('uses exists with infix filter in where', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        where: ['exists', { ref: [{ id: 'books', where: [{ ref: ['stock'] }, '>', { val: 100 }] }] }],
        select: [{ ref: ['ID'] }, { ref: ['name'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // Edgar Allen Poe has books with stock 333 and 555
      const names = content.data.map(a => a.name)
      expect(names).to.include('Edgar Allen Poe')
    })

    it('uses not exists with infix filter in where', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        where: ['not', 'exists', { ref: [{ id: 'books', where: [{ ref: ['stock'] }, '>', { val: 100 }] }] }],
        select: [{ ref: ['name'] }]
      })
      expect(error).to.be.null
      const names = content.data.map(a => a.name)
      expect(names).to.not.include('Edgar Allen Poe')
    })

    it('uses exists with compound infix filter condition', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        where: ['exists', { ref: [{ id: 'books', where: [
          { ref: ['stock'] }, '>', { val: 100 },
          'and',
          { ref: ['price'] }, '<', { val: 15 }
        ] }] }],
        select: [{ ref: ['name'] }]
      })
      expect(error).to.be.null
      // Edgar Allen Poe: The Raven (stock=333, price=13.13) and Eleonora (stock=555, price=14) match
      const names = content.data.map(a => a.name)
      expect(names).to.include('Edgar Allen Poe')
      // Brontës have stock 12 and 11, so they shouldn't match
      expect(names).to.not.include('Emily Brontë')
      expect(names).to.not.include('Charlotte Brontë')
    })

    it('combines exists infix filter with additional where conditions', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { content, error } = await callTool('query', {
        entity: 'Authors',
        where: [
          'exists', { ref: [{ id: 'books', where: [{ ref: ['stock'] }, '>', { val: 0 }] }] },
          'and',
          { func: 'year', args: [{ ref: ['dateOfBirth'] }] }, '<', { val: 1820 }
        ],
        select: [{ ref: ['name'] }, { ref: ['dateOfBirth'] }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      // All authors have books with stock > 0, but only Poe (1809) and the Brontës (1818) were born before 1820
      content.data.forEach(row => {
        const year = new Date(row.dateOfBirth).getFullYear()
        expect(year).to.be.lessThan(1820)
      })
    })
  })

  describe('combined portable function scenarios', () => {
    it('nests functions: toupper of substring', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { func: 'toupper', args: [{ func: 'substring', args: [{ ref: ['title'] }, { val: 0 }, { val: 3 }] }], as: 'code' }
        ],
        where: [{ ref: ['ID'] }, '=', { val: 251 }]
      })
      expect(error).to.be.null
      expect(content.data[0].code).to.equal('THE')
    })

    it('uses function in select with function in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['title'] },
          { func: 'length', args: [{ ref: ['title'] }], as: 'titleLen' },
          { func: 'round', args: [{ ref: ['price'] }], as: 'roundedPrice' }
        ],
        where: [{ func: 'length', args: [{ ref: ['title'] }] }, '<=', { val: 10 }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => {
        expect(row.titleLen).to.be.at.most(10)
        expect(Number.isInteger(row.roundedPrice)).to.be.true
      })
    })

    it('combines xpr column with function in where', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: [
          { ref: ['title'] },
          { xpr: [{ ref: ['price'] }, '*', { ref: ['stock'] }], as: 'value' }
        ],
        where: [{ func: 'floor', args: [{ ref: ['price'] }] }, '>=', { val: 13 }],
        orderBy: [{ ref: ['price'], sort: 'desc' }]
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(row => expect(Math.floor(row.value / row.stock || row.value)).to.be.at.least(0))
    })
  })
})

describe('Auth', () => {
  it('rejects query with 401', async () => {
    const { mcp } = mcpClient('/mcp/admin')
    const response = await mcp('tools/call', { name: 'query', arguments: { entity: 'Books' } })
    expect(response.error).to.exist
    expect(response.error.code).to.equal(-32001)
    expect(response.error.message).to.match(/401/i)
    expect(response.error.message).to.match(/authoriz/i)
  })

  it('rejects describe with 401 when unauthenticated', async () => {
    const { mcp } = mcpClient('/mcp/admin')
    const response = await mcp('tools/call', { name: 'describe', arguments: {} })
    expect(response.error).to.exist
    expect(response.error.code).to.equal(-32001)
    expect(response.error.message).to.match(/401/i)
    expect(response.error.message).to.match(/authoriz/i)
  })

  describe('unauthorized user (bob - no admin role)', () => {
    it('rejects query with 403', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('query', { entity: 'Books' })
      expect(error).to.match(/403/i)
      expect(error).to.match(/authoriz/i)
    })

    it('rejects describe with 403', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('describe')
      expect(error).to.match(/403/i)
      expect(error).to.match(/authoriz/i)
    })
  })

  describe('authorized user (alice - admin role)', () => {
    it('allows query', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('query', { entity: 'Books' })
      expect(error).to.be.null
    })

    it('allows describe', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('describe')
      expect(error).to.be.null
    })
  })
})

describe('Entity-Level Authorization (RestrictedService)', () => {
  describe('alice (admin role)', () => {
    const aliceClient = () => mcpClient('/mcp/restricted', 'alice:')

    it('lists tools with filtered entity enum (Books, Genres)', async () => {
      const { mcp } = aliceClient()
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include('Books')
      expect(entityEnum).to.include('Genres')
      expect(entityEnum).to.not.include('Authors')
    })

    it('describe only shows accessible entities', async () => {
      const { callTool } = aliceClient()
      const { content, error } = await callTool('describe')
      expect(error).to.be.null
      expect(content.entities).to.have.property('Books')
      expect(content.entities).to.have.property('Genres')
      expect(content.entities).to.not.have.property('Authors')
    })

    it('query works for accessible entity (Books)', async () => {
      const { callTool } = aliceClient()
      const { content, error } = await callTool('query', { entity: 'Books' })
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
    })

    it('query rejects inaccessible entity (Authors) via schema validation', async () => {
      const { callTool } = aliceClient()
      const { error } = await callTool('query', { entity: 'Authors' })
      expect(error).to.match(/invalid/i)
    })
  })

  describe('bob (no roles)', () => {
    const bobClient = () => mcpClient('/mcp/restricted', 'bob:')

    it('only shows unrestricted entities in entity enum (public entities)', async () => {
      const { mcp } = bobClient()
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      // Genres and Currencies have @cds.autoexpose - READ is allowed
      expect(entityEnum).to.include.members(['Genres', 'Currencies'])
      // Composition-only autoexposed entities should be filtered out
      expect(entityEnum).to.not.include('Books.chapters')
      // Books and Authors have @restrict so should NOT be visible
      expect(entityEnum).to.not.include('Books')
      expect(entityEnum).to.not.include('Authors')
    })

    it('describe only shows unrestricted entities', async () => {
      const { callTool } = bobClient()
      const { content, error } = await callTool('describe')
      expect(error).to.be.null
      const entityNames = Object.keys(content.entities)
      expect(entityNames).to.include.members(['Genres', 'Currencies'])
      expect(entityNames).to.not.include('Books.chapters')
      expect(entityNames).to.not.include('Books')
      expect(entityNames).to.not.include('Authors')
    })
  })

  describe('unauthenticated', () => {
    const anonClient = () => mcpClient('/mcp/restricted')

    it('only shows unrestricted entities in entity enum (public entities)', async () => {
      const { mcp } = anonClient()
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      // Genres and Currencies have @cds.autoexpose - READ is allowed
      expect(entityEnum).to.include.members(['Genres', 'Currencies'])
      // Composition-only autoexposed entities should be filtered out
      expect(entityEnum).to.not.include('Books.chapters')
      // Books and Authors have @restrict so should NOT be visible
      expect(entityEnum).to.not.include('Books')
      expect(entityEnum).to.not.include('Authors')
    })
  })
})

describe('No Accessible Entities (FullyRestrictedService)', () => {
  describe('alice (admin role)', () => {
    it('can access Books entity plus autoexpose entities', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted', 'alice:')
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      // alice (admin) can access Books (restricted to admin) + entities with @cds.autoexpose
      expect(entityEnum).to.include('Books')
      expect(entityEnum).to.include.members(['Genres', 'Currencies'])
      // Composition-only autoexposed entities should be filtered out
      expect(entityEnum).to.not.include('Books.chapters')
      // Authors is restricted to editor, so alice cannot access it
      expect(entityEnum).to.not.include('Authors')
    })
  })

  describe('bob (no roles) - only autoexpose entities accessible', () => {
    it('returns tools with only autoexpose entities', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted', 'bob:')
      const response = await mcp('tools/list')
      expect(response.error).to.not.exist
      // bob has no roles but can still access entities with @cds.autoexpose
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      expect(readQueryTool).to.exist
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include.members(['Genres', 'Currencies'])
      expect(entityEnum).to.not.include('Books.chapters')
      expect(entityEnum).to.not.include('Books')
      expect(entityEnum).to.not.include('Authors')
    })
  })

  describe('unauthenticated - only autoexpose entities accessible', () => {
    it('returns tools with only autoexpose entities', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted')
      const response = await mcp('tools/list')
      expect(response.error).to.not.exist
      // unauthenticated users can still access entities with @cds.autoexpose
      const readQueryTool = response.result.tools.find(t => t.name === 'query')
      expect(readQueryTool).to.exist
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include.members(['Genres', 'Currencies'])
      expect(entityEnum).to.not.include('Books.chapters')
      expect(entityEnum).to.not.include('Books')
      expect(entityEnum).to.not.include('Authors')
    })
  })
})
