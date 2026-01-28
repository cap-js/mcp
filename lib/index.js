const cds = require('@sap/cds')
const express = require('express')
const z = require('zod')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { isInitializeRequest } = require('@modelcontextprotocol/sdk/types.js')
const {
  createReadInputSchema,
  extractFieldsFromWhere
} = require('./utils/cds-to-schema')

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

  // Add a describe_model tool for service introspection
  const entityNames = Object.keys(entities)
  const describeModelInputSchema =
    z.object({
      entity: z.enum([...entityNames]).optional()
        .describe('Specific entity name to describe. If omitted, describes all entities.')
    })

  server.registerTool(
    'describe_model',
    {
      description: `Describe the data model of ${srv.name} service`,
      inputSchema: describeModelInputSchema
    },
    async (args) => executeDescribeModel(srv, entities, args)
  )

  return { server }
}

// Register a single generic read_query tool for all entities
function registerGenericReadTool(server, srv, entities) {
  const entityNames = Object.keys(entities)
  const inputSchema = createReadInputSchema({ entityNames })

  server.registerTool(
    'read_query',
    {
      description: `Query any entity in ${srv.name} service. Use describe_model to discover available entities and their fields.`,
      inputSchema
    },
    async (args) => executeGenericReadTool(srv, entities, args)
  )

  LOG.debug('Registered generic tool', { tool: 'read_query', service: srv.name })
}

// Register individual read tools per entity (default behavior)
function registerPerEntityReadTools(server, srv, entities) {
  for (const [entityName, entity] of Object.entries(entities)) {
    const toolName = `read_${entityName}`
    const description = entity['@description'] ||
      entity['@title'] ||
      `Read ${entityName} entities from ${srv.name}`

    server.registerTool(
      toolName,
      {
        description,
        inputSchema: createReadInputSchema()
      },
      async (args) => executeReadTool(srv, entityName, args)
    )

    LOG.debug('Registered tool', { tool: toolName, service: srv.name, entity: entityName })
  }
}

// Execute generic read_query tool
async function executeGenericReadTool(srv, entities, args) {
  LOG('Executing read_query', { entity: args.entity })

  const entityName = args.entity
  const entity = entities[entityName]

  // Validate entity exists (should be caught by schema, but double-check)
  if (!entity) {
    return {
      content: [{
        type: 'text',
        text: `Error: Entity '${entityName}' not found in service. Use describe_model to see available entities.`
      }],
      isError: true
    }
  }

  // Validate filter fields exist in entity (extract field references from CQN where array)
  if (args.filter && Array.isArray(args.filter)) {
    const referencedFields = extractFieldsFromWhere(args.filter)
    const invalidFields = referencedFields.filter(field => !entity.elements?.[field])
    if (invalidFields.length > 0) {
      return {
        content: [{
          type: 'text',
          text: `Error: Invalid filter field(s): ${[...new Set(invalidFields)].join(', ')}. Use describe_model to see available fields for ${entityName}.`
        }],
        isError: true
      }
    }
  }

  // Validate select fields exist in entity
  if (args.select && Array.isArray(args.select)) {
    const invalidFields = args.select.filter(field => !entity.elements?.[field])
    if (invalidFields.length > 0) {
      return {
        content: [{
          type: 'text',
          text: `Error: Invalid select field(s): ${invalidFields.join(', ')}. Use describe_model to see available fields for ${entityName}.`
        }],
        isError: true
      }
    }
  }

  // Validate orderBy fields exist in entity
  if (args.orderBy) {
    const orderByFields = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]
    const invalidFields = orderByFields.filter(field => !entity.elements?.[field])
    if (invalidFields.length > 0) {
      return {
        content: [{
          type: 'text',
          text: `Error: Invalid orderBy field(s): ${invalidFields.join(', ')}. Use describe_model to see available fields for ${entityName}.`
        }],
        isError: true
      }
    }
  }
  return executeReadTool(srv, entityName, args)
}

// Transform MCP to CQN and execute the read operation
async function executeReadTool(srv, entityName, args) {
  const toolName = `read_${entityName}`
  LOG('Executing', toolName)

  try {
    let query = SELECT.from(entityName)

    if (args.select && Array.isArray(args.select) && args.select.length > 0) {
      query.columns(...args.select)
    }

    // Apply CQN where clause filter (xo[] array format)
    if (args.filter && Array.isArray(args.filter) && args.filter.length > 0) {
      query.where(args.filter)
    }

    if (args.orderBy) {
      const fields = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]
      if (args.sort) {
        const orderByExpr = fields.map(field => ({ ref: [field], sort: args.sort }))
        query.orderBy(...orderByExpr)
      } else {
        query.orderBy(...fields)
      }
    }

    const limit = args.limit ?? 20
    query.limit(limit)

    // Execute query through CAP service (push down to DB)
    const result = await srv.run(query)

    // Format result for MCP
    const resultArray = Array.isArray(result) ? result : [result]
    const count = resultArray.length

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          entity: entityName,
          count,
          data: resultArray
        }, null, 2)
      }],
      structuredContent: {
        entity: entityName,
        count,
        data: resultArray
      }
    }
  } catch (err) {
    LOG.error('Tool execution failed', { tool: toolName, error: err.message })

    // Handle authorization errors
    if (err.code === 401 || err.code === 403) {
      return {
        content: [{
          type: 'text',
          text: `Authorization error (${err.code}): You are not authorized to read ${entityName}. ${err.message}`
        }],
        isError: true
      }
    }

    return {
      content: [{
        type: 'text',
        text: `Error reading ${entityName}: ${err.message}`
      }],
      isError: true
    }
  }
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

async function executeDescribeModel(srv, entities, args) {
  LOG('Executing describe_model')

  const description = {
    service: srv.name,
    entities: {}
  }

  const entityNames = args.entity ? [args.entity] : Object.keys(entities);

  for (const entityName of entityNames) {
    const entity = entities[entityName]
    if (!entity) continue

    description.entities[entityName] = {
      description: cds.i18n.labels.at(entity, 'en') || entity['@description'] || entity['@title'] || `Entity ${entityName}`,
      elements: {}
    }

    for (const [elemName, elem] of Object.entries(entity.elements || {})) {
      description.entities[entityName].elements[elemName] = {
        type: elem.type,
        key: elem.key || false,
        description: cds.i18n.labels.at(elem, 'en') || elem['@description'] || elem['@title'] || `Element ${elemName}`,
        isAssociation: !!elem.target
      }

      // associations ?
      if (elem.target) {
        description.entities[entityName].elements[elemName].target = elem.target
      }
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(description, null, 2)
    }],
    structuredContent: description
  }
}
