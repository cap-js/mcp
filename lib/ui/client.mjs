// A small Streamable HTTP client shared by the browser UI and transport tests.
export class McpClient {
  constructor(endpoint, fetcher = globalThis.fetch.bind(globalThis), authorization = '') {
    this.endpoint = endpoint
    this.fetch = fetcher
    this.requestId = 0
    this.authorization = authorization
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'cap-mcp-ui', version: '1.0.0' }
    })
    this.protocolVersion = result.protocolVersion
    await this.request('notifications/initialized', undefined, true)
    return result
  }

  async listTools(cursor) {
    const result = await this.request('tools/list', cursor ? { cursor } : {})
    if (!result.nextCursor) return result.tools
    return [...result.tools, ...(await this.listTools(result.nextCursor))]
  }

  callTool(name, args) {
    return this.request('tools/call', { name, arguments: args })
  }

  async request(method, params, notification = false) {
    const id = notification ? undefined : ++this.requestId
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }
    if (this.authorization) headers.Authorization = this.authorization
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId
    const response = await this.fetch(this.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(60000)
    })
    const sessionId = response.headers.get('Mcp-Session-Id')
    if (sessionId) this.sessionId = sessionId
    if (!response.ok) {
      const body = await response.text()
      let message = body
      try {
        message = JSON.parse(body).error?.message || body
      } catch {
        /* plain HTTP error */
      }
      throw new Error('HTTP ' + response.status + ': ' + (message || response.statusText))
    }
    if (notification) {
      await response.body?.cancel()
      return
    }
    const message = response.headers.get('Content-Type')?.includes('text/event-stream')
      ? await readEventStream(response.body, id)
      : await response.json()
    if (message.error) throw new Error(message.error.message)
    if (message.id !== id || !Object.hasOwn(message, 'result'))
      throw new Error('Invalid MCP response.')
    return message.result
  }
}

async function readEventStream(body, id) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    for (;;) {
      // SSE responses may contain notifications before the matching RPC result.
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read()
      pending += decoder.decode(value, { stream: !done })
      const events = pending.split(/\r?\n\r?\n/)
      pending = events.pop()
      if (done && pending) events.push(pending)
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n')
        if (!data) continue
        const message = JSON.parse(data)
        if (message.id === id) return message
      }
      if (done) throw new Error('MCP stream ended without a response.')
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
