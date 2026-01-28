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
  })

  it('lists read_query and describe_model tools', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.include('read_query')
    expect(toolNames).to.include('describe_model')
  })

  it('does not have per-entity tools by default', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.not.include('read_Books')
    expect(toolNames).to.not.include('read_Genres')
  })

  it('includes tool descriptions and input schemas', async () => {
    const { mcp } = mcpClient()
    const response = await mcp('tools/list')
    const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
    expect(readQueryTool).to.have.property('description')
    expect(readQueryTool).to.have.property('inputSchema')
    expect(readQueryTool.inputSchema).to.have.property('properties')
  })
})

describe('describe_model', () => {
  it('describes all entities when no param given', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe_model')
    expect(error).to.be.null
    expect(content.service).to.equal('CatalogService')
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.have.property('Genres')
  })

  it('describes specific entity when param given', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe_model', { entity: 'Books' })
    expect(error).to.be.null
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.not.have.property('Genres')
  })

  it('includes element metadata', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe_model', { entity: 'Books' })
    expect(error).to.be.null
    const idElement = content.entities.Books.elements.ID
    expect(idElement.type).to.equal('cds.Integer')
    expect(idElement.key).to.be.true
  })

  it('identifies associations', async () => {
    const { callTool } = mcpClient()
    const { content, error } = await callTool('describe_model', { entity: 'Books' })
    expect(error).to.be.null
    const genreElement = content.entities.Books.elements.genre
    expect(genreElement.isAssociation).to.be.true
    expect(genreElement).to.have.property('target')
  })
})

describe('read_query', () => {
  describe('basic queries', () => {
    it('queries Books entity and returns all 5 books', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books' })
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
      const { content, error } = await callTool('read_query', { entity: 'Genres', limit: 50 })
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
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['ID'] }, '=', { val: 201 }] 
      })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book.ID).to.equal(201)
      expect(book.title).to.equal('Wuthering Heights')
      expect(book.stock).to.equal(12)
      expect(book.price).to.equal(11.11)
      expect(book.currency_code).to.equal('GBP')
    })
  })

  describe('filter', () => {
    it('filters by equality', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['title'] }, '=', { val: 'Jane Eyre' }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('Jane Eyre')
    })

    it('filters by comparison (greater than)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['stock'] }, '>', { val: 10 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(book.stock).to.be.greaterThan(10))
    })

    it('filters by comparison (less than)', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['price'] }, '<', { val: 12 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(book.price).to.be.lessThan(12))
    })

    it('filters with AND condition', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [
          { ref: ['stock'] }, '>', { val: 0 }, 
          'and', 
          { ref: ['price'] }, '<', { val: 15 }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => {
        expect(book.stock).to.be.greaterThan(0)
        expect(book.price).to.be.lessThan(15)
      })
    })

    it('filters with OR condition', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [
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
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [
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
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['title'] }, 'like', { val: '%Raven%' }] 
      })
      expect(error).to.be.null
      expect(content.count).to.be.greaterThan(0)
      content.data.forEach(book => expect(book.title).to.include('Raven'))
    })

    it('filters with BETWEEN clause', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [
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
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [
          { xpr: [{ ref: ['ID'] }, '=', { val: 201 }] }, 
          'or', 
          { xpr: [{ ref: ['ID'] }, '=', { val: 252 }] }
        ] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
    })

    it('returns empty array when filter matches nothing', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        filter: [{ ref: ['ID'] }, '=', { val: 99999 }] 
      })
      expect(error).to.be.null
      expect(content.count).to.equal(0)
      expect(content.data).to.be.an('array').that.is.empty
    })
  })

  describe('select', () => {
    it('selects specific fields only', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books', select: ['ID', 'title'] })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book).to.have.property('ID')
      expect(book).to.have.property('title')
      expect(book).to.not.have.property('descr')
      expect(book).to.not.have.property('stock')
    })

    it('selects single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books', select: ['title'] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(Object.keys(content.data[0])).to.have.lengthOf(1)
    })
  })

  describe('pagination', () => {
    it('limits results with limit parameter', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books', limit: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })

    it('uses default limit of 20', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Genres' })
      expect(error).to.be.null
      expect(content.count).to.equal(20)
    })
  })

  describe('orderBy', () => {
    it('orders by single field', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books', orderBy: 'title', select: ['title'] })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by array of fields', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { entity: 'Books', orderBy: ['stock', 'title'], select: ['stock', 'title'] })
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
      const { content, error } = await callTool('read_query', { entity: 'Books', orderBy: 'ID', select: ['ID'] })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => a - b))
    })

    it('orders by single field descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        orderBy: 'title', 
        sort: 'desc',
        select: ['title'] 
      })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort().reverse())
    })

    it('orders by single field ascending explicitly', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        orderBy: 'title', 
        sort: 'asc',
        select: ['title'] 
      })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by ID descending', async () => {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('read_query', { 
        entity: 'Books', 
        orderBy: 'ID', 
        sort: 'desc',
        select: ['ID'] 
      })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => b - a))
    })
  })
})

