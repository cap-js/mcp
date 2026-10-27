import { McpClient } from '../../lib/ui/client.mjs'

const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

describe('UI Streamable HTTP client', () => {
  it('forwards UI authentication to the MCP endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ id: 1, result: { tools: [] } }))
    await new McpClient('/mcp', fetcher, 'Basic dGVzdDo=').listTools()
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Basic dGVzdDo=')
  })
  it('negotiates protocol version and sends initialized notification', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1, result: { protocolVersion: '2025-11-25' } }), {
          headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session' }
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
    const client = new McpClient('/mcp/custom', fetcher)
    await client.initialize()
    const [endpoint, request] = fetcher.mock.calls[1]
    expect(endpoint).toBe('/mcp/custom')
    expect(request.headers['MCP-Protocol-Version']).toBe('2025-11-25')
    expect(request.headers['Mcp-Session-Id']).toBe('session')
    expect(request.credentials).toBe('same-origin')
    expect(JSON.parse(request.body)).toEqual({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
  })

  it('parses fragmented UTF-8 SSE, skipping notifications and unrelated responses', async () => {
    const text =
      ': keepalive\r\n\r\ndata: {"method":"notifications/message"}\r\n\r\ndata: {"id":7,"result":{}}\r\n\r\nevent: message\r\ndata: {"id":1,\r\ndata: "result":{"tools":[{"name":"Grüße"}]}}\r\n\r\n'
    const bytes = new TextEncoder().encode(text)
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      }
    })
    const client = new McpClient(
      '/mcp',
      async () => new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    )
    expect(await client.listTools()).toEqual([{ name: 'Grüße' }])
  })

  it('loads every page of the tool list', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({ id: 1, result: { tools: [{ name: 'one' }], nextCursor: 'next' } })
      )
      .mockResolvedValueOnce(json({ id: 2, result: { tools: [{ name: 'two' }] } }))
    const client = new McpClient('/mcp', fetcher)
    expect(await client.listTools()).toEqual([{ name: 'one' }, { name: 'two' }])
    expect(JSON.parse(fetcher.mock.calls[1][1].body).params).toEqual({ cursor: 'next' })
  })

  it('surfaces HTTP and JSON-RPC errors', async () => {
    const http = new McpClient(
      '/mcp',
      async () => new Response('{"error":{"message":"Access denied"}}', { status: 403 })
    )
    await expect(http.listTools()).rejects.toThrow('HTTP 403: Access denied')
    const rpc = new McpClient('/mcp', async () =>
      json({ id: 1, error: { code: -32602, message: 'Invalid arguments' } })
    )
    await expect(rpc.callTool('query', {})).rejects.toThrow('Invalid arguments')
  })

  it('rejects truncated streams and mismatched JSON responses', async () => {
    const stream = new McpClient(
      '/mcp',
      async () =>
        new Response('data: {"method":"notifications/message"}\n\n', {
          headers: { 'Content-Type': 'text/event-stream' }
        })
    )
    await expect(stream.listTools()).rejects.toThrow('without a response')
    const mismatch = new McpClient('/mcp', async () => json({ id: 9, result: { tools: [] } }))
    await expect(mismatch.listTools()).rejects.toThrow('Invalid MCP response')
  })
})
