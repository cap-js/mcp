const cds = require('@sap/cds')
const express = require('express')
const { McpServer, createMcpHandler } = require('@modelcontextprotocol/server')
const { toNodeHandler } = require('@modelcontextprotocol/node')
const { getInstructions } = require('./utils/tools-shared')
const { registerDescribeTool } = require('./tools/describe')
const { registerGenericReadTool } = require('./tools/query')
const { registerCallActionTool, registerPerActionTools } = require('./tools/call')

const registerActionTool = cds.env.mcp?.per_action_tool
  ? registerPerActionTools
  : registerCallActionTool
const { getDescription } = require('./utils/cds-to-schema')
const { checkAuthorization } = require('./auth')
const { resolvePrefix } = require('./utils/service-name')

const LOG = cds.log('mcp')

// CAP Protocol Adapter for MCP (Model Context Protocol)
module.exports = function McpProtocolAdapter(srv) {
  if (!(srv instanceof cds.ApplicationService)) {
    LOG.debug('Skipping non-ApplicationService', { service: srv.name })
    return null
  }

  const router = express.Router()

  // Stateless transport: no server→client SSE stream. Spec requires GET to
  // return 405 (not Express's default 404) so Streamable HTTP clients like
  // Cursor continue after initialize instead of failing the connection.
  // See https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#listening-for-messages-from-the-server
  router.get('/', (_req, res) => {
    res
      .set('Allow', 'POST')
      .status(405)
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null
      })
  })

  router.post('/', async (req, res) => {
    try {
      let requestService = srv
      if (cds?.context?.model?.definitions) {
        requestService = cds.context.model.definitions[srv.name] ?? srv
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

      const prefix = resolvePrefix(srv.definition)

      const factory = () => {
        const server = new McpServer(
          {
            name: srv.name,
            version: '1.0.0',
            description: getDescription(srv.definition) || `MCP server for ${srv.name}`
          },
          {
            instructions: getInstructions(srv.definition, null, prefix)
          }
        )

        const entityCount = Object.keys(entities).length
        const actionCount = Object.keys(actions).length
        if (entityCount > 0 || actionCount > 0) {
          registerDescribeTool(server, srv, entities, actions, prefix)
          registerGenericReadTool(server, srv, entities, prefix)
          registerActionTool(server, srv, actions, prefix)
        } else {
          // No accessible entities - register empty tools capability
          server.server.registerCapabilities({ tools: { listChanged: false } })
          server.server.setRequestHandler('tools/list', () => ({ tools: [] }))
          LOG.debug('Registered empty tool list', { service: srv.name })
          return server
        }

        // Tools are statically determined per request - no runtime list changes
        server.server.registerCapabilities({ tools: { listChanged: false } })

        return server
      }

      const handler = createMcpHandler(factory)
      await toNodeHandler(handler)(req, res, req.body)
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
