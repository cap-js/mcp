const cds = require('@sap/cds')
const z = require('zod') // zod is not in the dependencies -> do we really need it?
const {
  createReadInputSchema,
  extractFieldsFromWhere,
  createActionInputSchema
} = require('./utils/cds-to-schema')
const { resolveQueryLimits } = require('./utils/limits')

const LOG = cds.log('mcp')

const formatResult = cds.env.features?.mcp_format_json ? JSON.stringify : formatAsToon

function formatAsToon(data) {
  try {
    var toon = formatAsToon.toon ??= require('@toon-format/toon')
  } catch {
    throw new Error(
      '@toon-format/toon is not installed.\n' +
      'Please install it with: npm add @toon-format/toon\n' +
      'Or enable JSON format with: cds.env.features.mcp_format_json = true'
    )
  }
  return toon.encode(data)
}

// Draft-related elements added by CAP for draft-enabled entities
const DRAFT_ELEMENTS = [
  'IsActiveEntity',
  'HasDraftEntity',
  'HasActiveEntity',
  'DraftAdministrativeData',
  'DraftAdministrativeData_DraftUUID',
  'SiblingEntity',
  'DraftMessages'
]

const LOCALIZED_ELEMENTS = ['localized', 'texts']

function resolveI18n(value, locale) {
  if (!value) return undefined
  const match = /{i18n>([^}]+)}/.exec(value)
  if (match) {
    return cds.i18n.labels.texts4?.(locale)?.[match[1]] || value
  }
  return value
}

function getDescription(obj, locale) {
  locale = locale || cds.context?.locale || 'en'

  const title = cds.i18n.labels.at(obj, locale)
    || resolveI18n(obj['@Common.Label'], locale)
    || resolveI18n(obj['@title'], locale)

  const description = resolveI18n(obj['@Core.Description'], locale)
    || resolveI18n(obj['@description'], locale)

  const longDescription = resolveI18n(obj['@Core.LongDescription'], locale)

  const parts = [title, description].filter(Boolean)
  if (parts.length === 0 && !longDescription) return undefined

  let result = parts.join('\n')

  if (longDescription) {
    result = result ? `${result}\n\n${longDescription}` : longDescription
  }

  return result || undefined
}

