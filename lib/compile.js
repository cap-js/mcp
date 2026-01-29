const cds = require('@sap/cds')
const z = require('zod')
const { createReadInputSchema } = require('./utils/cds-to-schema')

function isMcpService(srv) {
  if (srv['@mcp']) return true

  const protocol = srv['@protocol']
  if (protocol === 'mcp') return true
  if (Array.isArray(protocol) && protocol.some(p => p === 'mcp' || p.kind === 'mcp')) return true

  return false
}

// Helper to get the base entity for projections (handles nested projections recursively)
function getBaseEntity(entity, model) {
  const baseRef = entity.query?.SELECT?.from?.ref?.[0]
  if (!baseRef || !model) return null

  const baseEntity = model.definitions[baseRef]
  if (!baseEntity) return null

  // If base entity is also a projection, recurse
  if (baseEntity.query?.SELECT?.from?.ref) {
    return getBaseEntity(baseEntity, model)
  }

  return baseEntity
}

function generateToolsForService(def, model) {
  const tools = []
  const entities = def.entities || {}
  const usePerEntityTools = cds.env.features?.mcp_per_entity_tool === true

  if (usePerEntityTools) {
    for (const [entityName, entity] of Object.entries(entities)) {
      // Skip auto-exposed entities
      if (entity['@cds.autoexposed']) continue

      // Get base entity for projections to access doc comments
      const baseEntity = getBaseEntity(entity, model)
      const entityDoc = entity.doc || baseEntity?.doc

      const toolName = `read_${entityName}`
      const label = cds.i18n.labels.at(entity, 'en') || entity['@description'] || entity['@title'] ||
        `Read ${entityName} entities from ${def.name}`
      const description = entityDoc ? `${entityDoc}\n\n${label}` : label

      const inputSchema = createReadInputSchema()

      tools.push({
        name: toolName,
        description,
        inputSchema: z.toJSONSchema(inputSchema)
      })
    }
  } else {
    const entityNames = Object.keys(entities).filter(n => !entities[n]['@cds.autoexposed'])
    const inputSchema = createReadInputSchema({ entityNames })

    tools.push({
      name: 'read_query',
      description: `Query any entity in ${def.name} service. Use describe_model to discover available entities and their fields.`,
      inputSchema: z.toJSONSchema(inputSchema)
    })
  }

  // Add describe_model tool
  const entityNames = Object.keys(entities).filter(n => !entities[n]['@cds.autoexposed'])

  const describeModelInputSchema = entityNames.length > 0
    ? z.object({
      entity: z.enum([entityNames[0], ...entityNames.slice(1)]).optional()
        .describe('Specific entity name to describe. If omitted, describes all entities.')
    })
    : z.object({
      entity: z.string().optional()
        .describe('Specific entity name to describe. If omitted, describes all entities.')
    })

  tools.push({
    name: 'describe_model',
    description: `Describe the data model of ${def.name} service`,
    inputSchema: z.toJSONSchema(describeModelInputSchema)
  })

  return tools
}

function cds_compile_to_mcp(csn, options = {}) {
  const model = cds.linked(csn)
  const mcpServices = model.services.filter(isMcpService)

  if (mcpServices.length === 0) {
    throw new Error(
      'No MCP services found. Annotate your service with @mcp or @protocol: \'mcp\''
    )
  }

  const services = {}
  for (const def of mcpServices) {
    services[def.name] = {
      tools: generateToolsForService(def, model)
    }
  }

  const result = {
    version: '1.0',
    services
  }

  // Return as object if requested, otherwise as formatted JSON string
  if (/^obj|object$/i.test(options.as)) return result

  return JSON.stringify(result, null, 2)
}

module.exports = cds_compile_to_mcp