describe('Auth', () => {
  it('rejects read_query with 401', async () => {
    const { mcp } = mcpClient('/mcp/admin')
    const response = await mcp('tools/call', { name: 'read_query', arguments: { entity: 'Books' } })
    expect(response.error).to.exist
    expect(response.error.code).to.equal(-32001)
    expect(response.error.message).to.match(/401/i)
    expect(response.error.message).to.match(/authoriz/i)
  })

  it('rejects describe_model with 401 when unauthenticated', async () => {
    const { mcp } = mcpClient('/mcp/admin')
    const response = await mcp('tools/call', { name: 'describe_model', arguments: {} })
    expect(response.error).to.exist
    expect(response.error.code).to.equal(-32001)
    expect(response.error.message).to.match(/401/i)
    expect(response.error.message).to.match(/authoriz/i)
  })

  describe('unauthorized user (bob - no admin role)', () => {
    it('rejects read_query with 403', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.match(/403/i)
      expect(error).to.match(/authoriz/i)
    })

    it('rejects describe_model with 403', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('describe_model')
      expect(error).to.match(/403/i)
      expect(error).to.match(/authoriz/i)
    })
  })

  describe('authorized user (alice - admin role)', () => {
    it('allows read_query', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.be.null
    })

    it('allows describe_model', async () => {
      const { callTool } = mcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('describe_model')
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
      const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include('Books')
      expect(entityEnum).to.include('Genres')
      expect(entityEnum).to.not.include('Authors')
    })

    it('describe_model only shows accessible entities', async () => {
      const { callTool } = aliceClient()
      const { content, error } = await callTool('describe_model')
      expect(error).to.be.null
      expect(content.entities).to.have.property('Books')
      expect(content.entities).to.have.property('Genres')
      expect(content.entities).to.not.have.property('Authors')
    })

    it('read_query works for accessible entity (Books)', async () => {
      const { callTool } = aliceClient()
      const { content, error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
    })

    it('read_query rejects inaccessible entity (Authors) via schema validation', async () => {
      const { callTool } = aliceClient()
      const { error } = await callTool('read_query', { entity: 'Authors' })
      expect(error).to.match(/invalid/i)
    })
  })

  describe('bob (no roles)', () => {
    const bobClient = () => mcpClient('/mcp/restricted', 'bob:')

    it('only shows Genres in entity enum (public entity)', async () => {
      const { mcp } = bobClient()
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.deep.equal(['Genres'])
    })

    it('describe_model only shows Genres', async () => {
      const { callTool } = bobClient()
      const { content, error } = await callTool('describe_model')
      expect(error).to.be.null
      expect(Object.keys(content.entities)).to.deep.equal(['Genres'])
    })
  })

  describe('unauthenticated', () => {
    const anonClient = () => mcpClient('/mcp/restricted')

    it('only shows Genres in entity enum (public entity)', async () => {
      const { mcp } = anonClient()
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.deep.equal(['Genres'])
    })
  })
})

describe('No Accessible Entities (FullyRestrictedService)', () => {
  describe('alice (admin role)', () => {
    it('can access Books entity only', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted', 'alice:')
      const response = await mcp('tools/list')
      const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
      const entityEnum = readQueryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.deep.equal(['Books'])
    })
  })

  describe('bob (no roles) - no accessible entities', () => {
    it('returns 403 when no entities accessible', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted', 'bob:')
      const response = await mcp('tools/list')
      expect(response.error).to.exist
      expect(response.error.code).to.equal(-32003)
      expect(response.error.message).to.match(/403/i)
    })
  })

  describe('unauthenticated - no accessible entities', () => {
    it('returns 401 when no entities accessible', async () => {
      const { mcp } = mcpClient('/mcp/fully-restricted')
      const response = await mcp('tools/list')
      expect(response.error).to.exist
      expect(response.error.code).to.equal(-32001)
      expect(response.error.message).to.match(/401/i)
    })
  })
})
