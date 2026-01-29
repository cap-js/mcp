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

// Validates field references including path expressions
function validateFields(fields, entity, definitions) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return []

  return fields.filter(field => {
    const segments = field.split('.')
    let currentEntity = entity

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const element = currentEntity.elements?.[segment]

      if (!element) return true // Invalid - element doesn't exist

      // If not the last segment, must be an association
      if (i < segments.length - 1) {
        if (!element.target) return true // Invalid - not an association

        // Resolve association target
        currentEntity = definitions[element.target]
        if (!currentEntity) return true // Invalid - target entity not found
      }
    }

    return false // Valid
  })
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
  const definitions = srv.model?.definitions || {}

  // REVISIT: Validate entity exists (should be caught by schema, but double-check)
  if (!entity) {
    return errorResponse(`Error: Entity '${entityName}' not found in service. Use describe_model to see available entities.`)
  }

  // Validate filter fields exist in entity (extract field references from CQN where array)
  if (args.filter && Array.isArray(args.filter)) {
    const referencedFields = extractFieldsFromWhere(args.filter)
    const invalid = validateFields(referencedFields, entity, definitions)
    if (invalid.length > 0) {
      return errorResponse(`Error: Invalid filter field(s): ${[...new Set(invalid)].join(', ')}. Use describe_model to see available fields for ${entityName}.`)
    }
  }

  // Validate select fields exist in entity
  const invalidSelect = validateFields(args.select, entity, definitions)
  if (invalidSelect.length > 0) {
    return errorResponse(`Error: Invalid select field(s): ${invalidSelect.join(', ')}. Use describe_model to see available fields for ${entityName}.`)
  }

  // Validate orderBy fields exist in entity
  const orderByFields = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []
  const invalidOrderBy = validateFields(orderByFields, entity, definitions)
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

    // Get base entity for projections to access doc comments
    const baseEntity = cds.db.resolve.table(entity);

    const entityDoc = entity.doc || baseEntity?.doc
    const label = cds.i18n.labels.at(entity, 'en') || entity['@description'] || entity['@title'] || `Entity ${entityName}`
    const entityDescription = entityDoc ? `${entityDoc}\n\n${label}` : label

    description.entities[entityName] = {
      description: entityDescription,
      elements: {}
    }

    for (const [elemName, elem] of Object.entries(entity.elements || {})) {
      // Get doc from base entity element if not on projection
      const baseElem = baseEntity?.elements?.[elemName]
      const elemDoc = elem.doc || baseElem?.doc

      const elemLabel = cds.i18n.labels.at(elem, 'en') || elem['@description'] || elem['@title'] || `Element ${elemName}`
      const elemDescription = elemDoc ? `${elemDoc}\n\n${elemLabel}` : elemLabel

      description.entities[entityName].elements[elemName] = {
        type: elem.type,
        key: elem.key || false,
        description: elemDescription,
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
