const cds = require('@sap/cds')
const z = require('zod')
const {
  createGenericReadToolDefinition,
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  createDescribeToolDefinition,
  getInstructions
} = require('./tools')
const { getDescription } = require('./utils/cds-to-schema')
const { slugified, resolvePrefix } = require('./utils/service-name')

const MCP_BASE_PATH = '/mcp'

// Convert relative $ref paths to absolute paths from document root
function resolveRefsToAbsolutePaths(schema, toolIndex) {
  let jsonStr = JSON.stringify(schema)

  // Replace relative #/definitions/ refs with absolute paths from document root
  jsonStr = jsonStr.replace(
    /#\/definitions\//g,
    `#/tools/${toolIndex}/inputSchema/definitions/`
  )

  const converted = JSON.parse(jsonStr)

  return converted
}

function generateToolsForService(def, model) {
  const tools = []
  const entities = def.entities || {}
  const usePerActionTools = cds.env.mcp?.per_action_tool === true
  const prefix = resolvePrefix(def)

  // Filter out composition-only autoexposed, draft, and @cds.api.ignore entities
  const filteredEntities = Object.entries(entities)
    .filter(([name, entity]) => !(entity['@cds.autoexposed'] && !entity['@cds.autoexpose']) && !name.endsWith('DraftAdministrativeData') && !entity['@cds.api.ignore'])

  const entityNames = filteredEntities.map(([name]) => name)
  const toolDef = createGenericReadToolDefinition(entityNames, def.name, prefix)
  tools.push({
    name: toolDef.name,
    description: toolDef.description,
    inputSchema: resolveRefsToAbsolutePaths(z.toJSONSchema(toolDef.inputSchema, { target: 'draft-07' }), tools.length),
    annotations: toolDef.annotations
  })

  // Collect actions/functions
  const actions = {}
  for (const [name, child] of Object.entries(def.actions || {})) {
    if ((child.kind === 'action' || child.kind === 'function') && !child['@cds.api.ignore']) {
      actions[name] = child
    }
  }
  const actionNames = Object.keys(actions)

  const describeDef = createDescribeToolDefinition(entityNames, actionNames, def.name, prefix)
  tools.push({
    name: describeDef.name,
    description: describeDef.description,
    inputSchema: resolveRefsToAbsolutePaths(z.toJSONSchema(describeDef.inputSchema, { target: 'draft-07' }), tools.length),
    annotations: describeDef.annotations
  })

  // Add action tools if service has actions/functions
  if (actionNames.length > 0) {
    if (usePerActionTools) {
      // Register individual tools per action/function
      for (const [actionName, action] of Object.entries(actions)) {
        const actionDef = createPerActionToolDefinition(actionName, action, def.name, model, prefix)
        tools.push({
          name: actionDef.name,
          description: actionDef.description,
          inputSchema: resolveRefsToAbsolutePaths(z.toJSONSchema(actionDef.inputSchema, { target: 'draft-07' }), tools.length),
          annotations: actionDef.annotations
        })
      }
    } else {
      // Register generic call_action tool
      const actionDef = createCallActionToolDefinition(actionNames, def.name, prefix)
      tools.push({
        name: actionDef.name,
        description: actionDef.description,
        inputSchema: resolveRefsToAbsolutePaths(z.toJSONSchema(actionDef.inputSchema, { target: 'draft-07' }), tools.length),
        annotations: actionDef.annotations
      })
    }
  }

  return tools
}

function _compileService(def, model, options) {
  // Build service path - respect @path annotation, otherwise use slugified name
  // Strip leading slash from @path if present
  const customPath = def['@path']
  const servicePath = customPath ? customPath.replace(/^\//, '') : slugified(def.name)

  // Extract description using centralized function (with 'en' locale for compile-time)
  const description = (getDescription(def, 'en') || `MCP server for ${def.name}`).slice(0, 100)

  // Generate MCP Server Card format
  const prefix = resolvePrefix(def)
  const serverCard = {
    $schema: 'https://pages.github.tools.sap/CPA/mcp-protocol/spec-v1/mcp-server-card-spec.schema.json',
    name: `sap.cds.services/${slugified(def.name)}`,
    title: def.name,
    version: '1.0.0',
    supportedProtocolVersions: ['2025-11-25'],
    description,
    instructions: getInstructions(def, 'en', prefix),
    remotes: [
      {
        type: 'streamable-http',
        url: `${MCP_BASE_PATH}/${servicePath}`
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

function cds_compile_to_mcp(csn, options = {}) {
  const model = cds.linked(csn)
  const services = model.services

  if (services.length === 0) {
    throw new Error(
      'No service definitions found in given model(s).'
    )
  }

  // When service is 'all', return a generator yielding a card per service
  if (options.service === 'all') {
    return function* () {
      for (const def of services) {
        yield [_compileService(def, model, options), { file: def.name, suffix: '.json' }]
      }
    }()
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

  return _compileService(def, model, options)
}

module.exports = cds_compile_to_mcp
