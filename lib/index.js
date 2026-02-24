const cds = require('@sap/cds')
const express = require('express')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const {
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerCallActionTool,
  registerDescribeTool
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
      // Check authorization on every request
      const { entities, actions, error } = checkAuthorization(srv)
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
        version: '1.0.0'
      })

      const entityCount = Object.keys(entities).length
      const actionCount = Object.keys(actions).length
      if (entityCount > 0 || actionCount > 0) {
        const registerReadTool = cds.env.features?.mcp_per_entity_tool ? registerPerEntityReadTools : registerGenericReadTool;
        registerReadTool(server, srv, entities)
        registerCallActionTool(server, srv, actions)
        registerDescribeTool(server, srv, entities, actions)
      } else {
        // No accessible entities - register empty tools capability
        server.server.registerCapabilities({ tools: { listChanged: true } })
        server.server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }))
        LOG.debug('Registered empty tool list', { service: srv.name })
      }

      // Create stateless transport
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
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
  return router
}
