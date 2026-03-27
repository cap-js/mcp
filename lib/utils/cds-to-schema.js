const z = require('zod')

// Maximum length for where and select clauses (serialized JSON)
const MAX_CLAUSE_LENGTH = 1000

// CQN Where clause schema definitions
// Reference expression: { ref: ['fieldName'] } or { ref: ['assoc', 'field'] }
const refSchema = z.object({ ref: z.array(z.string()).min(1) })

// Value expression: { val: scalar }
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const valSchema = z.object({ val: scalarSchema })

const operatorSchema = z.enum(['=', '==', '!=', '<', '<=', '>', '>='])
const keywordSchema = z.enum(['in', 'like', 'and', 'or', 'not', 'between'])

// Forward declaration for recursive types
const xoSchema = z.lazy(() => z.union([
  refSchema,
  valSchema,
  listSchema,
  xprSchema,
  operatorSchema,
  keywordSchema
]))

// List expression: { list: [expr, expr, ...] }
const listSchema = z.object({ list: z.array(z.lazy(() => z.union([refSchema, valSchema, listSchema]))) })

// Compound expression: { xpr: xo[] }
const xprSchema = z.object({ xpr: z.array(xoSchema) })

// Full where clause schema: xo[]
const whereClauseSchema = z.array(xoSchema)

// Aggregate function expression: { func: 'count', args: ['*'] | [{ ref: ['field'] }], as: 'alias' }
const aggregateFuncSchema = z.enum(['count', 'sum', 'avg', 'min', 'max'])
const aggregateArgSchema = z.union([z.literal('*'), refSchema])
const aggregateSchema = z.object({
  func: aggregateFuncSchema.describe('Aggregate function name'),
  args: z.array(aggregateArgSchema).describe('Function arguments: ["*"] for count(*), or [{ ref: ["field"] }] for field aggregates'),
  as: z.string().optional().describe('Result column alias')
})

// Expand item: wildcard or ref objects (CDS runtime requires refs in expand, not strings)
const expandItemSchema = z.lazy(() => z.union([
  z.literal('*'),
  z.object({
    ref: z.array(z.string()).min(1),
    as: z.string().optional(),
    expand: z.array(expandItemSchema).optional()
  })
]))

// Column expression: string field, ref path (with optional expand/alias), or aggregate
const columnSchema = z.union([
  z.object({
    ref: z.array(z.string()).min(1),
    as: z.string().optional(),
    expand: z.array(expandItemSchema).optional()
  }),
  aggregateSchema
])

// Order expression: { ref: ['field'], sort?: 'asc'|'desc', nulls?: 'first'|'last' }
const orderSchema = z.object({
  ref: z.array(z.string()).min(1),
  sort: z.enum(['asc', 'desc']).optional(),
  nulls: z.enum(['first', 'last']).optional()
})

// Where schema description for MCP tools
const WHERE_DESCRIPTION = `CQN where clause as array of tokens. Format: [expr, operator, expr, keyword?, expr, operator, expr, ...]

Expressions:
- Field reference: { "ref": ["fieldName"] }
- Literal value: { "val": value }
- List of values: { "list": [{ "val": v1 }, { "val": v2 }] }
- Nested expression: { "xpr": [...tokens...] }`

// Select schema description for MCP tools
const SELECT_DESCRIPTION = `List of fields or aggregate expressions to return.
Defaults to all fields if not specified.
- Field name: "fieldName" or "association.field" for path expressions
- Ref path: { "ref": ["assoc", "field"], "as": "alias" } for explicit path with optional alias
- Expand: { "ref": ["assoc"], "expand": [{ "ref": ["field1"] }, { "ref": ["field2"] }] } for to-many associations as nested arrays. Use ["*"] to expand all fields.
- Aggregate: { "func": "count|sum|avg|min|max", "args": ["*"] or [{ "ref": ["field"] }], "as": "alias" }

Examples:
- ["title", "price"] - select fields
- [{ "ref": ["author", "name"], "as": "authorName" }] - select association field with alias
- [{ "ref": ["books"], "expand": [{ "ref": ["title"] }, { "ref": ["price"] }] }] - expand to-many as nested array
- [{ "func": "count", "args": ["*"], "as": "total" }] - count all rows
- ["author_ID", { "func": "sum", "args": [{ "ref": ["stock"] }], "as": "totalStock" }] - group field + aggregate`

// OrderBy schema description for MCP tools
const ORDERBY_DESCRIPTION = `Array of order expressions to sort results.

Each expression:
- ref: Field reference as array, e.g. ["fieldName"] or ["assoc", "field"]
- sort: "asc" or "desc" (optional)
- nulls: "first" or "last" (optional)

Examples:
- [{ "ref": ["price"], "sort": "desc" }] - sort by price descending
- [{ "ref": ["name"] }, { "ref": ["date"], "sort": "desc" }] - multi-field sort`

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
    .describe('Field(s) to group results by for aggregation queries. Use with aggregate functions in select.')
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `group by clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
  schema.limit = z.number().int().min(1).optional()
    .describe('Maximum number of results to return (default: 20)')
  schema.orderBy = z.array(orderSchema).optional()
    .describe(ORDERBY_DESCRIPTION)
    .refine(
      (val) => !val || JSON.stringify(val).length <= MAX_CLAUSE_LENGTH,
      { message: `order by clause exceeds maximum length of ${MAX_CLAUSE_LENGTH} characters` }
    )
  schema.distinct = z.boolean().optional()
    .describe('Return only unique/distinct rows')
  schema.one = z.boolean().optional()
    .describe('Return a single record object instead of an array. Implies limit of 1.')

  return z.object(schema)
}

// Extracts all field references from a CQN where clause array.
function extractFieldsFromWhere(whereArray) {
  if (!Array.isArray(whereArray)) return []

  const fields = []
  for (const token of whereArray) {
    if (token && typeof token === 'object') {
      // Reference expression: { ref: ['field'] } or { ref: ['assoc', 'field'] }
      if (token.ref && Array.isArray(token.ref) && token.ref.length > 0) {
        fields.push({ ref: [token.ref[0]] })
      }
      // Compound expression: { xpr: [...] }
      if (token.xpr && Array.isArray(token.xpr)) {
        fields.push(...extractFieldsFromWhere(token.xpr))
      }
      // List expression: { list: [...] }
      if (token.list && Array.isArray(token.list)) {
        fields.push(...extractFieldsFromWhere(token.list))
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

    // Add description from @description, @title, or doc
    const description = param['@description'] || param['@title'] || param.doc
    if (description) {
      zodType = zodType.describe(description)
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
  MAX_CLAUSE_LENGTH
}
