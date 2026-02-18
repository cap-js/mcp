const z = require('zod')

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

// Column expression: string field name OR aggregate expression
const columnSchema = z.union([z.string(), aggregateSchema])

// Where schema description for MCP tools
const WHERE_DESCRIPTION = `CQN where clause as array of tokens. Format: [expr, operator, expr, keyword?, expr, operator, expr, ...]

Expressions:
- Field reference: { "ref": ["fieldName"] }
- Literal value: { "val": value }
- List of values: { "list": [{ "val": v1 }, { "val": v2 }] }
- Nested expression: { "xpr": [...tokens...] }`

// Select schema description for MCP tools
const SELECT_DESCRIPTION = `List of fields or aggregate expressions to return.
- Field name: "fieldName" or "association.field" for path expressions
- Aggregate: { "func": "count|sum|avg|min|max", "args": ["*"] or [{ "ref": ["field"] }], "as": "alias" }

Examples:
- ["title", "price"] - select fields
- [{ "func": "count", "args": ["*"], "as": "total" }] - count all rows
- ["author_ID", { "func": "sum", "args": [{ "ref": ["stock"] }], "as": "totalStock" }] - group field + aggregate`

function createReadInputSchema(options = {}) {
  const { entityNames } = options

  const schema = {}

  // Add entity selector for generic mode
  if (entityNames?.length > 0) {
    schema.entity = z.enum([entityNames[0], ...entityNames.slice(1)])
      .describe('The entity to query')
  }

  schema.where = whereClauseSchema.optional()
    .describe(WHERE_DESCRIPTION)
  schema.select = z.array(columnSchema).optional()
    .describe(SELECT_DESCRIPTION)
  schema.groupBy = z.array(z.string()).optional()
    .describe('Field(s) to group results by for aggregation queries. Use with aggregate functions in select.')
  schema.limit = z.number().int().min(1).optional()
    .describe('Maximum number of results to return (default: 20)')
  schema.orderBy = z.union([z.string(), z.array(z.string())]).optional()
    .describe('Field(s) to sort results by')
  schema.sort = z.enum(['asc', 'desc']).optional()
    .describe('Sort direction: ascending (default) or descending')
  schema.distinct = z.boolean().optional()
    .describe('Return only unique/distinct rows')
  schema.one = z.boolean().optional()
    .describe('Return a single record object instead of an array. Implies limit of 1.')

  return z.object(schema)
}

// Extracts all field names referenced in a CQN where clause array.
function extractFieldsFromWhere(whereArray) {
  if (!Array.isArray(whereArray)) return []

  const fields = []
  for (const token of whereArray) {
    if (token && typeof token === 'object') {
      // Reference expression: { ref: ['field'] } or { ref: ['assoc', 'field'] }
      if (token.ref && Array.isArray(token.ref) && token.ref.length > 0) {
        fields.push(token.ref[0]) // First element is the entity field
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

module.exports = {
  createReadInputSchema,
  extractFieldsFromWhere
}
