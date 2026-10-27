const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')

describe('MCP tool UI', () => {
  it('serves the UI and browser assets at the service endpoint', async () => {
    const page = await test.GET('/mcp/catalog/-/ui/')
    expect(page.status).toBe(200)
    expect(page.data).toContain('MCP Tools')
    expect(page.headers['cache-control']).toBe('no-store')
    const assets = await Promise.all(
      ['ui.js', 'client.mjs', 'style.css'].map((asset) => test.GET('/mcp/catalog/-/ui/' + asset))
    )
    expect(assets.every((asset) => asset.status === 200)).toBe(true)
  })

  it('redirects the UI directory while preserving target arguments', async () => {
    const response = await fetch(test.url + '/mcp/catalog/-/ui?target=Books', {
      redirect: 'manual'
    })
    expect(response.status).toBe(301)
    expect(response.headers.get('location')).toBe('/mcp/catalog/-/ui/?target=Books')
  })

  it('does not serve server source files', async () => {
    const response = await fetch(test.url + '/mcp/catalog/-/ui/index.js')
    expect(response.status).toBe(404)
  })

  it('keeps GET on the MCP transport unavailable', async () => {
    const response = await fetch(test.url + '/mcp/catalog')
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
  })

  it('enforces service authorization on the UI and its assets', async () => {
    const anonymous = await fetch(test.url + '/mcp/admin/-/ui/')
    expect(anonymous.status).toBe(401)
    expect(anonymous.headers.get('www-authenticate')).toContain('Basic')
    const denied = await fetch(test.url + '/mcp/admin/-/ui/ui.js', {
      headers: { Authorization: 'Basic ' + Buffer.from('bob:').toString('base64') }
    })
    expect(denied.status).toBe(403)
    const allowed = await test.GET('/mcp/admin/-/ui/', {
      auth: { username: 'alice', password: '' }
    })
    expect(allowed.status).toBe(200)
  })

  it('initializes, lists and runs tools using the browser transport client', async () => {
    const { McpClient } = await import('../../lib/ui/client.mjs')
    const client = new McpClient(test.url + '/mcp/catalog')
    const info = await client.initialize()
    expect(info.serverInfo.name).toBe('CatalogService')
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name)).toContain('call')
    const result = await client.callTool('call', { action: 'sum', parameters: { x: 3, y: 5 } })
    expect(result.isError).not.toBe(true)
    expect(result.content[0].text).toContain('8')
    const invalid = await client.callTool('call', { action: 'doesNotExist' })
    expect(invalid.isError).toBe(true)
  })

  it('registers endpoint-aware index links without executing tools', () => {
    const provider = cds.services.CatalogService.$linkProviders.find(
      (provider) => provider(undefined, { kind: 'mcp', path: '/custom/catalog' })?.name === 'Tools'
    )
    expect(provider(undefined, { kind: 'odata', path: '/odata/catalog' })).toBeUndefined()
    expect(provider(undefined, { kind: 'mcp', path: '/custom/catalog' }).href).toBe(
      '/custom/catalog/-/ui/'
    )
    expect(provider('Books', { kind: 'mcp', path: '/custom/catalog' })).toMatchObject({
      group: 'primary',
      href: '/custom/catalog/-/ui/?target=Books'
    })
  })
})