// Create MCP error response
function errorResponse(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

// Build clean args object for logging (filter out empty values)
function buildQueryArgs(args) {
  return Object.fromEntries(
    Object.entries(args).filter(([, v]) =>
      v !== undefined && v !== null &&
      !(Array.isArray(v) && v.length === 0)
    )
  )
}

// Validates field references including path expressions
function validateFields(fields, entity, definitions) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return []

  return fields.filter(field => {
    // (aggregate expressions)
    if (typeof field !== 'string') return false
    
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

function createGenericReadToolDefinition(entityNames, serviceName) {
  return {
    name: 'query',
    description: `Query any entity in ${serviceName} service. Use describe to discover available entities and their fields.`,
    inputSchema: createReadInputSchema({ entityNames }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  }
}

function createPerEntityReadToolDefinition(entityName, entity, serviceName) {
  const description = getDescription(entity) || `Read ${entityName} entities from ${serviceName}`

  return {
    name: `read_${entityName}`,
    description,
    inputSchema: createReadInputSchema(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
}

function createDescribeToolDefinition(entityNames, actionNames, serviceName) {
  const schemaFields = {}

  if (entityNames.length > 0) {
    schemaFields.entity = z.enum(entityNames).optional()
      .describe('Specific entity to get element details for.')
  }

  if (actionNames.length > 0) {
    schemaFields.action = z.enum(actionNames).optional()
      .describe('Specific action or function to get parameter details for.')
  }

  return {
    name: 'describe',
    description: `Describe the data model of ${serviceName} service. ` +
      `Returns an overview of all entities and actions with descriptions. ` +
      `Specify 'entity' to get element details, or 'action' to get parameter details.`,
    inputSchema: z.object(schemaFields),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  }
}

function createCallActionToolDefinition(actionNames, serviceName) {
  return {
    name: 'call_action',
    description: `Call an unbound action or function in ${serviceName} service. Use describe to discover available actions and their parameters.`,
    inputSchema: createActionInputSchema(actionNames),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }
}

// Register a single generic query tool for all entities (default behavior)
function registerGenericReadTool(server, srv, entities) {
  const entityNames = Object.keys(entities)
  if (entityNames.length === 0) {
    LOG.debug('No entities to register tools for', { service: srv.name })
    return
  }

  const def = createGenericReadToolDefinition(entityNames, srv.name)

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations
    },
    (args) => executeGenericReadTool(srv, entities, args)
  )

  LOG.debug('Registered generic tool', { tool: def.name, service: srv.name })
}

// Register individual read tools per entity
function registerPerEntityReadTools(server, srv, entities) {
  const entityEntries = Object.entries(entities)
  if (entityEntries.length === 0) {
    LOG.debug('No entities to register tools for', { service: srv.name })
    return
  }

  for (const [entityName, entity] of entityEntries) {
    // Get base entity for projections to access doc comments (runtime-specific)
    const baseEntity = cds.db?.resolve?.table?.(entity)
    const entityDoc = entity.doc || baseEntity?.doc

    const def = createPerEntityReadToolDefinition(entityName, entity, srv.name, entityDoc)

    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations
      },
      (args) => executeReadTool(srv, entityName, entity, args)
    )

    LOG.debug('Registered tool', { tool: def.name, service: srv.name, entity: entityName })
  }
}

// Register the describe tool for service introspection
function registerDescribeTool(server, srv, entities, actions = {}) {
  const entityNames = Object.keys(entities)
  const actionNames = Object.keys(actions)
  if (entityNames.length === 0 && actionNames.length === 0) {
    LOG.debug('No entities or actions to describe', { service: srv.name })
    return
  }

  const def = createDescribeToolDefinition(entityNames, actionNames, srv.name)

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations
    },
    (args) => executeDescribe(srv, entities, actions, args)
  )

  LOG.debug('Registered tool', { tool: def.name, service: srv.name })
}

// Register the call_action tool for invoking unbound actions/functions
function registerCallActionTool(server, srv, actions) {
  const actionNames = Object.keys(actions)
  if (actionNames.length === 0) return // No actions to register

  const def = createCallActionToolDefinition(actionNames, srv.name)

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations
    },
    (args) => executeCallActionTool(srv, actions, args)
  )

  LOG.debug('Registered tool', { tool: def.name, service: srv.name, actions: actionNames })
}

async function executeGenericReadTool(srv, entities, args) {
  const { entity: entityName } = args
  LOG('query', buildQueryArgs(args))

  const entity = entities[entityName]
  const definitions = srv.model?.definitions || {}

  // REVISIT: Validate entity exists (should be caught by schema, but double-check)
  if (!entity) {
    return errorResponse(`Error: Entity '${entityName}' not found in service. Use describe to see available entities.`)
  }

  // Validate where fields exist in entity (extract field references from CQN where array)
  if (args.where && Array.isArray(args.where)) {
    const referencedFields = extractFieldsFromWhere(args.where)
    const invalid = validateFields(referencedFields, entity, definitions)
    if (invalid.length > 0) {
      return errorResponse(`Error: Invalid where field(s): ${[...new Set(invalid)].join(', ')}. Use describe to see available fields for ${entityName}.`)
    }
  }

  // Validate select fields exist in entity
  const invalidSelect = validateFields(args.select, entity, definitions)
  if (invalidSelect.length > 0) {
    return errorResponse(`Error: Invalid select field(s): ${invalidSelect.join(', ')}. Use describe to see available fields for ${entityName}.`)
  }

  // Validate orderBy fields exist in entity (but allow aggregate aliases from select)
  const orderByFields = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []
  // Extract aliases from aggregate expressions in select
  const aggregateAliases = (args.select || [])
    .filter(col => typeof col === 'object' && col.as)
    .map(col => col.as)
  // Filter out aggregate aliases from orderBy validation
  const orderByFieldsToValidate = orderByFields.filter(f => !aggregateAliases.includes(f))
  const invalidOrderBy = validateFields(orderByFieldsToValidate, entity, definitions)
  if (invalidOrderBy.length > 0) {
    return errorResponse(`Error: Invalid orderBy field(s): ${invalidOrderBy.join(', ')}. Use describe to see available fields for ${entityName}.`)
  }

  return executeReadTool(srv, entityName, entity, args, { skipLog: true })
}

