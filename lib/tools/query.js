const cds = require('@sap/cds')
const z = require('zod')
const toon = require('@toon-format/toon')

const { createReadInputSchema, extractFieldsFromWhere } = require('../utils/cds-to-schema')
const { resolveQueryLimits } = require('../utils/limits')
const { validateCqnTargets } = require('../utils/validate-targets')

const { LOG, fmt, errorResponse, formatError, buildQueryArgs } = require('../utils/tools-shared')

// Default CQL length cap. Override via cds.env.mcp.cql.maxLength.
const DEFAULT_CQL_MAX_LENGTH = 10_000

// Validates field references including path expressions
function validateFields(fields, entity, definitions) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) return []

  return fields.filter((field) => {
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

function createGenericReadToolDefinition(entityNames, serviceName, prefix = '') {
  const name = prefix + 'query'
  if (cds.env.mcp?.format === 'cqn') {
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

  return {
    name,
    description:
      `Query any entity in ${serviceName} service.` +
      "Ensure to first use the `describe` tool to discover an entity's available fields.",
    inputSchema: z.object({
      cql: z
        .string()
        .describe(
          'CAP CQL statement to execute queries; only SELECT statements are allowed. ' +
            'CQL is a superset of SQL, that supports ' +
            '- path expressions to follow associations instead of JOINs, e.g. SELECT author.name from Books, ' +
            '- postfix projection syntax, with nested expands, e.g. SELECT from Authors { ID, name, books { ID, title }}, ' +
            '- standard CAP/OData functions and aggregates (count, sum, avg, min, max, lower, upper, substring, year, month, day, etc.). ' +
            'Database functions (CURRENT_USER, SESSION_USER, SYSUUID, CURRENT_SCHEMA) are not supported. ' +
            'LIMIT is auto-injected to the service max.'
        )
    }),
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false
    }
  }
}

// Register a single generic query tool for all entities (default behavior)
function registerGenericReadTool(server, srv, entities, prefix, { log = LOG } = {}) {
  const entityNames = Object.keys(entities)
  if (entityNames.length === 0) {
    log.debug('No entities to register tools for', { service: srv.name })
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
    (args) => executeGenericReadTool(srv, entities, args, { log })
  )

  log.debug('Registered generic tool', { tool: def.name, service: srv.name })
}

async function executeGenericReadTool(srv, entities, args, { log = LOG } = {}) {
  if (cds.env.mcp?.format === 'cqn') {
    return _executeGenericReadCqn(srv, entities, args, { log })
  }
  return _executeGenericReadCql(srv, entities, args, { log })
}

// Run a pre-built CQN: validate + LIMIT + srv.run.
// Returns { ok:true, data, count, one } or { ok:false, code, reason, entity, err }.
async function _executeCqnQuery({ srv, entities, cqn, entityDef }) {
  const definitions = srv.model?.definitions || {}
  const allowedEntities = new Set(Object.keys(entities))

  const validation = validateCqnTargets(cqn, {
    allowedEntities,
    serviceName: srv.name,
    definitions,
    rootEntity: entityDef
  })
  if (!validation.valid) {
    return { ok: false, code: 'validation', reason: validation.reason, entity: validation.entity }
  }

  if (!cqn.SELECT.one && !cqn.SELECT.distinct) {
    _enforceSelectLimit(cqn, entityDef, srv)
  }

  try {
    const result = await srv.run(cqn)
    const one = !!cqn.SELECT.one
    if (one) return { ok: true, data: result || null, count: 1, one }
    const resultArray = Array.isArray(result) ? result : [result]
    return { ok: true, data: resultArray, count: result?.$count ?? resultArray.length, one }
  } catch (err) {
    return { ok: false, code: 'runtime', err }
  }
}

// Map _executeCqnQuery failure to MCP error response.
// ctx: { serviceName, targetLabel?, execPrefix }
function _queryErrorResponse(res, ctx, log) {
  if (res.code === 'validation') {
    if (res.reason === 'function-not-allowed') {
      return errorResponse(
        `Error: ${res.entity} is not allowed. Only CAP-standard functions and aggregates are permitted.`
      )
    }
    if (res.reason === 'pseudo-column-not-allowed') {
      return errorResponse(
        `Error: Reference '${res.entity}' is not allowed (database pseudo-column).`
      )
    }
    if (res.reason === 'expand-not-allowed') {
      return errorResponse(
        `Error: Cannot expand into inaccessible entity via '${res.entity}'. The target entity is restricted.`
      )
    }
    return errorResponse(
      `Error: Entity '${res.entity}' cannot be resolved for service ${ctx.serviceName}. Use describe to see available entities.`
    )
  }

  log?.error('Query execution failed', { target: ctx.targetLabel, error: formatError(res.err) })
  if (res.err.code === 401 || res.err.code === 403) {
    const scope = ctx.targetLabel ? `You are not authorized to read ${ctx.targetLabel}. ` : ''
    return errorResponse(`Authorization error (${res.err.code}): ${scope}${formatError(res.err)}`)
  }
  return errorResponse(`${ctx.execPrefix}: ${formatError(res.err)}`)
}

// Inject/clamp LIMIT (entity → service → env)
function _enforceSelectLimit(cqn, targetEntity, srv) {
  const { default: defaultLimit, max } = resolveQueryLimits(targetEntity || {}, srv.definition)
  const effectiveMax = max ?? Number.MAX_SAFE_INTEGER
  const effectiveDefault = defaultLimit ?? effectiveMax

  if (cqn.SELECT.limit === null) {
    cqn.SELECT.limit = { rows: { val: effectiveDefault } }
    return
  }

  const { rows } = cqn.SELECT.limit || (cqn.SELECT.limit = {})
  const existingVal = rows?.val ?? rows
  cqn.SELECT.limit.rows = {
    val: existingVal ? Math.min(existingVal, effectiveMax) : effectiveDefault
  }
}

// CQL mode: parse → shared core → CQL response
async function _executeGenericReadCql(srv, entities, args, { log = LOG } = {}) {
  const rawCql = args.cql ?? args.sql ?? ''

  const maxLength = cds.env.mcp?.cql?.maxLength ?? DEFAULT_CQL_MAX_LENGTH
  if (rawCql.length > maxLength) {
    return errorResponse(
      `Error: CQL exceeds max length of ${maxLength} characters (received ${rawCql.length}).`
    )
  }

  // CQL parser treats newlines as terminators
  const cql = rawCql.replace(/\n/g, ' ')
  log('query', fmt({ service: srv.name, cql }))

  let cqn
  try {
    cqn = cds.parse.cql(cql)
  } catch (err) {
    log.error('CQL parse failed', { cql, error: err.message })
    return errorResponse(`Error executing CQL: ${err.message}`)
  }

  if (!cqn.SELECT) return errorResponse('Error: Only SELECT statements are allowed.')

  // Resolve target for LIMIT + expand context
  // ref[0] is a string for plain queries or an object { id, where } for queries with infix filters
  const fromRef = cqn.SELECT.from?.ref?.[0]
  const targetName = typeof fromRef === 'string' ? fromRef : fromRef?.id
  const localName =
    targetName && srv.name && targetName.startsWith(srv.name + '.')
      ? targetName.slice(srv.name.length + 1)
      : targetName
  const entityDef = localName ? srv.entities?.[localName] : null

  // Report $count independent of LIMIT
  cqn.SELECT.count = true

  const res = await _executeCqnQuery({ srv, entities, cqn, entityDef })

  if (!res.ok) {
    return _queryErrorResponse(
      res,
      { serviceName: srv.name, targetLabel: null, execPrefix: 'Error executing CQL' },
      log
    )
  }

  const structured = { count: res.count, data: res.data }
  return {
    content: [{ type: 'text', text: toon.encode(structured) }],
    structuredContent: structured
  }
}

// CQN mode: build CQN → shared core → CQN response
async function _executeGenericReadCqn(srv, entities, args, { log = LOG } = {}) {
  const { entity: entityName } = args
  log('query', fmt({ service: srv.name, ...buildQueryArgs(args) }))

  const entity = entities[entityName]
  const definitions = srv.model?.definitions || {}

  // Fast-fail field checks for clearer errors
  if (args.where && Array.isArray(args.where)) {
    const referencedFields = extractFieldsFromWhere(args.where)
    const invalid = validateFields(referencedFields, entity, definitions)
    if (invalid.length > 0) {
      const fieldNames = [...new Set(invalid.map((f) => f.ref.join('.')))]
      return errorResponse(
        `Error: Invalid where field(s): ${fieldNames.join(', ')}. Use describe to see available fields for ${entityName}.`
      )
    }
  }

  const invalidSelect = validateFields(args.select, entity, definitions)
  if (invalidSelect.length > 0) {
    const fieldNames = invalidSelect.map((f) => f.ref.join('.'))
    return errorResponse(
      `Error: Invalid select field(s): ${fieldNames.join(', ')}. Use describe to see available fields for ${entityName}.`
    )
  }

  // Build CQN
  let query = SELECT.from(srv.entities[entityName] ?? entityName)

  if (args.distinct) query.SELECT.distinct = true

  if (args.select && Array.isArray(args.select) && args.select.length > 0) {
    query.columns(...args.select)
  }

  if (args.where && Array.isArray(args.where) && args.where.length > 0) {
    query.where(args.where)
  }

  if (args.search) query.search(args.search)

  if (args.groupBy && Array.isArray(args.groupBy) && args.groupBy.length > 0) {
    query.groupBy(...args.groupBy)
  }

  if (args.having && Array.isArray(args.having) && args.having.length > 0) {
    query.having(args.having)
  }

  if (args.orderBy && Array.isArray(args.orderBy) && args.orderBy.length > 0) {
    query.orderBy(...args.orderBy)
  }

  if (args.one) {
    query.SELECT.one = true
  } else if (args.distinct) {
    query.SELECT.limit = null
  } else if (args.limit || args.offset) {
    // Raw values; _enforceSelectLimit clamps/defaults
    query.limit(args.limit ?? 0, args.offset ?? 0)
  }

  const res = await _executeCqnQuery({ srv, entities, cqn: query, entityDef: entity })
  if (!res.ok) {
    return _queryErrorResponse(
      res,
      { serviceName: srv.name, targetLabel: entityName, execPrefix: `Error reading ${entityName}` },
      log
    )
  }
  const structured = { entity: entityName, count: res.count, data: res.data }
  return {
    content: [{ type: 'text', text: toon.encode(structured) }],
    structuredContent: structured
  }
}

module.exports = {
  createGenericReadToolDefinition,
  registerGenericReadTool,
  executeGenericReadTool
}
