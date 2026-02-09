const cds = require('@sap/cds')
const express = require('express')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const {
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerDescribeModelTool
} = require('./tools')
const { checkAuthorization } = require('./auth')

const LOG = cds.log('mcp')

// CAP Protocol Adapter for MCP (Model Context Protocol)
module.exports = function McpProtocolAdapter(srv, options = {}) {
  const router = express.Router()
  router.use(express.json())

  router.post('/', async (req, res) => {
    try {
      // Check authorization on every request
      const authResult = checkAuthorization(srv)
      if (authResult.error) {
        const { code, reason } = authResult.error
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

      const usePerEntityTools = cds.env.features?.mcp_per_entity_tool === true
      if (usePerEntityTools) {
        registerPerEntityReadTools(server, srv, authResult.entities)
      } else {
        registerGenericReadTool(server, srv, authResult.entities)
      }
      registerDescribeModelTool(server, srv, authResult.entities)

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