// Transform MCP to CQN and execute the read operation
async function executeReadTool(srv, entityName, entity, args, options = {}) {
  if (!options.skipLog) {
    LOG(`read_${entityName}`, buildQueryArgs(args))
  }

  try {
    let query = SELECT.from(entityName)

    if (args.distinct) {
      query.SELECT.distinct = true
    }

    if (args.select && Array.isArray(args.select) && args.select.length > 0) {
      query.columns(...args.select)
    }

    // Apply CQN where clause (xo[] array format)
    if (args.where && Array.isArray(args.where) && args.where.length > 0) {
      query.where(args.where)
    }

    // Apply groupBy clause for aggregation queries
    if (args.groupBy && Array.isArray(args.groupBy) && args.groupBy.length > 0) {
      query.groupBy(...args.groupBy)
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

    if (args.one) {
      query.SELECT.one = true
    } else {
      // resolve limits following CAP precedence: entity > service > global > MCP fallback
      const limits = resolveQueryLimits(entity, srv.definition)

      let effectiveLimit = args.limit ?? limits.default

      if (effectiveLimit && limits.max)
        effectiveLimit = Math.min(effectiveLimit, limits.max)

      if (effectiveLimit)
        query.limit(effectiveLimit)
    }

    // Execute query through CAP service (push down to DB)
    const result = await srv.run(query)

    if (args.one) {
      const data = result || null
      const structured = { entity: entityName, count: 1, data }
      return {
        content: [{ type: 'text', text: formatResult(structured) }],
        structuredContent: structured
      }
    }

    const resultArray = Array.isArray(result) ? result : [result]
    const count = resultArray.length
    const structured = { entity: entityName, count, data: resultArray }

    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    LOG.error('Tool execution failed', { tool: `read_${entityName}`, error: err.message })

    // Handle authorization errors
    if (err.code === 401 || err.code === 403) {
      return errorResponse(`Authorization error (${err.code}): You are not authorized to read ${entityName}. ${err.message}`)
    }

    return errorResponse(`Error reading ${entityName}: ${err.message}`)
  }
}

const removeCdsPrefix = (type) => type?.replace(/^cds\./, '') || type

async function executeDescribe(srv, entities, actions, args) {
  // Determine what to include:
  // - If only entity specified => return only that entity (no actions)
  // - If only action specified => return only that action (no entities)
  // - If both specified => return both
  // - If neither specified => return all entities and all actions
  const includeEntities = args.entity || !args.action
  const includeActions = args.action || !args.entity

  // Detail mode: show elements/parameters when specific entity/action is requested
  const isEntityDetail = !!args.entity
  const isActionDetail = !!args.action

  const entityNames = args.entity ? [args.entity] : Object.keys(entities)
  const actionNamesToDescribe = args.action ? [args.action] : Object.keys(actions || {})

  LOG('describe', {
    ...(includeEntities && { entities: entityNames }),
    ...(includeActions && { actions: actionNamesToDescribe })
  })

  const description = {
    service: srv.name,
    description: getDescription(srv.definition) || `Service ${srv.name}`
  }

  // Add entities if included
  if (includeEntities) {
    description.entities = {}

    for (const entityName of entityNames) {
      const entity = entities[entityName]
      if (!entity) continue

      const entityDescription = getDescription(entity) || `Entity ${entityName}`

      // Overview mode: only description
      if (!isEntityDetail) {
        description.entities[entityName] = { description: entityDescription }
        continue
      }

      // Detail mode: include queryLimits and elements
      const queryLimits = resolveQueryLimits(entity, srv.definition)

      description.entities[entityName] = {
        description: entityDescription,
        queryLimits,
        elements: {}
      }

      for (const [elemName, elem] of Object.entries(entity.elements || {})) {
        // Skip draft-related and localized elements
        if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue

        const elemDescription = getDescription(elem) || `Element ${elemName}`

        if (elem.target) {
          // Association element
          description.entities[entityName].elements[elemName] = {
            type: `${removeCdsPrefix(elem.type)} (${elem.is2one ? '1-1' : '1-*'})`,
            target: elem.target,
            description: elemDescription
          }
        } else {
          // Regular element
          description.entities[entityName].elements[elemName] = {
            type: removeCdsPrefix(elem.type),
            description: elemDescription
          }
        }
      }
    }
  }

  // Add actions if included
  if (includeActions) {
    description.actions = {}

    for (const actionName of actionNamesToDescribe) {
      const action = actions?.[actionName]
      if (!action) continue
      const actionDescription = getDescription(action) || `${action.kind} ${actionName}`

      // Overview mode: only kind and description
      if (!isActionDetail) {
        description.actions[actionName] = {
          kind: action.kind,
          description: actionDescription
        }
        continue
      }

      // Detail mode: include parameters and returns
      let returns = null
      if (action.returns) {
        if (action.returns.type) {
          returns = removeCdsPrefix(action.returns.type)
        } else if (action.returns.items) {
          returns = { array: removeCdsPrefix(action.returns.items.type) || 'object' }
        } else if (action.returns.elements) {
          returns = { struct: Object.keys(action.returns.elements) }
        }
      }

      description.actions[actionName] = {
        kind: action.kind,
        description: actionDescription,
        parameters: {},
        returns
      }

      // Add parameter descriptions
      for (const [paramName, param] of Object.entries(action.params || {})) {
        const paramDescription = getDescription(param) || null
        description.actions[actionName].parameters[paramName] = {
          type: removeCdsPrefix(param.type),
          notNull: param.notNull || false,
          description: paramDescription
        }
      }
    }
  }

  return {
    content: [{ type: 'text', text: formatResult(description) }],
    structuredContent: description
  }
}

async function executeCallActionTool(srv, actions, args) {
  const { action: actionName, parameters = {} } = args
  LOG('call_action', { action: actionName, parameters: buildQueryArgs(parameters) })

  const action = actions[actionName]
  if (!action) {
    return errorResponse(`Error: Action '${actionName}' not found in service. Use describe to see available actions.`)
  }

  try {
    // Call the action via srv.send()
    const result = await srv.send(actionName, parameters)

    const structured = {
      action: actionName,
      kind: action.kind, // 'action' or 'function'
      result
    }

    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    LOG.error('Action execution failed', { action: actionName, error: err.message })

    // Handle authorization errors
    if (err.code === 401 || err.code === 403) {
      return errorResponse(`Authorization error (${err.code}): Not authorized to call ${actionName}. ${err.message}`)
    }

    return errorResponse(`Error calling ${actionName}: ${err.message}`)
  }
}

module.exports = {
  // Definition factories (shared with compile.js)
  createGenericReadToolDefinition,
  createPerEntityReadToolDefinition,
  createDescribeToolDefinition,
  createCallActionToolDefinition,
  // Utilities (shared with compile.js)
  getDescription,
  // Registration functions (runtime only)
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerDescribeTool,
  registerCallActionTool
}
