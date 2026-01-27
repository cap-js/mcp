const cds = require('@sap/cds')
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

// Filter schema description for MCP tools
const FILTER_DESCRIPTION = `CQN where clause as array of tokens. Format: [expr, operator, expr, keyword?, expr, operator, expr, ...]

Expressions:
- Field reference: { "ref": ["fieldName"] }
- Literal value: { "val": value }
- List of values: { "list": [{ "val": v1 }, { "val": v2 }] }
- Nested expression: { "xpr": [...tokens...] }`

const CDS_TYPE_MAP = {
  'cds.String': () => z.string(),
  'cds.LargeString': () => z.string(),
  'cds.UUID': () => z.string(), // REVISIT: could use z.uuid()
  'cds.Integer': () => z.number().int(),
  'cds.Integer64': () => cds.env.requires?.db?.kind === 'hana' ? z.string() : z.number().int(),
  'cds.Decimal': () => cds.env.requires?.db?.kind === 'hana' ? z.string() : z.number(),
  'cds.Double': () => z.number(),
  'cds.Boolean': () => z.boolean(),
  'cds.Date': () => z.string(),
  'cds.Time': () => z.string(),
  'cds.DateTime': () => z.string(),
  'cds.Timestamp': () => z.string(),
  'cds.Binary': () => z.string(),
  'cds.LargeBinary': () => z.string()
}

function _cds2Zod(cdsType, element = {}) {
  const schemaFactory = CDS_TYPE_MAP[cdsType] || (() => z.string())
  let schema = schemaFactory()

  if (cdsType === 'cds.String' && element.length) {
    schema = schema.max(element.length)
  }

  if (element.enum) {
    const enumValues = Object.keys(element.enum)
    if (enumValues.length > 0) {
      schema = z.enum([enumValues[0], ...enumValues.slice(1)])
    }
  }

  const desc = cds.i18n.labels.at(element, 'en') || element['@description'] || element['@title']
  if (desc) {
    schema = schema.describe(desc)
  }

  return schema
}

function cdsEntityToReadInputSchema(entity, entityName) {
  const elements = entity.elements || {}
  const selectableFields = []

  for (const [elemName, elem] of Object.entries(elements)) {
    // Skip associations/compositions for select
    if (elem.target) continue
    selectableFields.push(elemName)
  }

  const fieldEnum = z.enum([selectableFields[0], ...selectableFields.slice(1)])

  return z.object({
    filter: whereClauseSchema.optional()
      .describe(FILTER_DESCRIPTION),
    select: z.array(fieldEnum).optional()
      .describe('List of fields to return. If omitted, returns all fields.'),
    limit: z.number().int().min(1).optional()
      .describe('Maximum number of results to return (default: 20)'),
    orderBy: z.union([fieldEnum, z.array(fieldEnum)]).optional()
      .describe('Field(s) to sort results by'),
    sort: z.enum(['asc', 'desc']).optional()
      .describe('Sort direction: ascending (default) or descending')
  })
}

// Creates a generic read input schema for all entities in a service (default behavior)
function cdsServiceToGenericReadInputSchema(entities, serviceName) {
  const entityNames = Object.entries(entities)
    .filter(([_, entity]) => !entity['@cds.autoexposed'] && !entity.name.endsWith('DraftAdministrativeData'))
    .map(([name]) => name)

  if (entityNames.length === 0) {
    throw new Error(`No queryable entities found in service ${serviceName}`)
  }

  // Entity field as enum of available entity names
  const entityEnum = z.enum([entityNames[0], ...entityNames.slice(1)])
    .describe('The entity to query')

  return z.object({
    entity: entityEnum,
    filter: whereClauseSchema.optional()
      .describe(FILTER_DESCRIPTION + '\n\nUse describe_model to see available fields for each entity.'),
    select: z.array(z.string()).optional()
      .describe('List of fields to return. Use describe_model to see available fields.'),
    limit: z.number().int().min(1).optional()
      .describe('Maximum number of results to return (default: 20)'),
    orderBy: z.union([z.string(), z.array(z.string())]).optional()
      .describe('Field(s) to sort results by'),
    sort: z.enum(['asc', 'desc']).optional()
      .describe('Sort direction: ascending (default) or descending')
  })
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
  cdsEntityToReadInputSchema,
  cdsServiceToGenericReadInputSchema,
  extractFieldsFromWhere
}
