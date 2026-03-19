const cds = require('@sap/cds')
const z = require('zod')

const {
  createReadInputSchema,
  extractFieldsFromWhere,
  createActionInputSchema,
  createPerActionInputSchema
} = require('./utils/cds-to-schema')
const { resolveQueryLimits } = require('./utils/limits')

const LOG = cds.log('mcp')
const { inspect } = require('util')
const fmt = obj => inspect(obj, { depth: 4, breakLength: 0, colors: true })

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

  const title = cds.i18n.labels.at(obj)
  const description = resolveI18n(obj['@description'], locale)
  const doc = obj.doc

  const parts = [title, description, doc].filter(Boolean)
  return parts.length > 0 ? parts.join('\n') : undefined
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
      if (element['@cds.api.ignore']) return true // Invalid - element is @cds.api.ignore

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
    name: `query_${entityName}`,
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
    schemaFields.entity = z.array(z.enum(entityNames)).optional()
      .describe('Specific entities to get element details for.')
  }

  if (actionNames.length > 0) {
    schemaFields.action = z.array(z.enum(actionNames)).optional()
      .describe('Specific actions or functions to get parameter details for.')
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
    const def = createPerEntityReadToolDefinition(entityName, entity, srv.name)

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

const removeCdsPrefix = (type) => type?.replace(/^cds\./, '') || type

// Build a human-readable return type string from an action definition
function describeReturns(action) {
  if (!action.returns) return null
  if (action.returns.type) return removeCdsPrefix(action.returns.type)
  if (action.returns.items) return `Array of ${removeCdsPrefix(action.returns.items.type) || 'object'}`
  if (action.returns.elements) return `{${Object.keys(action.returns.elements).join(', ')}}`
  return null
}

// Per-action tool definition factory (shared with compile.js)
function createPerActionToolDefinition(actionName, action, serviceName) {
  let description = getDescription(action) ||
    `Call ${action.kind} ${actionName} in ${serviceName}`

  // Append return type info so LLMs know without calling describe
  const returnsInfo = describeReturns(action)
  if (returnsInfo) {
    description += `. Returns: ${returnsInfo}`
  }

  return {
    name: actionName,
    description,
    inputSchema: createPerActionInputSchema(action),
    annotations: {
      readOnlyHint: action.kind === 'function',
      destructiveHint: action.kind === 'action',
      idempotentHint: action.kind === 'function',
      openWorldHint: false
    }
  }
}

// Register individual tools per action/function
function registerPerActionTools(server, srv, actions) {
  const actionEntries = Object.entries(actions)
  if (actionEntries.length === 0) {
    LOG.debug('No actions to register tools for', { service: srv.name })
    return
  }

  for (const [actionName, action] of actionEntries) {
    const def = createPerActionToolDefinition(actionName, action, srv.name)

    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations
      },
      (args) => executePerActionTool(srv, actionName, action, args)
    )

    LOG.debug('Registered tool', { tool: def.name, service: srv.name, kind: action.kind })
  }
}

// Execute a per-action tool (args ARE the parameters directly)
async function executePerActionTool(srv, actionName, action, args) {
  LOG(actionName, fmt({ service: srv.name, ...buildQueryArgs(args) }))

  try {
    const result = await srv.send(actionName, args)

    const structured = {
      action: actionName,
      kind: action.kind,
      result
    }

    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    LOG.error('Action execution failed', { action: actionName, error: err.message })

    if (err.code === 401 || err.code === 403) {
      return errorResponse(`Authorization error (${err.code}): Not authorized to call ${actionName}. ${err.message}`)
    }

    return errorResponse(`Error calling ${actionName}: ${err.message}`)
  }
}

async function executeGenericReadTool(srv, entities, args) {
  const { entity: entityName } = args
  LOG('query', fmt({ service: srv.name, ...buildQueryArgs(args) }))

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

  return executeReadTool(srv, entityName, entity, args, { skipLog: true })
}

// Transform MCP to CQN and execute the read operation
async function executeReadTool(srv, entityName, entity, args, options = {}) {
  if (!options.skipLog) {
    LOG(`query_${entityName}`, fmt({ service: srv.name, ...buildQueryArgs(args) }))
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

    if (args.orderBy && Array.isArray(args.orderBy) && args.orderBy.length > 0) {
      query.orderBy(...args.orderBy)
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
    LOG.error('Tool execution failed', { tool: `query_${entityName}`, error: err.message })

    // Handle authorization errors
    if (err.code === 401 || err.code === 403) {
      return errorResponse(`Authorization error (${err.code}): You are not authorized to read ${entityName}. ${err.message}`)
    }

    return errorResponse(`Error reading ${entityName}: ${err.message}`)
  }
}

async function executeDescribe(srv, entities, actions, args) {
  // Determine what to include:
  // - If only entity specified => return only those entities (no actions)
  // - If only action specified => return only those actions (no entities)
  // - If both specified => return both
  // - If neither specified => return all entities and all actions
  const hasEntity = args.entity?.length > 0
  const hasAction = args.action?.length > 0
  const includeEntities = hasEntity || !hasAction
  const includeActions = hasAction || !hasEntity

  // Detail mode: show elements/parameters when specific entity/action is requested
  const isEntityDetail = hasEntity
  const isActionDetail = hasAction

  const entityNames = hasEntity ? args.entity : Object.keys(entities)
  const actionNamesToDescribe = hasAction ? args.action : Object.keys(actions || {})

  LOG('describe', fmt({
    service: srv.name,
    ...(includeEntities && { entities: entityNames }),
    ...(includeActions && { actions: actionNamesToDescribe })
  }))

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
        // Skip draft-related, localized, and @cds.api.ignore elements
        if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue
        if (elem['@cds.api.ignore']) continue

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
          notNull: param.notNull || param['@mandatory'] || false,
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
  LOG('call_action', fmt({ service: srv.name, action: actionName, parameters: buildQueryArgs(parameters) }))

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
  createPerActionToolDefinition,
  // Utilities (shared with compile.js)
  getDescription,
  // Registration functions (runtime only)
  registerGenericReadTool,
  registerPerEntityReadTools,
  registerDescribeTool,
  registerCallActionTool,
  registerPerActionTools
}
