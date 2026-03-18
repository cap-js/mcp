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

  it('handles invalid JSON body gracefully', async () => {
    const response = await fetch(`${test.url}/mcp/catalog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not valid json {'
    })

    // Server should not crash - should return an error response
    // MCP SDK returns 406 for invalid JSON with a JSON-RPC error
    expect(response.status).to.equal(406)

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
  it('describes all entities when no param given', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.service).to.equal('CatalogService')
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.have.property('Genres')
  })

  it('describes specific entity when param given (no actions)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entity: ['Books'] })
    expect(error).to.be.null
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.not.have.property('Genres')
    expect(content).to.not.have.property('actions')
  })

  it('includes element metadata', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entity: ['Books'] })
    expect(error).to.be.null
    const idElement = content.entities.Books.elements.ID
    expect(idElement.type).to.equal('Integer')
  })

  it('identifies associations', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entity: ['Books'] })
    expect(error).to.be.null
    const genreElement = content.entities.Books.elements.genre
    expect(genreElement.type).to.equal('Association (1-1)')
    
    expect(genreElement).to.have.property('target')
  })

  it('identifies composoitions', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { entity: ['Books'] })
    expect(error).to.be.null
    const chapterElement = content.entities.Books.elements.chapters
    expect(chapterElement.type).to.equal('Composition (1-*)')
    
    expect(chapterElement).to.have.property('target')
  })

  it('excludes draft elements from draft-enabled entities', async () => {
    const { callTool } = mcpClient('/mcp/admin', 'alice:')
    const { content, error } = await callTool('describe', { entity: ['Books'] })
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

  it('excludes localized elements from draft-enabled entities', async () => {
    const { callTool } = mcpClient('/mcp/admin', 'alice:')
    const { content, error } = await callTool('describe', { entity: ['Books'] })
    expect(error).to.be.null
    const elementNames = Object.keys(content.entities.Books.elements)
    expect(elementNames).to.include('ID')
    expect(elementNames).to.include('title')
    expect(elementNames).to.not.include('localized')
    expect(elementNames).to.not.include('texts')
  })

  it('lists actions in describe output', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.actions).to.have.property('sum')
    expect(content.actions).to.have.property('stock')
    expect(content.actions).to.have.property('add')
  })

  it('includes action kind (action vs function)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.actions.sum.kind).to.equal('function')
    expect(content.actions.stock.kind).to.equal('function')
    expect(content.actions.add.kind).to.equal('action')
  })

  it('includes action parameters', async () => {
    const { callTool } = mcpClient()
    // Need to specify action to get parameter details
    const { content: sumContent, error: sumError } = await callTool('describe', { action: ['sum'] })
    expect(sumError).to.be.null
    expect(sumContent.actions.sum.parameters).to.have.property('x')
    expect(sumContent.actions.sum.parameters).to.have.property('y')
    expect(sumContent.actions.sum.parameters.x.type).to.equal('Integer')
    expect(sumContent.actions.sum.parameters.y.type).to.equal('Integer')

    const { content: stockContent } = await callTool('describe', { action: ['stock'] })
    expect(stockContent.actions.stock.parameters).to.have.property('id')
    expect(stockContent.actions.stock.parameters.id.type).to.equal('Integer')

    const { content: addContent } = await callTool('describe', { action: ['add'] })
    expect(addContent.actions.add.parameters).to.have.property('x')
    expect(addContent.actions.add.parameters).to.have.property('to')
  })

  it('includes action return type', async () => {
    const { callTool } = mcpClient()
    // Need to specify action to get return type details
    const { content: sumContent, error } = await callTool('describe', { action: ['sum'] })
    expect(error).to.be.null
    expect(sumContent.actions.sum.returns).to.equal('Integer')

    const { content: stockContent } = await callTool('describe', { action: ['stock'] })
    expect(stockContent.actions.stock.returns).to.equal('Integer')

    const { content: addContent } = await callTool('describe', { action: ['add'] })
    expect(addContent.actions.add.returns).to.equal('Integer')
  })

  it('includes action descriptions', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe')
    expect(error).to.be.null
    expect(content.actions.sum.description).to.include('Add two integers')
    expect(content.actions.stock.description).to.include('stock')
    expect(content.actions.add.description).to.include('accumulator')
  })

  it('schema includes action enum in array items', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const describeTool = response.result.tools.find(t => t.name === 'describe')
    expect(describeTool.inputSchema.properties).to.have.property('action')
    const actionEnum = describeTool.inputSchema.properties.action.items.enum
    expect(actionEnum).to.include('sum')
    expect(actionEnum).to.include('stock')
    expect(actionEnum).to.include('add')
    expect(actionEnum).to.include('submitOrder')
  })

  it('filters by specific action', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { action: ['sum'] })
    expect(error).to.be.null
    expect(content.actions).to.have.property('sum')
    expect(content.actions).to.not.have.property('add')
  })

  it('returns only action when filtering by action only (no entities)', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe', { action: ['sum'] })
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
      entity: ['Books'], 
      action: ['add'] 
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
    const { content, error } = await callTool('describe', { entity: ['Books', 'Genres'] })
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
    const { content, error } = await callTool('describe', { action: ['sum', 'add'] })
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

  })

  describe('select', () => {
    it('selects specific fields only', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', select: ['ID', 'title'] })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book).to.have.property('ID')
      expect(book).to.have.property('title')
      expect(book).to.not.have.property('descr')
      expect(book).to.not.have.property('stock')
    })

    it('selects single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', select: ['title'] })
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
        select: ['title', 'genre.name'],
        limit: 3
      })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.have.property('genre_name')
    })

    it('supports deep path expressions (multiple levels)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: ['title', 'genre.parent.name'],
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
        select: ['ID', 'title', 'genre.name'],
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
        select: ['genre.invalid_field']
      })
      expect(error).to.match(/Invalid select/)
      expect(error).to.match(/genre.invalid_field/)
    })

    it('rejects path starting with non-existent element', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: ['nonexistent.name']
      })
      expect(error).to.match(/Invalid select/)
      expect(error).to.match(/nonexistent/)
    })

    it('rejects select clause exceeding 1000 characters', async () => {
      const { callTool } = mcpClient()
      // Create a select clause that exceeds 1000 chars when serialized
      // Each field name adds ~14 chars, so 100 fields should exceed 1000
      const manyFields = Array.from({ length: 100 }, (_, i) => `field_${i.toString().padStart(3, '0')}`)
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
        select: ['ID', 'title', 'stock', 'price']
      })
      expect(error).to.be.null
    })
  })

  describe('pagination', () => {
    it('limits results with limit parameter', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', limit: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })

    it('uses default limit of 20', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Genres' })
      expect(error).to.be.null
      expect(content.count).to.equal(20)
    })
  })

  describe('orderBy', () => {
    it('orders by single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['title'] }], select: ['title'] })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by array of fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['stock'] }, { ref: ['title'] }], select: ['stock', 'title'] })
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
      const { content, error } = await callTool('query', { entity: 'Books', orderBy: [{ ref: ['ID'] }], select: ['ID'] })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => a - b))
    })

    it('orders by single field descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        orderBy: [{ ref: ['title'], sort: 'desc' }],
        select: ['title'] 
      })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort().reverse())
    })

    it('orders by single field ascending explicitly', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        orderBy: [{ ref: ['title'], sort: 'asc' }],
        select: ['title'] 
      })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by ID descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', { 
        entity: 'Books', 
        orderBy: [{ ref: ['ID'], sort: 'desc' }],
        select: ['ID'] 
      })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => b - a))
    })
  })

  describe('groupBy', () => {
    it('groups by single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: ['genre_ID'],
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
        select: ['genre_ID', 'stock'],
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
          'genre_ID',
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
          'genre_ID',
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
          'genre_ID',
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
          'genre_ID',
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
          'genre_ID',
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
          'genre_ID',
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
          'genre_ID',
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
  })

  describe.skip('distinct', () => {
    it('returns distinct values for selected field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: ['genre_ID'],
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
        select: ['genre_ID', 'currency_code'],
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
        select: ['genre_ID'],
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
        select: ['currency_code'],
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
        select: ['ID', 'title'],
        where: [{ ref: ['ID'] }, '=', { val: 201 }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.have.property('ID')
      expect(content.data).to.have.property('title')
      expect(content.data).to.not.have.property('stock')
      expect(content.data).to.not.have.property('price')
    })

    it('works with distinct and one together', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        select: ['genre_ID'],
        distinct: true,
        orderBy: [{ ref: ['genre_ID'], sort: 'asc' }],
        one: true
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('object')
      expect(content.data).to.have.property('genre_ID')
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
