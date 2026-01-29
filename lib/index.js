const cds = require('@sap/cds')
const express = require('express')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js')
const {
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerDescribeModelTool
} = require('./tools')
const { checkAuthorization } = require('./auth')

const LOG = cds.log('mcp')

// Session store: sessionId -> { transport, server }
const sessions = new Map()

// CAP Protocol Adapter for MCP (Model Context Protocol)
module.exports = function McpProtocolAdapter(srv, options = {}) {
  const router = express.Router()
  router.use(express.json())

  // Handle MCP Streamable HTTP requests (POST for tool calls)
  router.post('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id']

    try {
      let transport

      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing session
        transport = sessions.get(sessionId).transport
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // Check authorization (service + entity level)
        const authResult = checkAuthorization(srv)
        if (authResult.error) {
          const { code, reason } = authResult.error

          LOG.debug('MCP server not created due to authorization', { service: srv.name, code, reason })

          return res.status(code).json({
            jsonrpc: '2.0',
            error: {
              code: code === 401 ? -32001 : -32003,
              message: `Authorization error (${code}): Not authorized to access ${srv.name}.`
            },
            id: req.body?.id || null
          })
        }

        // Create MCP server with authorized entities
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
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => cds.utils.uuid(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server })
          }
        })

        transport.onclose = () => {
          const sid = transport.sessionId
          if (sid && sessions.has(sid)) {
            sessions.delete(sid)
          }
        }

        await server.connect(transport)
      } else if (sessionId && !sessions.has(sessionId)) {
        // Session not found
        return res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32002, message: 'Session not found' },
          id: req.body?.id || null
        })
      } else {
        // Missing session ID on non-initialization request
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Session ID required' },
          id: req.body?.id || null
        })
      }

      await transport.handleRequest(req, res, req.body)
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

  // Handle DELETE requests for session termination
  router.delete('/', async (req, res) => {
    const sessionId = req.headers['mcp-session-id']

    if (!sessionId || !sessions.has(sessionId)) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32002, message: 'Session not found' },
        id: null
      })
    }

    try {
      const { transport } = sessions.get(sessionId)
      await transport.close()
      sessions.delete(sessionId)
      res.status(200).end()
    } catch (err) {
      LOG.error('Session termination failed', { service: srv.name, sessionId, error: err.message })
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal error: ' + err.message },
          id: null
        })
      }
    }
  })

  LOG.debug('Adapter initialized', { service: srv.name })
  return router
}

// Graceful shutdown - close all active sessions
cds.on('shutdown', async () => {
  for (const [sessionId, { transport }] of sessions) {
    try {
      await transport.close()
    } catch (err) {
      LOG.error('Error closing session on shutdown', { sessionId, error: err.message })
    }
  }
  sessions.clear()
})
