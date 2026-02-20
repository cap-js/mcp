const cds = require('@sap/cds')
const z = require('zod')
const {
  createGenericReadToolDefinition,
  createPerEntityReadToolDefinition,
  createCallActionToolDefinition,
  createDescribeToolDefinition
} = require('./tools')

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

  // Filter out auto-exposed entities
  const filteredEntities = Object.entries(entities)
    .filter(([, entity]) => !entity['@cds.autoexposed'])

  if (usePerEntityTools) {
    for (const [entityName, entity] of filteredEntities) {
      // Get base entity for projections to access doc comments (compile-time specific)
      const baseEntity = getBaseEntity(entity, model)
      const entityDoc = entity.doc || baseEntity?.doc

      const toolDef = createPerEntityReadToolDefinition(entityName, entity, def.name, entityDoc)
      tools.push({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: z.toJSONSchema(toolDef.inputSchema)
      })
    }
  } else {
    const entityNames = filteredEntities.map(([name]) => name)
    const toolDef = createGenericReadToolDefinition(entityNames, def.name)
    tools.push({
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: z.toJSONSchema(toolDef.inputSchema)
    })
  }

  // Collect actions/functions
  const actions = {}
  for (const [name, child] of Object.entries(def.actions || {})) {
    if (child.kind === 'action' || child.kind === 'function') {
      actions[name] = child
    }
  }
  const actionNames = Object.keys(actions)
  const entityNames = filteredEntities.map(([name]) => name)

  const describeDef = createDescribeToolDefinition(entityNames, actionNames, def.name)
  tools.push({
    name: describeDef.name,
    description: describeDef.description,
    inputSchema: z.toJSONSchema(describeDef.inputSchema)
  })

  // Add call_action tool if service has actions/functions
  if (actionNames.length > 0) {
    const actionDef = createCallActionToolDefinition(actionNames, def.name)
    tools.push({
      name: actionDef.name,
      description: actionDef.description,
      inputSchema: z.toJSONSchema(actionDef.inputSchema)
    })
  }

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
