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

const LOG = cds.log('mcp')

// Session store: sessionId → { transport, server }
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
        // Check service-level authorization before creating server
        const serviceAuth = checkServiceAuthorization(srv)
        if (!serviceAuth.authorized) {
          const { code } = serviceAuth
          const message = `Authorization error (${code}): Not authorized to access ${srv.name}.`

          LOG.debug('MCP server not created due to service authorization', { service: srv.name, code })

          return res.status(code).json({
            jsonrpc: '2.0',
            error: {
              code: code === 401 ? -32001 : -32003,
              message
            },
            id: req.body?.id || null
          })
        }

        // New initialization request - create new session
        const result = createMcpServer(srv)

        // Handle entity-level authorization errors (no accessible entities)
        if (result.error) {
          const { code, reason } = result.error
          const message = `Authorization error (${code}): Not authorized to access ${srv.name}. No entities accessible with your current authorization.`

          LOG.debug('MCP server not created due to entity authorization', { service: srv.name, code, reason })

          return res.status(code).json({
            jsonrpc: '2.0',
            error: {
              code: code === 401 ? -32001 : -32003,
              message
            },
            id: req.body?.id || null
          })
        }

        const server = result.server
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
          error: { code: -32001, message: 'Session not found' },
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
        // REVISIT: can cds.error be used here?
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
        error: { code: -32001, message: 'Session not found' },
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

// Creates an MCP server instance with tools for each entity in the service
// Returns { server } on success, or { error } if no accessible entities
function createMcpServer(srv) {
  const user = cds.context?.user

  // Filter out auto-exposed and draft entities
  let entities = Object.fromEntries(
    Object.entries(srv.entities || {})
      .filter(([name, entity]) => !entity['@cds.autoexposed'] && !name.endsWith('DraftAdministrativeData'))
  )

  // Filter by entity-level authorization
  entities = getAccessibleEntities(entities, user)

  // No accessible entities = no MCP server
  if (Object.keys(entities).length === 0) {
    const code = (!user || user.id === 'anonymous') ? 401 : 403
    return {
      error: {
        authorized: false,
        code,
        reason: 'no_accessible_entities'
      }
    }
  }

  const server = new McpServer({
    name: srv.name,
    version: '1.0.0'
  })

  const usePerEntityTools = cds.env.features?.mcp_per_entity_tool === true

  if (usePerEntityTools) {
    registerPerEntityReadTools(server, srv, entities)
  } else {
    registerGenericReadTool(server, srv, entities)
  }

  registerDescribeModelTool(server, srv, entities)

  return { server }
}

function checkServiceAuthorization(srv) {
  const requires = srv.definition?.['@requires']
  if (!requires) return { authorized: true }

  const user = cds.context?.user
  const roles = Array.isArray(requires) ? requires : [requires]

  // Check if any of the required roles is satisfied
  for (const role of roles) {
    // 'any' pseudo-role allows everyone
    if (role === 'any') return { authorized: true }

    if (role === 'authenticated-user') {
      if (user && user.id !== 'anonymous') return { authorized: true }
      continue
    }

    if (user?.is?.(role)) return { authorized: true }
  }

  const code = (!user || user.id === 'anonymous') ? 401 : 403
  return { authorized: false, code }
}

function checkEntityReadAccess(entity, user) {
  const restrict = entity['@restrict']
  if (!restrict) return true

  for (const privilege of restrict) {
    const grants = Array.isArray(privilege.grant) ? privilege.grant : [privilege.grant]
    if (!grants.includes('READ') && !grants.includes('*')) continue

    const toRoles = privilege.to
    if (!toRoles) {
      if (user && user.id !== 'anonymous') return true
      continue
    }

    const roles = Array.isArray(toRoles) ? toRoles : [toRoles]
    for (const role of roles) {
      if (role === 'any') return true
      if (role === 'authenticated-user') {
        if (user && user.id !== 'anonymous') return true
        continue
      }
      if (user?.is?.(role)) return true
    }
  }
  return false
}

// Filter entities to only those the user can READ.
function getAccessibleEntities(entities, user) {
  return Object.fromEntries(
    Object.entries(entities).filter(([, entity]) =>
      checkEntityReadAccess(entity, user)
    )
  )
}
