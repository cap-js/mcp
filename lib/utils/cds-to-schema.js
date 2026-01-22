const cds = require('@sap/cds')
const z = require('zod')

const decimalType = cds.env.requires?.db?.kind === 'hana' ? z.string() : z.number()

const CDS_TYPE_MAP = {
  'cds.String': () => z.string(),
  'cds.LargeString': () => z.string(),
  'cds.UUID': () => z.string(), // REVISIT: could use z.uuid()
  'cds.Integer': () => z.number().int(),
  'cds.Integer64': () => z.number().int(),
  'cds.Decimal': () => decimalType,
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
  const filterProperties = {}
  const selectableFields = []

  for (const [elemName, elem] of Object.entries(elements)) {
    // REVISIT: skip associations/compositions for filter?
    if (elem.target) continue

    selectableFields.push(elemName)
    filterProperties[elemName] = _cds2Zod(elem.type, elem).optional()
  }

  const fieldEnum = z.enum([selectableFields[0], ...selectableFields.slice(1)])

  return z.object({
    filter: z.object(filterProperties).optional()
      .describe(`Filter conditions for ${entityName}. Each property filters by exact match.`),
    select: z.array(fieldEnum).optional()
      .describe('List of fields to return. If omitted, returns all fields.'),
    top: z.number().int().min(1).max(1000).optional()
      .describe('Maximum number of results to return (default: 100)'),
    skip: z.number().int().min(0).optional()
      .describe('Number of results to skip for pagination'),
    orderBy: z.union([fieldEnum, z.array(fieldEnum)]).optional()
      .describe('Field(s) to sort results by')
  })
}

function cdsEntityToReadOutputSchema(entity, entityName) {
  const elements = {}

  for (const [name, elem] of Object.entries(entity.elements || {})) {

    // Revisit: for associations use any type (PoC)
    if (elem.target) {
      elements[name] = z.any().nullable().optional().describe(`Association to ${elem.target}`)
      continue
    }

    const baseSchema = _cds2Zod(elem.type, elem)
    const isMandatory = elem['@mandatory'] || elem.key

    // key and mandatory fields are required
    if (isMandatory) {
      elements[name] = baseSchema
    } else {
      elements[name] = baseSchema.nullable().optional()
    }
  }

  return z.object({
    entity: z.literal(entityName),
    count: z.number().int().describe('Number of records returned'),
    data: z.array(z.object(elements).loose())
  })
}

module.exports = {
  cdsEntityToReadInputSchema,
  cdsEntityToReadOutputSchema
}
