const cds = require('@sap/cds')
const z = require('zod')
const {
  createReadInputSchema,
  extractFieldsFromWhere
} = require('./utils/cds-to-schema')

const LOG = cds.log('mcp')

// Create MCP error response
function errorResponse(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

function validateFields(fields, entity) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return []
  return fields.filter(field => !entity.elements?.[field])
}

// Register a single generic read_query tool for all entities (default behavior)
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

// Register individual read tools per entity
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

// Register the describe_model tool for service introspection
function registerDescribeModelTool(server, srv, entities) {
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

  LOG.debug('Registered tool', { tool: 'describe_model', service: srv.name })
}

async function executeGenericReadTool(srv, entities, args) {
  LOG('Executing read_query', { entity: args.entity })

  const entityName = args.entity
  const entity = entities[entityName]

  // REVISIT: Validate entity exists (should be caught by schema, but double-check)
  if (!entity) {
    return errorResponse(`Error: Entity '${entityName}' not found in service. Use describe_model to see available entities.`)
  }

  // Validate filter fields exist in entity (extract field references from CQN where array)
  if (args.filter && Array.isArray(args.filter)) {
    const referencedFields = extractFieldsFromWhere(args.filter)
    const invalid = validateFields(referencedFields, entity)
    if (invalid.length > 0) {
      return errorResponse(`Error: Invalid filter field(s): ${[...new Set(invalid)].join(', ')}. Use describe_model to see available fields for ${entityName}.`)
    }
  }

  // Validate select fields exist in entity
  const invalidSelect = validateFields(args.select, entity)
  if (invalidSelect.length > 0) {
    return errorResponse(`Error: Invalid select field(s): ${invalidSelect.join(', ')}. Use describe_model to see available fields for ${entityName}.`)
  }

  // Validate orderBy fields exist in entity
  const orderByFields = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []
  const invalidOrderBy = validateFields(orderByFields, entity)
  if (invalidOrderBy.length > 0) {
    return errorResponse(`Error: Invalid orderBy field(s): ${invalidOrderBy.join(', ')}. Use describe_model to see available fields for ${entityName}.`)
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
      return errorResponse(`Authorization error (${err.code}): You are not authorized to read ${entityName}. ${err.message}`)
    }

    return errorResponse(`Error reading ${entityName}: ${err.message}`)
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

module.exports = {
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerDescribeModelTool
}
