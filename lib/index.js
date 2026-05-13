const cds = require('@sap/cds')
const express = require('express')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const {
  registerGenericReadTool,
  registerCallActionTool,
  registerPerActionTools,
  registerDescribeTool,
  getDescription
} = require('./tools')
const { checkAuthorization } = require('./auth')

const LOG = cds.log('mcp')

// CAP Protocol Adapter for MCP (Model Context Protocol)
module.exports = function McpProtocolAdapter(srv, options = {}) {
  if (!(srv instanceof cds.ApplicationService)) {
    LOG.debug('Skipping non-ApplicationService', { service: srv.name })
    return null
  }

  const router = express.Router()

  router.post('/', async (req, res) => {
    try {
      let requestService = srv;
      if (cds?.context?.model?.definitions) {
        requestService = cds.context.model.definitions[srv.name] ?? srv;
      }
      // Check authorization on every request
      const { entities, actions, error } = checkAuthorization(requestService)
      if (error) {
        const { code, reason } = error
        LOG.debug('Authorization failed', { service: srv.name, code, reason })
        return res.status(code).json({
          jsonrpc: '2.0',
          error: {
            code: code === 401 ? -32001 : -32003,
            message: `Authorization error (${code}): Not authorized to access ${srv.name}.`
          },
          id: req.body?.id || null
        })
      }

      const server = new McpServer({
        name: srv.name,
        version: '1.0.0',
        description: getDescription(srv.definition) || `MCP server for ${srv.name}`
      })

      const entityCount = Object.keys(entities).length
      const actionCount = Object.keys(actions).length
      if (entityCount > 0 || actionCount > 0) {
        registerGenericReadTool(server, srv, entities)
        const registerActionTool = cds.env.mcp?.per_action_tool ? registerPerActionTools : registerCallActionTool;
        registerActionTool(server, srv, actions)
        registerDescribeTool(server, srv, entities, actions)
      } else {
        // No accessible entities - register empty tools capability
        server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
        LOG.debug('Registered empty tool list', { service: srv.name })
      }

      // Tools are statically determined per request - no runtime list changes
      server.server.registerCapabilities({ tools: { listChanged: false } })

      // Detect response format from Accept header
      const accept = req.headers['accept'] || ''
      const acceptsJson = accept.includes('application/json')
      const acceptsSse = accept.includes('text/event-stream')

      // Auto-detect: if client only accepts JSON, use JSON response mode
      const enableJsonResponse = acceptsJson && !acceptsSse

      // Ensure Accept header satisfies SDK validation (requires both)
      if (!acceptsJson || !acceptsSse) {
        const newAccept = 'application/json, text/event-stream'
        req.headers['accept'] = newAccept
        // Also patch rawHeaders (used by @hono/node-server for web Request conversion)
        const idx = req.rawHeaders.findIndex(h => h.toLowerCase() === 'accept')
        if (idx !== -1) {
          req.rawHeaders[idx + 1] = newAccept
        } else {
          req.rawHeaders.push('Accept', newAccept)
        }
      }

      // Create stateless transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse
      })

      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
      await server.close()
    } catch (err) {
      LOG.error('MCP request failed', { service: srv.name, error: err.message })
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal error: ' + err.message
          },
          id: req.body?.id || null
        })
      }
    }
  })

  LOG.debug('Adapter initialized', { service: srv.name })
  router.router = router
  return router
}
