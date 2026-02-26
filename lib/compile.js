const cds = require('@sap/cds')
const z = require('zod')
const {
  createGenericReadToolDefinition,
  createPerEntityReadToolDefinition,
  createCallActionToolDefinition,
  createDescribeToolDefinition
} = require('./tools')

const MCP_BASE_PATH = '/mcp'

// Replicate CAP's internal _slugified function for service path generation
const slugified = name => (
  /[^.]+$/.exec(name)[0]      //> my.very.CatalogService --> CatalogService
  .replace(/Service$/,'')     //> CatalogService --> Catalog
  .replace(/_/g,'-')          //> foo_bar_baz --> foo-bar-baz
  .replace(/([a-z0-9])([A-Z])/g, (_,c,C) => c+'-'+C)  //> ODataFooBarX9 --> OData-Foo-Bar-X9
  .toLowerCase()              //> FOO --> foo
)

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

  // Filter out auto-exposed and draft entities
  const filteredEntities = Object.entries(entities)
    .filter(([name, entity]) => !entity['@cds.autoexposed'] && !name.endsWith('DraftAdministrativeData'))

  if (usePerEntityTools) {
    for (const [entityName, entity] of filteredEntities) {
      // Get base entity for projections to access doc comments (compile-time specific)
      const baseEntity = getBaseEntity(entity, model)
      const entityDoc = entity.doc || baseEntity?.doc

      const toolDef = createPerEntityReadToolDefinition(entityName, entity, def.name, entityDoc)
      tools.push({
        name: toolDef.name,
        description: toolDef.description,
        inputSchema: z.toJSONSchema(toolDef.inputSchema),
        annotations: toolDef.annotations
      })
    }
  } else {
    const entityNames = filteredEntities.map(([name]) => name)
    const toolDef = createGenericReadToolDefinition(entityNames, def.name)
    tools.push({
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: z.toJSONSchema(toolDef.inputSchema),
      annotations: toolDef.annotations
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
    inputSchema: z.toJSONSchema(describeDef.inputSchema),
    annotations: describeDef.annotations
  })

  // Add call_action tool if service has actions/functions
  if (actionNames.length > 0) {
    const actionDef = createCallActionToolDefinition(actionNames, def.name)
    tools.push({
      name: actionDef.name,
      description: actionDef.description,
      inputSchema: z.toJSONSchema(actionDef.inputSchema),
      annotations: actionDef.annotations
    })
  }

  return tools
}

function cds_compile_to_mcp(csn, options = {}) {
  const model = cds.linked(csn)
  const services = model.services

  if (services.length === 0) {
    throw new Error(
      'No service definitions found in given model(s).'
    )
  }

  if (!options.service && services.length > 1) {
    throw new Error(`
    Found multiple service definitions in given model(s).
    Please choose by adding one of...${services.map(s => `\n    -s ${s.name}`).join('')}
  `)
  }

  let def
  if (!options.service) {
    def = services[0]
  } else {
    def = services.find(s => s.name === options.service)
    if (!def) {
      throw new Error(
        `No service definition matching ${options.service} found in given model(s).`
      )
    }
  }

  // Build service path - respect @path annotation, otherwise use slugified name
  // Strip leading slash from @path if present
  const customPath = def['@path']
  const servicePath = customPath
    ? customPath.replace(/^\//, '')
    : slugified(def.name)
  const baseUrl = options.baseUrl || '<baseUrl>'

  // Extract description from @description annotation or generate default
  const description = def['@description'] || `MCP server for ${def.name}`

  // Generate MCP Server Card format
  const serverCard = {
    $schema: 'https://pages.github.tools.sap/CPA/mcp-protocol/spec-v1/mcp-server-card-spec.schema.json',
    name: `<namespace>/${slugified(def.name)}`,
    title: def.name,
    version: '1.0.0',
    supportedProtocolVersions: ['2025-11-25'],
    description,
    instructions: "Use the 'describe' tool to explore the data model and available actions/functions. Then use 'query' to read data or 'call_action' to invoke actions or functions.",
    remotes: [
      {
        type: 'streamable-http',
        url: `${baseUrl}${MCP_BASE_PATH}/${servicePath}`
      }
    ],
    capabilities: {
      tools: {}
    },
    tools: generateToolsForService(def, model)
  }

  if (/^obj|object$/i.test(options.as)) return serverCard

  return JSON.stringify(serverCard, null, 2)
}

module.exports = cds_compile_to_mcp
