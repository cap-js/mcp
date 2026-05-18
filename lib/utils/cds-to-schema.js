const z = require('zod')
const cds = require('@sap/cds')

// Maximum length for where and select clauses (serialized JSON)
const MAX_CLAUSE_LENGTH = 1000

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

// CQN Expression schema definitions based on CXL/CXN specification

// Supports: 'field', { id: 'assoc', where: [...] } for infix filters like books[stock > 100]
const refSegmentSchema = z.lazy(() => z.union([
  z.string(),
  z.object({
    id: z.string(),
    where: z.array(xoSchema).optional()
  })
]))

// Reference expression: { ref: ['fieldName'] } or { ref: ['assoc', 'field'] }
const refSchema = z.object({ ref: z.array(refSegmentSchema).min(1) })

// Value expression: { val: scalar }
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const valSchema = z.object({ val: scalarSchema })

// CXL operators: arithmetic, comparison
const operatorSchema = z.enum(['=', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/'])

// CXL keywords: logical, pattern matching, null checks, existence
const keywordSchema = z.enum([
  'and', 'or', 'not',
  'in', 'not in',
  'like', 'not like',
  'between',
  'is', 'null', 'not null',
  'exists', 'not exists'
])

// Portable function names from CAP-level database support (case-sensitive)
const PORTABLE_FUNCTIONS = [
  // String functions
  'concat', 'length', 'trim', 'tolower', 'toupper',
  'contains', 'startswith', 'endswith', 'substring',
  // Numeric functions
  'ceiling', 'floor', 'round',
  // Date/Time functions
  'year', 'month', 'day',
  // Aggregate functions
  'count', 'sum', 'avg', 'min', 'max'
]

// Function call expression: { func: 'name', args: [expr, ...], as?: 'alias' }
// Only portable functions are allowed to ensure cross-database compatibility
const funcArgSchema = z.lazy(() => z.union([z.literal('*'), refSchema, valSchema, funcSchema, xprSchema]))
const funcSchema = z.object({
  func: z.enum(PORTABLE_FUNCTIONS).describe('Portable function name (case-sensitive)'),
  args: z.array(funcArgSchema).describe('Function arguments: expressions, "*" for count(*), or field references'),
  as: z.string().optional().describe('Result column alias')
})

// Forward declaration for recursive expression token type (xo)
const xoSchema = z.lazy(() => z.union([
  refSchema,
  valSchema,
  listSchema,
  xprSchema,
  funcSchema,
  operatorSchema,
  keywordSchema
]))

// List expression: { list: [expr, expr, ...] }
const listSchema = z.object({ list: z.array(z.lazy(() => z.union([refSchema, valSchema, listSchema]))) })

// Compound expression: { xpr: xo[] }
const xprSchema = z.object({ xpr: z.array(xoSchema) })

// Full where clause schema: xo[]
const whereClauseSchema = z.array(xoSchema)

// Expand item: wildcard or ref objects (CDS runtime requires refs in expand, not strings)
const expandItemSchema = z.lazy(() => z.union([
  z.literal('*'),
  z.object({
    ref: z.array(refSegmentSchema).min(1),
    as: z.string().optional(),
    expand: z.array(expandItemSchema).optional()
  })
]))

// Column expression: ref path (with optional expand/alias), function call, or xpr expression
const columnSchema = z.union([
  z.object({
    ref: z.array(refSegmentSchema).min(1),
    as: z.string().optional(),
    expand: z.array(expandItemSchema).optional()
  }),
  funcSchema,
  z.object({
    xpr: z.array(xoSchema),
    as: z.string().optional()
  })
])

// Order expression: { ref: ['field'], sort?: 'asc'|'desc', nulls?: 'first'|'last' }
const orderSchema = z.object({
  ref: z.array(z.string()).min(1),
  sort: z.enum(['asc', 'desc']).optional(),
  nulls: z.enum(['first', 'last']).optional()
})

// Where schema description for MCP tools
const WHERE_DESCRIPTION = `CQN where clause as array of expression tokens. Format: [expr, operator, expr, keyword?, expr, operator, expr, ...]

Expressions:
- Field reference: { "ref": ["fieldName"] } or { "ref": ["assoc", "field"] }
- Infix filter: { "ref": [{ "id": "books", "where": [{ "ref": ["stock"] }, ">", { "val": 100 }] }] }
- Literal value: { "val": value }
- List of values: { "list": [{ "val": v1 }, { "val": v2 }] }
- Nested expression: { "xpr": [...tokens...] }
- Function call: { "func": "funcName", "args": [expr, ...] }

Examples:
- [{ "ref": ["title"] }, "=", { "val": "Jane Eyre" }]
- [{ "ref": ["price"] }, ">", { "val": 10 }, "and", { "ref": ["stock"] }, ">", { "val": 0 }]
- [{ "ref": ["name"] }, "like", { "val": "A%" }]
- [{ "ref": ["status"] }, "is", "null"]
- [{ "ref": ["price"] }, "between", { "val": 10 }, "and", { "val": 50 }]
- ["exists", { "ref": [{ "id": "books", "where": [{ "ref": ["stock"] }, ">", { "val": 100 }] }] }]
- [{ "func": "year", "args": [{ "ref": ["publishedAt"] }] }, "=", { "val": 2024 }]`

// Select schema description for MCP tools
const SELECT_DESCRIPTION = `List of column expressions to return. Defaults to all fields if not specified.

Column types:
- Ref path: { "ref": ["field"], "as": "alias" } for fields with optional alias
- Path expression: { "ref": ["assoc", "field"], "as": "alias" } for association navigation
- Expand: { "ref": ["assoc"], "expand": [{ "ref": ["field1"] }, { "ref": ["field2"] }] } for to-many as nested arrays. Use ["*"] to expand all.
- Function call: { "func": "funcName", "args": [expr, ...], "as": "alias" }
- Expression: { "xpr": [expr, operator, expr, ...], "as": "alias" } for calculated columns

Examples:
- [{ "ref": ["title"] }, { "ref": ["price"] }] - select fields
- [{ "ref": ["author", "name"], "as": "authorName" }] - association path with alias
- [{ "ref": ["books"], "expand": [{ "ref": ["title"] }, { "ref": ["price"] }] }] - expand to-many
- [{ "func": "count", "args": ["*"], "as": "total" }] - count all rows
- [{ "func": "toupper", "args": [{ "ref": ["title"] }], "as": "upperTitle" }] - string function
- [{ "xpr": [{ "ref": ["price"] }, "*", { "ref": ["stock"] }], "as": "totalValue" }] - calculated column`

// OrderBy schema description for MCP tools
const ORDERBY_DESCRIPTION = `Array of order expressions to sort results.

Each expression:
- ref: Field reference as array, e.g. ["fieldName"] or ["assoc", "field"]
- sort: "asc" or "desc" (optional)
- nulls: "first" or "last" (optional)

Examples:
- [{ "ref": ["price"], "sort": "desc" }] - sort by price descending
- [{ "ref": ["name"] }, { "ref": ["date"], "sort": "desc" }] - multi-field sort`

// Having schema description for MCP tools
const HAVING_DESCRIPTION = `CQN having clause for filtering grouped results. Same format as where clause but applied after GROUP BY.

Examples:
- [{ "func": "count", "args": ["*"] }, ">", { "val": 5 }] - groups with more than 5 items
- [{ "func": "sum", "args": [{ "ref": ["stock"] }] }, ">=", { "val": 100 }] - groups with total stock >= 100`

function createReadInputSchema(options = {}) {
  const { entityNames } = options

  const schema = {}

  // Add entity selector for generic mode
  if (entityNames?.length > 0) {
    schema.entity = z.enum([...entityNames])
      .describe('The entity to query')
  }

  schema.where = whereClauseSchema.optional()
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `where clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
    .describe(WHERE_DESCRIPTION)
  schema.select = z.array(columnSchema).optional()
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `select clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
    .describe(SELECT_DESCRIPTION)
  schema.groupBy = z.array(z.string()).optional()
    .describe('Field(s) to group results by for aggregation queries. Use "field" for simple fields or "assoc.field" for association paths. Use with aggregate functions in select.')
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `group by clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
  schema.having = whereClauseSchema.optional()
    .describe(HAVING_DESCRIPTION)
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `having clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
  schema.limit = z.number().int().min(1).optional()
    .describe('Maximum number of results to return')
  schema.orderBy = z.array(orderSchema).optional()
    .describe(ORDERBY_DESCRIPTION)
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `order by clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
  schema.search = z.string().optional()
    .describe('Full-text search term. Searches across all string elements of the entity. Use this for fuzzy or keyword-based lookups instead of constructing complex where clauses.')
  schema.distinct = z.boolean().optional()
    .describe('Return only unique/distinct rows')
  schema.one = z.boolean().optional()
    .describe('Return a single record object instead of an array. Implies limit of 1.')

  return z.object(schema)
}

// Extracts all field references from a CQN where clause array.
// Handles simple refs, infix filter refs, nested xpr, list, and func args.
function extractFieldsFromWhere(whereArray) {
  if (!Array.isArray(whereArray)) return []

  const fields = []
  for (const token of whereArray) {
    if (token && typeof token === 'object') {
      // Reference expression: { ref: ['field'] } or { ref: [{ id: 'assoc', where: [...] }] }
      if (token.ref && Array.isArray(token.ref) && token.ref.length > 0) {
        const firstSeg = token.ref[0]
        // Extract the field name from plain string or { id } object
        const fieldName = typeof firstSeg === 'string' ? firstSeg : firstSeg?.id
        if (fieldName) fields.push({ ref: [fieldName] })
        // We do NOT recurse into infix filter where clauses as those fields reference the association target entity, not the root entity
      }
      // Compound expression: { xpr: [...] }
      if (token.xpr && Array.isArray(token.xpr)) {
        fields.push(...extractFieldsFromWhere(token.xpr))
      }
      // List expression: { list: [...] }
      if (token.list && Array.isArray(token.list)) {
        fields.push(...extractFieldsFromWhere(token.list))
      }
      // Function call expression: { func: 'name', args: [...] }
      if (token.func && Array.isArray(token.args)) {
        fields.push(...extractFieldsFromWhere(token.args))
      }
    }
  }
  return fields
}

function createActionInputSchema(actionNames) {
  const parametersSchema = z.object({}).passthrough().optional()
    .describe('Parameters for the action. Use describe to see available parameters.')

  if (!actionNames || actionNames.length === 0) {
    return z.object({
      action: z.string().describe('The action or function to call'),
      parameters: parametersSchema
    })
  }

  return z.object({
    action: z.enum(actionNames)
      .describe('The action or function to call'),
    parameters: parametersSchema
  })
}

// Numeric CDS types for @assert.range handling
const NUMERIC_CDS_TYPES = new Set([
  'cds.Integer', 'cds.Int16', 'cds.Int32', 'cds.Int64','cds.UInt8',
  'cds.Decimal', 'cds.Double'
])

function parseBound(bound) {
  if (typeof bound === 'number' || typeof bound === 'string') return { value: bound, exclusive: false }
  if (typeof bound === 'object' && bound?.['='] === '_') return { value: null, exclusive: false }
  if (typeof bound === 'object' && 'val' in bound) return { value: bound.val, exclusive: true }
  return { value: null, exclusive: false }
}

/**
 * Parse @assert.range CSN annotation into structured bounds and human-readable text.
 * Returns null for non-array values (e.g. true for enum ranges).
 *
 * CSN bound representations:
 * - Plain number/string: closed bound, e.g. 0, 3, '2018-10-31'
 * - Object with "val" and "=": exclusive bound, e.g. { "=": "0", val: 0 }
 * - Object with "=" === "_": infinity, e.g. { "=": "_" }
 *
 * @returns {{ min: number|string|null, max: number|string|null, minExclusive: boolean, maxExclusive: boolean, text: string }|null}
 */
function parseAssertRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null

  const min = parseBound(range[0])
  const max = parseBound(range[1])

  const left = min.value === null ? '(-∞' : (min.exclusive ? '(' : '[') + min.value
  const right = max.value === null ? '+∞)' : max.value + (max.exclusive ? ')' : ']')

  return { min: min.value, minExclusive: min.exclusive, max: max.value, maxExclusive: max.exclusive, text: `${left}, ${right}` }
}

// Maps CDS types to Zod schema builders
const CDS_TO_ZOD_TYPE_MAP = {
  'cds.Integer': () => z.number().int(),
  'cds.Int16': () => z.number().int(),
  'cds.Int32': () => z.number().int(),
  'cds.Int64': () => z.number().int(),
  'cds.String': () => z.string(),
  'cds.Boolean': () => z.boolean(),
  'cds.Decimal': () => z.number(),
  'cds.Double': () => z.number(),
  'cds.Date': () => z.string(),
  'cds.DateTime': () => z.string(),
  'cds.Time': () => z.string(),
  'cds.Timestamp': () => z.string(),
  'cds.UUID': () => z.string()
}

// Resolve a type definition from the model, returning the definition or null
function resolveTypeDef(typeName, model) {
  if (!typeName || !model) return null
  return model.definitions?.[typeName] || null
}

// Build a Zod schema for a single element/param, handling scalars, structs, arrays, and custom types
function buildZodType(param, model, depth) {
  const maxDepth = cds.env.mcp?.type_depth_limit ?? 20
  if (depth > maxDepth) return z.any()

  // Case 1: Array type (many keyword) — param has .items
  if (param.items) {
    const itemSchema = buildZodTypeForItems(param.items, model, depth + 1)
    return z.array(itemSchema)
  }

  // Case 2: Inline structured type — param has .elements but no .items
  if (param.elements) {
    return buildObjectSchema(param.elements, model, depth + 1)
  }

  // Case 3: Has a type reference
  if (param.type) {
    // Check if it's a known CDS primitive
    if (CDS_TO_ZOD_TYPE_MAP[param.type]) {
      return CDS_TO_ZOD_TYPE_MAP[param.type]()
    }

    // Resolve custom type from model
    const typeDef = resolveTypeDef(param.type, model)
    if (typeDef) {
      // Structured custom type (has elements)
      if (typeDef.elements) {
        return buildObjectSchema(typeDef.elements, model, depth + 1)
      }
      // Scalar type alias (has type pointing to another type)
      if (typeDef.type && CDS_TO_ZOD_TYPE_MAP[typeDef.type]) {
        return CDS_TO_ZOD_TYPE_MAP[typeDef.type]()
      }
      // Recursive resolution for chained type aliases
      if (typeDef.type) {
        return buildZodType(typeDef, model, depth + 1)
      }
    }
  }

  // Fallback: unknown type → string
  return z.string()
}

// Build Zod schema for array items (the inner type of many)
function buildZodTypeForItems(items, model, depth) {
  const maxDepth = cds.env.mcp?.type_depth_limit ?? 20
  if (depth > maxDepth) return z.any()

  // Inline struct elements on items
  if (items.elements) {
    return buildObjectSchema(items.elements, model, depth)
  }

  // Type reference on items
  if (items.type) {
    if (CDS_TO_ZOD_TYPE_MAP[items.type]) {
      return CDS_TO_ZOD_TYPE_MAP[items.type]()
    }
    const typeDef = resolveTypeDef(items.type, model)
    if (typeDef) {
      if (typeDef.elements) {
        return buildObjectSchema(typeDef.elements, model, depth)
      }
      if (typeDef.type) {
        return buildZodType(typeDef, model, depth)
      }
    }
  }

  // Fallback
  return z.object({}).passthrough()
}

// Build a z.object schema from a map of elements
function buildObjectSchema(elements, model, depth) {
  const fields = {}
  for (const [name, elem] of Object.entries(elements)) {
    fields[name] = buildZodType(elem, model, depth).optional()
  }
  return z.object(fields)
}

function createPerActionInputSchema(action, model) {
  const schemaFields = {}

  for (const [paramName, param] of Object.entries(action.params || {})) {
    // Build the base Zod type (handles scalars, arrays, structs, custom types)
    let zodType = buildZodType(param, model, 0)

    // Only apply scalar constraints (enum, range, format) to non-array, non-object types
    const isScalar = !param.items && !param.elements &&
      (!param.type || CDS_TO_ZOD_TYPE_MAP[param.type] || (() => {
        const typeDef = resolveTypeDef(param.type, model)
        return typeDef && !typeDef.elements
      })())

    // If param has enum, restrict to allowed values
    let enumDescSuffix
    if (param.enum && isScalar) {
      const values = Object.values(param.enum).map(e => e.val)
      const enumDesc = Object.entries(param.enum).map(([k, { val }]) => `${k}=${val}`).join(', ')
      if (values.every(v => typeof v === 'string')) {
        zodType = z.enum([values[0], ...values.slice(1)])
        enumDescSuffix = `Values: ${enumDesc}`
      } else {
        enumDescSuffix = `Allowed values: ${enumDesc}`
      }
    }

    // If param has @assert.range, apply constraints (skip enum case where range is true)
    let rangeDescSuffix
    if (isScalar) {
      const range = parseAssertRange(param['@assert.range'])
      if (range) {
        if (NUMERIC_CDS_TYPES.has(param.type)) {
          if (range.min !== null && typeof range.min === 'number') {
            zodType = range.minExclusive ? zodType.gt(range.min) : zodType.min(range.min)
          }
          if (range.max !== null && typeof range.max === 'number') {
            zodType = range.maxExclusive ? zodType.lt(range.max) : zodType.max(range.max)
          }
        } else {
          rangeDescSuffix = `Range: ${range.text}`
        }
      }
    }

    // If param has @assert.format, apply regex constraint for string types
    let formatDescSuffix
    if (isScalar && param['@assert.format']) {
      const pattern = param['@assert.format']
      const raw = pattern.startsWith('/') && pattern.endsWith('/') ? pattern.slice(1, -1) : pattern
      if (param.type === 'cds.String' && !param.enum) {
        try {
          zodType = zodType.regex(new RegExp(raw))
        } catch {
          formatDescSuffix = `Format: ${pattern}`
        }
      } else {
        formatDescSuffix = `Format: ${pattern}`
      }
    }

    // Add description from getDescription (append enum/range/format info)
    const parts = [getDescription(param), enumDescSuffix, rangeDescSuffix, formatDescSuffix].filter(Boolean)
    if (parts.length > 0) {
      zodType = zodType.describe(parts.join('. '))
    }

    // Make optional if not marked as notNull or @mandatory
    if (!param.notNull && !param['@mandatory']) {
      zodType = zodType.optional()
    }

    schemaFields[paramName] = zodType
  }

  return z.object(schemaFields)
}

module.exports = {
  createReadInputSchema,
  extractFieldsFromWhere,
  createActionInputSchema,
  createPerActionInputSchema,
  getDescription,
  resolveI18n,
  parseAssertRange,
  MAX_CLAUSE_LENGTH
}
