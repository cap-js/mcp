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
    .describe('Maximum number of results to return (default: 20)')
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
  'cds.UUID': () => z.string().uuid()
}

function createPerActionInputSchema(action) {
  const schemaFields = {}

  for (const [paramName, param] of Object.entries(action.params || {})) {
    // Get the Zod type factory, defaulting to string for unknown types
    const zodFactory = CDS_TO_ZOD_TYPE_MAP[param.type] || (() => z.string())
    let zodType = zodFactory()

    // If param has enum, restrict to allowed values
    let enumDescSuffix
    if (param.enum) {
      const values = Object.values(param.enum).map(e => e.val)
      const enumDesc = Object.entries(param.enum).map(([k, { val }]) => `${k}=${val}`).join(', ')
      if (values.every(v => typeof v === 'string')) {
        zodType = z.enum([values[0], ...values.slice(1)])
        enumDescSuffix = `Values: ${enumDesc}`
      } else {
        enumDescSuffix = `Allowed values: ${enumDesc}`
      }
    }

    // If param has @assert.range, apply min/max constraints for numeric types
    let rangeDescSuffix
    if (param['@assert.range'] && Array.isArray(param['@assert.range'])) {
      const [min, max] = param['@assert.range']
      if (typeof min === 'number' && typeof max === 'number') {
        zodType = zodType.min(min).max(max)
      } else {
        rangeDescSuffix = `Range: ${min} to ${max}`
      }
    }

    // If param has @assert.format, apply regex constraint for string types
    let formatDescSuffix
    if (param['@assert.format']) {
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
  MAX_CLAUSE_LENGTH
}
