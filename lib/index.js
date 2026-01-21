const cds = require('@sap/cds')
const express = require('express')
const z = require('zod')
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js')
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const { cdsEntityToReadInputSchema, cdsEntityToReadOutputSchema } = require('./utils/cds-to-schema')

const LOG = cds.log('mcp')

// CAP Protocol Adapter for MCP (Model Context Protocol)
module.exports = function McpProtocolAdapter(srv, options = {}) {
  const router = express.Router()
  router.use(express.json())

  // Handle MCP Streamable HTTP requests (POST for tool calls)
  router.post('/', async (req, res) => {
    try {
      // REVISIT: create fresh MCP server and transport for each request (stateless)
      const mcpServer = createMcpServer(srv)
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined
      })

      await mcpServer.connect(transport)

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

  LOG.debug('Adapter initialized', { service: srv.name })
  return router
}

// Creates an MCP server instance with tools for each entity in the service
function createMcpServer(srv) {
  const server = new McpServer({
    name: srv.name,
    version: '1.0.0'
  })

  const entities = srv.entities || {}

  for (const [entityName, entity] of Object.entries(entities)) {
    // Skip auto-exposed entities (not directly queryable)
    if (entity['@cds.autoexposed']) continue
    
    const toolName = `read_${entityName}`
    const description = entity['@description'] ||
      entity['@title'] ||
      `Read ${entityName} entities from ${srv.name}`

    server.registerTool(
      toolName,
      {
        description,
        inputSchema: cdsEntityToReadInputSchema(entity, entityName),
        outputSchema: cdsEntityToReadOutputSchema(entity, entityName)
      },
      async (args) => executeReadTool(srv, entityName, entity, args)
    )

    LOG.debug('Registered tool', { tool: toolName, service: srv.name, entity: entityName })
  }

  // Add a describe_model tool for service introspection
  const entityNames = Object.keys(entities).filter(n =>!entities[n]['@cds.autoexposed'])
  const describeModelInputSchema = entityNames.length > 0
    ? z.object({
        entity: z.enum([entityNames[0], ...entityNames.slice(1)]).optional()
          .describe('Specific entity name to describe. If omitted, describes all entities.')
      })
    : z.object({
        entity: z.string().optional()
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

  return server
}

// Transform MCP to CQN and execute the read operation
async function executeReadTool(srv, entityName, entity, args) {
  const toolName = `read_${entityName}`
  LOG('Executing', toolName)

  try {
    let query = SELECT.from(entityName)

    if (args.select && Array.isArray(args.select) && args.select.length > 0) {
      query.columns(...args.select)
    }

    if (args.filter && typeof args.filter === 'object') {
      const whereConditions = []
      for (const [field, value] of Object.entries(args.filter)) {
        if (entity.elements?.[field]) {
          // REVISIT: add more complex operations
          whereConditions.push({ ref: [field] }, '=', { val: value })
        }
      }
      if (whereConditions.length > 0) {
        query.where(args.filter)
      }
    }

    if (args.orderBy) {
      if (typeof args.orderBy === 'string') {
        query.orderBy(args.orderBy)
      } else if (Array.isArray(args.orderBy)) {
        query.orderBy(...args.orderBy)
      }
    }

    const top = args.top ?? 100
    const skip = args.skip ?? 0
    query.limit(top, skip)

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
