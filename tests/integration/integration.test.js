const cds = require('@sap/cds')

const test = cds.test(__dirname + '/../bookshop')
const { expect } = test

const parseStream = (str) => JSON.parse(str.split('\n').find(l => l.startsWith('data: ')).slice(6))

const createMcpClient = (endpoint, auth = null) => {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream'
  }
  if (auth) {
    headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
  }

  const mcp = async (method, params = {}) => {
    const { data } = await test.POST(endpoint, { jsonrpc: '2.0', id: 1, method, params }, { headers })
    return parseStream(data)
  }

  const callTool = async (name, args = {}) => {
    const res = await mcp('tools/call', { name, arguments: args })
    return {
      ...res,
      content: res.result.isError ? null : JSON.parse(res.result.content[0].text),
      error: res.result.isError ? res.result.content[0].text : null
    }
  }

  return { mcp, callTool }
}

const { mcp, callTool } = createMcpClient('/mcp/catalog')

describe('MCP Protocol', () => {
  it('responds to initialize request', async () => {
    const response = await mcp('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    })
    expect(response.result).to.exist
    expect(response.result.protocolVersion).to.be.a('string')
    expect(response.result.serverInfo).to.have.property('name')
  })

  it('lists read_query and describe_model tools', async () => {
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.include('read_query')
    expect(toolNames).to.include('describe_model')
  })

  it('does not have per-entity tools by default', async () => {
    const response = await mcp('tools/list')
    const toolNames = response.result.tools.map(t => t.name)
    expect(toolNames).to.not.include('read_Books')
    expect(toolNames).to.not.include('read_Genres')
  })

  it('includes tool descriptions and input schemas', async () => {
    const response = await mcp('tools/list')
    const readQueryTool = response.result.tools.find(t => t.name === 'read_query')
    expect(readQueryTool).to.have.property('description')
    expect(readQueryTool).to.have.property('inputSchema')
    expect(readQueryTool.inputSchema).to.have.property('properties')
  })
})

describe('describe_model', () => {
  it('describes all entities when no param given', async () => {
    const { content, error } = await callTool('describe_model')
    expect(error).to.be.null
    expect(content.service).to.equal('CatalogService')
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.have.property('Genres')
  })

  it('describes specific entity when param given', async () => {
    const { content, error } = await callTool('describe_model', { entity: 'Books' })
    expect(error).to.be.null
    expect(content.entities).to.have.property('Books')
    expect(content.entities).to.not.have.property('Genres')
  })

  it('includes element metadata', async () => {
    const { content, error } = await callTool('describe_model', { entity: 'Books' })
    expect(error).to.be.null
    const idElement = content.entities.Books.elements.ID
    expect(idElement.type).to.equal('cds.Integer')
    expect(idElement.key).to.be.true
  })

  it('identifies associations', async () => {
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
      const { content, error } = await callTool('read_query', { entity: 'Genres' })
      expect(error).to.be.null
      expect(content.entity).to.equal('Genres')
      expect(content.count).to.equal(42)
      const names = content.data.map(g => g.name)
      expect(names).to.include('Fiction')
      expect(names).to.include('Non-Fiction')
      expect(names).to.include('Drama')
    })

    it('returns book data with all expected fields populated', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', filter: { ID: 201 } })
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
    it('filters by string field', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', filter: { title: 'Jane Eyre' } })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].title).to.equal('Jane Eyre')
    })

    it('returns empty array when filter matches nothing', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', filter: { ID: 99999 } })
      expect(error).to.be.null
      expect(content.count).to.equal(0)
      expect(content.data).to.be.an('array').that.is.empty
    })
  })

  describe('select', () => {
    it('selects specific fields only', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', select: ['ID', 'title'] })
      expect(error).to.be.null
      const book = content.data[0]
      expect(book).to.have.property('ID')
      expect(book).to.have.property('title')
      expect(book).to.not.have.property('descr')
      expect(book).to.not.have.property('stock')
    })

    it('selects single field', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', select: ['title'] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('title')
      expect(Object.keys(content.data[0])).to.have.lengthOf(1)
    })
  })

  describe('pagination', () => {
    it('limits results with top', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', top: 2 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
      expect(content.data).to.have.lengthOf(2)
    })

    it('skips results', async () => {
      const { content: all, error: err1 } = await callTool('read_query', { entity: 'Books' })
      expect(err1).to.be.null
      const { content, error: err2 } = await callTool('read_query', { entity: 'Books', skip: 2 })
      expect(err2).to.be.null
      expect(content.count).to.equal(all.count - 2)
    })

    it('combines top and skip for pagination', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', top: 2, skip: 1 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
    })

    it('uses default top of 100', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.be.null
      expect(content.count).to.be.at.most(100)
    })
  })

  describe('orderBy', () => {
    it('orders by single field', async () => {
      const { content, error } = await callTool('read_query', { entity: 'Books', orderBy: 'title', select: ['title'] })
      expect(error).to.be.null
      const titles = content.data.map(b => b.title)
      expect(titles).to.eql([...titles].sort())
    })

    it('orders by array of fields', async () => {
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
      const { content, error } = await callTool('read_query', { entity: 'Books', orderBy: 'ID', select: ['ID'] })
      expect(error).to.be.null
      const ids = content.data.map(b => b.ID)
      expect(ids).to.eql([...ids].sort((a, b) => a - b))
    })
  })

})

