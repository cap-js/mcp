const cds = require('@sap/cds')
const z = require('zod')

const {
  createReadInputSchema,
  extractFieldsFromWhere,
  createActionInputSchema,
  createPerActionInputSchema,
  getDescription,
  resolveI18n,
  parseAssertRange,
  resolveTypeDef
} = require('./utils/cds-to-schema')
const { resolveQueryLimits } = require('./utils/limits')
const { validateCqnTargets } = require('./utils/validate-targets')

const LOG = cds.log('mcp')
const { inspect } = require('util')
const fmt = obj => inspect(obj, { depth: 8, compact: 3, breakLength: 80, colors: true })

// Format mode: 'cqn' (default) or 'sql' — accessed via cds.env.mcp.format

const formatResult = cds.env.mcp?.toon_format === false ? JSON.stringify : formatAsToon

function formatAsToon(data) {
  try {
    var toon = formatAsToon.toon ??= require('@toon-format/toon')
  } catch {
    throw new Error(
      '@toon-format/toon is not installed.\n' +
      'Please install it with: npm add @toon-format/toon\n' +
      'Or disable TOON format with: cds.env.mcp.toon_format = false'
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

const DEFAULT_INSTRUCTIONS = "Use the 'describe' tool to explore the data model and available actions/functions. Then use 'query' to read data or 'call_action' to invoke actions or functions."

function getInstructions(def, locale, prefix) {
  locale = locale || cds.context?.locale || 'en'
  const custom = resolveI18n(def['@mcp.instructions'], locale)
  if (custom) return custom
  if (!prefix) return DEFAULT_INSTRUCTIONS
  return `Use the '${prefix}_describe' tool to explore the data model and available actions/functions. Then use '${prefix}_query' to read data or '${prefix}_call_action' to invoke actions or functions.`
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
    // Skip aggregate/func expressions and other non-ref entries
    if (!field || typeof field !== 'object' || !Array.isArray(field.ref)) return false

    const segments = field.ref
    let currentEntity = entity

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      // Extract field name from plain string or { id } object (infix filter segment)
      const fieldName = typeof segment === 'string' ? segment : segment?.id
      if (!fieldName) return true // Invalid - no field name

      const element = currentEntity.elements?.[fieldName]

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

function createGenericReadToolDefinition(entityNames, serviceName, prefix) {
  const name = prefix ? `${prefix}_query` : 'query'
  if (cds.env.mcp?.format === 'sql') {
    return {
      name,
      description: `Execute a SQL SELECT query against ${serviceName} service. Use describe to discover available entities and their fields (returned as CDS definitions).`,
      inputSchema: z.object({
        sql: z.string().describe('SQL SELECT statement to execute. Only SELECT statements are allowed. You must set a LIMIT!')
      }),
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false
      }
    }
  }

  return {
    name,
    description: `Query any entity in ${serviceName} service. Use describe to discover available entities and their fields.`,
    inputSchema: createReadInputSchema({ entityNames }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  }
}

function createDescribeToolDefinition(entityNames, actionNames, serviceName, prefix) {
  const schemaFields = {}

  if (entityNames.length > 0) {
    schemaFields.entities = z.array(z.enum(entityNames)).optional()
      .describe('Specific entities to get element details for.')
  }

  if (actionNames.length > 0) {
    schemaFields.actions = z.array(z.enum(actionNames)).optional()
      .describe('Specific actions or functions to get parameter details for.')
  }

  const name = prefix ? `${prefix}_describe` : 'describe'
  return {
    name,
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

function createCallActionToolDefinition(actionNames, serviceName, prefix) {
  const name = prefix ? `${prefix}_call_action` : 'call_action'
  return {
    name,
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
function registerGenericReadTool(server, srv, entities, prefix) {
  const entityNames = Object.keys(entities)
  if (entityNames.length === 0) {
    LOG.debug('No entities to register tools for', { service: srv.name })
    return
  }

  const def = createGenericReadToolDefinition(entityNames, srv.name, prefix)

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

// Register the describe tool for service introspection
function registerDescribeTool(server, srv, entities, actions = {}, prefix) {
  const entityNames = Object.keys(entities)
  const actionNames = Object.keys(actions)
  if (entityNames.length === 0 && actionNames.length === 0) {
    LOG.debug('No entities or actions to describe', { service: srv.name })
    return
  }

  const def = createDescribeToolDefinition(entityNames, actionNames, srv.name, prefix)

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
function registerCallActionTool(server, srv, actions, prefix) {
  const actionNames = Object.keys(actions)
  if (actionNames.length === 0) return // No actions to register

  const def = createCallActionToolDefinition(actionNames, srv.name, prefix)

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

// Resolve a type reference to a human-readable string, recursively flattening custom types
function renderTypeRef(ref, model, depth = 0) {
  if (!ref || depth > 5) return 'unknown'

  // Array case (many / array of)
  if (ref.items) {
    return `Array of ${renderTypeRef(ref.items, model, depth + 1)}`
  }

  // Inline struct case
  if (ref.elements) {
    const fields = Object.entries(ref.elements)
      .map(([name, el]) => `${name}: ${renderTypeRef(el, model, depth + 1)}`)
      .join(', ')
    return `{${fields}}`
  }

  // Type reference
  if (ref.type) {
    // CDS primitive
    if (ref.type.startsWith('cds.')) return removeCdsPrefix(ref.type)

    // Custom type — resolve from model
    const typeDef = model && resolveTypeDef(ref.type, model)
    if (typeDef) {
      // Structured custom type
      if (typeDef.elements) {
        const fields = Object.entries(typeDef.elements)
          .map(([name, el]) => `${name}: ${renderTypeRef(el, model, depth + 1)}`)
          .join(', ')
        return `{${fields}}`
      }
      // Scalar alias — recurse into the aliased type
      if (typeDef.type) {
        return renderTypeRef(typeDef, model, depth + 1)
      }
    }

    // Fallback — unknown custom type, keep its name
    return removeCdsPrefix(ref.type)
  }

  return 'unknown'
}


// Build a human-readable return type string from an action definition
function describeReturns(action, model) {
  if (!action.returns) return null
  return renderTypeRef(action.returns, model)
}

// Per-action tool definition factory (shared with compile.js)
function createPerActionToolDefinition(actionName, action, serviceName, model, prefix) {
  let description = getDescription(action) ||
    `Call ${action.kind} ${actionName} in ${serviceName}`

  // Append return type info so LLMs know without calling describe
  const returnsInfo = describeReturns(action, model)
  if (returnsInfo) {
    description += `. Returns: ${returnsInfo}`
  }

  const name = prefix ? `${prefix}_${actionName}` : actionName
  return {
    name,
    description,
    inputSchema: createPerActionInputSchema(action, model),
    annotations: {
      readOnlyHint: action.kind === 'function',
      destructiveHint: action.kind === 'action',
      idempotentHint: action.kind === 'function',
      openWorldHint: false
    }
  }
}

// Register individual tools per action/function
function registerPerActionTools(server, srv, actions, prefix) {
  const actionEntries = Object.entries(actions)
  if (actionEntries.length === 0) {
    LOG.debug('No actions to register tools for', { service: srv.name })
    return
  }

  for (const [actionName, action] of actionEntries) {
    const def = createPerActionToolDefinition(actionName, action, srv.name, srv.model, prefix)

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
  if (cds.env.mcp?.format === 'sql') {
    return _executeGenericReadSql(srv, entities, args)
  }
  return _executeGenericReadCqn(srv, entities, args)
}

// SQL format: parse SQL to CQN, validate it's a SELECT, validate targets, execute via srv.run
async function _executeGenericReadSql(srv, entities, args) {
  const { sql } = args
  LOG('query', fmt({ service: srv.name, sql }))

  try {
    const cqn = cds.parse.cql(sql)

    if (!cqn.SELECT) {
      return errorResponse('Error: Only SELECT statements are allowed.')
    }

    // Validate all referenced entities belong to this service
    const allowedEntities = new Set(Object.keys(entities))
    const validation = validateCqnTargets(cqn, allowedEntities, srv.name)
    if (!validation.valid) {
      return errorResponse(`Error: Entity '${validation.entity}' cannot be resolved for service ${srv.name}. Use describe to see available entities.`)
    }

    // Request inline $count for total row count (independent of LIMIT)
    cqn.SELECT.count = true

    const result = await srv.run(cqn)
    const resultArray = Array.isArray(result) ? result : [result]
    const count = result?.$count ?? resultArray.length
    const structured = { sql, count, data: resultArray }
    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    LOG.error('SQL execution failed', { sql, error: err.message })
    if (err.code === 401 || err.code === 403) {
      return errorResponse(`Authorization error (${err.code}): ${err.message}`)
    }
    return errorResponse(`Error executing SQL: ${err.message}`)
  }
}

// CQN format: validate fields and delegate to executeReadTool
async function _executeGenericReadCqn(srv, entities, args) {
  const { entity: entityName } = args
  LOG('query', fmt({ service: srv.name, ...buildQueryArgs(args) }))

  const entity = entities[entityName]
  const definitions = srv.model?.definitions || {}

  // Validate where fields exist in entity (extract field references from CQN where array)
  if (args.where && Array.isArray(args.where)) {
    const referencedFields = extractFieldsFromWhere(args.where)
    const invalid = validateFields(referencedFields, entity, definitions)
    if (invalid.length > 0) {
      const fieldNames = [...new Set(invalid.map(f => f.ref.join('.')))]
      return errorResponse(`Error: Invalid where field(s): ${fieldNames.join(', ')}. Use describe to see available fields for ${entityName}.`)
    }
  }

  // Validate select fields exist in entity
  const invalidSelect = validateFields(args.select, entity, definitions)
  if (invalidSelect.length > 0) {
    const fieldNames = invalidSelect.map(f => f.ref.join('.'))
    return errorResponse(`Error: Invalid select field(s): ${fieldNames.join(', ')}. Use describe to see available fields for ${entityName}.`)
  }

  return executeReadTool(srv, entityName, args, { skipLog: true })
}

// Transform MCP to CQN and execute the read operation
async function executeReadTool(srv, entityName, args, options = {}) {
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

    // Apply full-text search across all string elements
    if (args.search) {
      query.search(args.search)
    }

    // Apply groupBy clause for aggregation queries
    if (args.groupBy && Array.isArray(args.groupBy) && args.groupBy.length > 0) {
      query.groupBy(...args.groupBy)
    }

    // Apply having clause for filtering grouped results
    if (args.having && Array.isArray(args.having) && args.having.length > 0) {
      query.having(args.having)
    }

    if (args.orderBy && Array.isArray(args.orderBy) && args.orderBy.length > 0) {
      query.orderBy(...args.orderBy)
    }

    if (args.one) {
      query.SELECT.one = true
    } else if (args.distinct) {
      query.SELECT.limit = null;
    } else if (args.limit || args.offset) {
      // CQN: query.limit(rows, offset)
      // When only offset is provided, resolve the effective page size from @cds.query.limit (entity > service > global)
      let rows = args.limit
      if (!rows) {
        const entity = srv.entities?.[entityName]
        const limits = resolveQueryLimits(entity || {}, srv.definition)
        rows = limits.default ?? limits.max
      }
      query.limit(rows, args.offset ?? 0)
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
  if (cds.env.mcp?.format === 'sql') {
    return _executeDescribeCdl(srv, entities, actions, args)
  }
  return _executeDescribeCsn(srv, entities, actions, args)
}

// CSN format (default): return JSON with element metadata
async function _executeDescribeCsn(srv, entities, actions, args) {
  // Determine what to include:
  // - If only entity specified => return only those entities (no actions)
  // - If only action specified => return only those actions (no entities)
  // - If both specified => return both
  // - If neither specified => return all entities and all actions
  const hasEntity = args.entities?.length > 0
  const hasAction = args.actions?.length > 0
  const includeEntities = hasEntity || !hasAction
  const includeActions = hasAction || !hasEntity

  // Detail mode: show elements/parameters when specific entity/action is requested
  const isEntityDetail = hasEntity
  const isActionDetail = hasAction

  const entityNames = hasEntity ? args.entities : Object.keys(entities)
  const actionNamesToDescribe = hasAction ? args.actions : Object.keys(actions || {})

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

      const keys = []
      const elements = {}

      for (const [elemName, elem] of Object.entries(entity.elements || {})) {
        // Skip draft-related, localized, and @cds.api.ignore elements
        if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue
        if (elem['@cds.api.ignore']) continue

        if (elem.key) keys.push(elemName)

        const elemDescription = getDescription(elem) || `Element ${elemName}`

        if (elem.target) {
          // Association element
          elements[elemName] = {
            type: `${removeCdsPrefix(elem.type)} (${elem.is2one ? '1-1' : '1-*'})`,
            target: elem.target,
            description: elemDescription
          }
        } else {
          // Regular element
          const elemOutput = {
            type: removeCdsPrefix(elem.type),
            description: elemDescription
          }
          if (elem.notNull || elem['@mandatory']) {
            elemOutput.notNull = true
          }
          if (elem.enum) {
            elemOutput.enum = Object.fromEntries(
              Object.entries(elem.enum).map(([key, { val }]) => [key, val])
            )
          }
          if (elem['@assert.range']) {
            const range = parseAssertRange(elem['@assert.range'])
            elemOutput.range = range?.text || elem['@assert.range']
          }
          if (elem['@assert.format']) {
            elemOutput.format = elem['@assert.format']
          }
          elements[elemName] = elemOutput
        }
      }

      description.entities[entityName] = {
        description: entityDescription,
        keys,
        queryLimits,
        elements
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
      const returns = describeReturns(action, srv.model)

      description.actions[actionName] = {
        kind: action.kind,
        description: actionDescription,
        parameters: {},
        returns
      }

      // Add parameter descriptions
      for (const [paramName, param] of Object.entries(action.params || {})) {
        const paramDescription = getDescription(param) || null
        const paramOutput = {
          type: renderTypeRef(param, srv.model),
          notNull: param.notNull || param['@mandatory'] || false,
          description: paramDescription
        }
        if (param.enum) {
          paramOutput.enum = Object.fromEntries(
            Object.entries(param.enum).map(([key, { val }]) => [key, val])
          )
        }
        if (param['@assert.range']) {
          const range = parseAssertRange(param['@assert.range'])
          paramOutput.range = range?.text || param['@assert.range']
        }
        if (param['@assert.format']) {
          paramOutput.format = param['@assert.format']
        }
        description.actions[actionName].parameters[paramName] = paramOutput
      }
    }
  }

  return {
    content: [{ type: 'text', text: formatResult(description) }],
    structuredContent: description
  }
}

// CDL format (sql mode): return CDS definitions via cds.compile.to.cdl
async function _executeDescribeCdl(srv, entities, actions, args) {
  const hasEntity = args.entities?.length > 0
  const hasAction = args.actions?.length > 0
  const includeEntities = hasEntity || !hasAction
  const includeActions = hasAction || !hasEntity

  const entityNames = hasEntity ? args.entities : Object.keys(entities)
  const actionNamesToDescribe = hasAction ? args.actions : Object.keys(actions || {})

  LOG('describe (cdl)', fmt({
    service: srv.name,
    ...(includeEntities && { entities: entityNames }),
    ...(includeActions && { actions: actionNamesToDescribe })
  }))

  const definitions = srv.model?.definitions || {}
  const parts = []

  if (includeEntities) {
    for (const entityName of entityNames) {
      const entity = entities[entityName]
      if (!entity) continue

      const cleaned = _stripAnnotations(entity)
      const miniCsn = { definitions: { [entityName]: cleaned } }
      const cdl = cds.compile.to.cdl(miniCsn)
      parts.push(typeof cdl === 'string' ? cdl : String(cdl))
    }
  }

  if (includeActions) {
    for (const actionName of actionNamesToDescribe) {
      const action = actions?.[actionName]
      if (!action) continue

      const actionDef = definitions[`${srv.name}.${actionName}`] || action
      const cleaned = _stripAnnotations(actionDef)
      const miniCsn = { definitions: { [actionName]: cleaned } }
      const cdl = cds.compile.to.cdl(miniCsn)
      parts.push(typeof cdl === 'string' ? cdl : String(cdl))
    }
  }

  const cdl = parts.join('\n\n')
  const structured = { service: srv.name, format: 'cds', definition: cdl }

  return {
    content: [{ type: 'text', text: cdl }],
    structuredContent: structured
  }
}

// Strip UI/internal annotations and includes for cleaner CDL output
function _stripAnnotations(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const cleaned = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('@UI.') || key.startsWith('@UI_')) continue
    if (key.startsWith('@cds.api.')) continue
    if (key === 'includes') continue
    if (key === 'elements' && typeof value === 'object' && value !== null) {
      cleaned.elements = {}
      for (const [elemName, elemDef] of Object.entries(value)) {
        if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue
        cleaned.elements[elemName] = _stripAnnotations(elemDef)
      }
    } else {
      cleaned[key] = value
    }
  }
  return cleaned
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

    // Deep-clone result to plain objects — CAP may return typed instances
    // that TOON cannot enumerate (e.g. results from actions returning `many`)
    const plainResult = result != null ? JSON.parse(JSON.stringify(result)) : result

    const structured = {
      action: actionName,
      kind: action.kind, // 'action' or 'function'
      result: plainResult
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
  createDescribeToolDefinition,
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  // Utilities (shared with compile.js)
  getInstructions,
  // Registration functions (runtime only)
  registerGenericReadTool,
  registerDescribeTool,
  registerCallActionTool,
  registerPerActionTools,
  // Execution functions (runtime only - shared with others)
  executeGenericReadTool,
  executeDescribe,
  executeCallActionTool,
  executePerActionTool,
}
