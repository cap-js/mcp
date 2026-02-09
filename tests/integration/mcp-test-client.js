async function parseResponseStream(data) {
  const str = typeof data === 'string' ? data : await new Response(data).text()
  return JSON.parse(str.split('\n').find(l => l.startsWith('data: ')).slice(6))
}

module.exports = (test) => (endpoint = '/mcp/catalog', auth = null) => {
  let requestId = 0

  const getHeaders = () => {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream'
    }
    if (auth) {
      headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
    }
    return headers
  }

  const mcp = async (method, params = {}) => {
    try {
      const response = await test.POST(
        endpoint,
        { jsonrpc: '2.0', id: ++requestId, method, params },
        { headers: getHeaders() }
      )
      return parseResponseStream(response.data)
    } catch (err) {
      // Handle HTTP errors (401, 403) from authorization failures
      if (err.response?.data) return err.response.data
      throw err
    }
  }

  const initialize = () => mcp('initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' }
  })

  const callTool = async (name, args = {}) => {
    const res = await mcp('tools/call', { name, arguments: args })
    if (res.error) {
      return { ...res, content: null, error: res.error.message }
    }
    return {
      ...res,
      content: res.result.isError ? null : JSON.parse(res.result.content[0].text),
      error: res.result.isError ? res.result.content[0].text : null
    }
  }

  return { mcp, callTool, initialize }
}