describe('Per-Entity Tools', () => {
  beforeAll(() => {
    cds.env.features.mcp_per_entity_tool = true
  })

  afterAll(() => {
    cds.env.features.mcp_per_entity_tool = false
  })

  describe('tools/list', () => {
    it('has per-entity read tools', async () => {
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('read_Books')
      expect(toolNames).to.include('read_Genres')
    })

    it('has describe_model tool', async () => {
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.include('describe_model')
    })

    it('does not have generic read_query tool', async () => {
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map(t => t.name)
      expect(toolNames).to.not.include('read_query')
    })
  })

  describe('tool execution', () => {
    it('executes read_Books tool and returns all books with titles', async () => {
      const { content, error } = await callTool('read_Books')
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
      expect(content.count).to.equal(5)
      const titles = content.data.map(b => b.title)
      expect(titles).to.include('Wuthering Heights')
      expect(titles).to.include('Catweazle')
    })

    it('executes read_Genres tool and returns genre names', async () => {
      const { content, error } = await callTool('read_Genres')
      expect(error).to.be.null
      expect(content.entity).to.equal('Genres')
      expect(content.count).to.equal(42)
      const names = content.data.map(g => g.name)
      expect(names).to.include('Fiction')
      expect(names).to.include('Science Fiction')
    })

    it('filters with read_Books tool', async () => {
      const { content, error } = await callTool('read_Books', { filter: { ID: 201 } })
      expect(error).to.be.null
      expect(content.count).to.equal(1)
      expect(content.data[0].ID).to.equal(201)
    })

    it('selects fields with read_Books tool', async () => {
      const { content, error } = await callTool('read_Books', { select: ['ID', 'title'] })
      expect(error).to.be.null
      expect(content.data[0]).to.have.property('ID')
      expect(content.data[0]).to.have.property('title')
      expect(content.data[0]).to.not.have.property('descr')
    })

    it('paginates with read_Books tool', async () => {
      const { content, error } = await callTool('read_Books', { top: 2, skip: 1 })
      expect(error).to.be.null
      expect(content.count).to.equal(2)
    })
  })
})

describe('Auth', () => {
  it('rejects read_query with 401', async () => {
    const { mcp } = createMcpClient('/mcp/admin')
    const response = await mcp('tools/call', { name: 'read_query', arguments: { entity: 'Books' } })
    expect(response.error || response.result?.isError).to.be.true
    const errorText = response.error?.message || response.result?.content?.[0]?.text || ''
    expect(errorText).to.match(/401/i)
    expect(errorText).to.match(/authoriz/i)
  })

  describe('unauthorized user (bob - no admin role)', () => {
    it('rejects read_query with 403', async () => {
      const { callTool } = createMcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.match(/403/i)
      expect(error).to.match(/authoriz/i)
    })

    //TODO
    it('allows describe_model (metadata only)', async () => {
      const { callTool } = createMcpClient('/mcp/admin', 'bob:')
      const { error } = await callTool('describe_model')
      expect(error).to.be.null
    })
  })

  describe('authorized user (alice - admin role)', () => {
    it('allows read_query', async () => {
      const { callTool } = createMcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('read_query', { entity: 'Books' })
      expect(error).to.be.null
    })

    it('allows describe_model', async () => {
      const { callTool } = createMcpClient('/mcp/admin', 'alice:')
      const { error } = await callTool('describe_model')
      expect(error).to.be.null
    })
  })

})

