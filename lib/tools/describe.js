const z = require('zod')

const { getDescription, parseAssertRange } = require('../utils/cds-to-schema')
const { resolveQueryLimits } = require('../utils/limits')

const {
  LOG,
  fmt,
  formatResult,
  DRAFT_ELEMENTS,
  LOCALIZED_ELEMENTS,
  removeCdsPrefix,
  renderTypeRef,
  describeReturns
} = require('../utils/tools-shared')

function createDescribeToolDefinition(entityNames, actionNames, serviceName, prefix = '') {
  const schemaFields = {}

  if (entityNames.length > 0) {
    schemaFields.entities = z
      .array(z.enum(entityNames))
      .optional()
      .describe('Specific entities to get element details for.')
  }

  if (actionNames.length > 0) {
    schemaFields.actions = z
      .array(z.enum(actionNames))
      .optional()
      .describe('Specific actions or functions to get parameter details for.')
  }

  const name = prefix + 'describe'
  return {
    name,
    description:
      `Describe the data model of ${serviceName} service. ` +
      `Returns an overview of all entities and actions with descriptions. ` +
      `Specify 'entity' to get element details, or 'action' to get parameter details.`,
    inputSchema: z.object(schemaFields),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  }
}

// Register the describe tool for service introspection
function registerDescribeTool(server, srv, entities, actions = {}, prefix, { log = LOG } = {}) {
  const entityNames = Object.keys(entities)
  const actionNames = Object.keys(actions)
  if (entityNames.length === 0 && actionNames.length === 0) {
    log.debug('No entities or actions to describe', { service: srv.name })
    return
  }

  const def = createDescribeToolDefinition(entityNames, actionNames, srv.name, prefix)

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations
    },
    (args) => executeDescribe(srv, entities, actions, args, { log })
  )

  log.debug('Registered tool', { tool: def.name, service: srv.name })
}

async function executeDescribe(srv, entities, actions, args, { log = LOG } = {}) {
  return _executeDescribeCsn(srv, entities, actions, args, { log })
}

// CSN format (default): return JSON with element metadata
async function _executeDescribeCsn(srv, entities, actions, args, { log = LOG } = {}) {
  // Determine what to include:
  // - If only entity specified => return only those entities (no actions)
  // - If only action specified => return only those actions (no entities)
  // - If both specified => return both
  // - If neither specified => return all entities and all actions
  const hasEntity = args.entities?.length > 0
  const hasAction = args.actions?.length > 0
  const includeEntities = hasEntity || !hasAction
  const includeActions = hasAction || !hasEntity

  // Detail mode: show elements/parameters when specific entity/action is requested
  const isEntityDetail = hasEntity
  const isActionDetail = hasAction

  const entityNames = hasEntity ? args.entities : Object.keys(entities)
  const actionNamesToDescribe = hasAction ? args.actions : Object.keys(actions || {})

  log(
    'describe',
    fmt({
      service: srv.name,
      ...(includeEntities && { entities: entityNames }),
      ...(includeActions && { actions: actionNamesToDescribe })
    })
  )

  const description = {
    service: srv.name,
    description: getDescription(srv.definition) || `Service ${srv.name}`
  }

  // Add entities if included
  if (includeEntities) {
    description.entities = {}

    for (const entityName of entityNames) {
      const entity = entities[entityName]
      if (!entity) continue

      const entityDescription = getDescription(entity) || `Entity ${entityName}`

      // Overview mode: only description
      if (!isEntityDetail) {
        description.entities[entityName] = { description: entityDescription }
        continue
      }

      // Detail mode: include queryLimits and elements
      const queryLimits = resolveQueryLimits(entity, srv.definition)

      const keys = []
      const elements = {}

      for (const [elemName, elem] of Object.entries(entity.elements || {})) {
        // Skip draft-related, localized, and @cds.api.ignore elements
        if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue
        if (elem['@cds.api.ignore']) continue

        if (elem.key) keys.push(elemName)

        const elemDescription = getDescription(elem) || `Element ${elemName}`

        if (elem.target) {
          // Association element
          elements[elemName] = {
            type: `${removeCdsPrefix(elem.type)} (${elem.is2one ? '1-1' : '1-*'})`,
            target: elem.target,
            description: elemDescription
          }
        } else {
          // Regular element
          const elemOutput = {
            type: removeCdsPrefix(elem.type),
            description: elemDescription
          }
          if (elem.notNull || elem['@mandatory']) {
            elemOutput.notNull = true
          }
          if (elem.enum) {
            elemOutput.enum = Object.fromEntries(
              Object.entries(elem.enum).map(([key, { val }]) => [key, val])
            )
          }
          if (elem['@assert.range']) {
            const range = parseAssertRange(elem['@assert.range'])
            elemOutput.range = range?.text || elem['@assert.range']
          }
          if (elem['@assert.format']) {
            elemOutput.format = elem['@assert.format']
          }
          elements[elemName] = elemOutput
        }
      }

      description.entities[entityName] = {
        description: entityDescription,
        keys,
        queryLimits,
        elements
      }
    }
  }

  // Add actions if included
  if (includeActions) {
    description.actions = {}

    for (const actionName of actionNamesToDescribe) {
      const action = actions?.[actionName]
      if (!action) continue
      const actionDescription = getDescription(action) || `${action.kind} ${actionName}`

      // Overview mode: only kind and description
      if (!isActionDetail) {
        description.actions[actionName] = {
          kind: action.kind,
          description: actionDescription
        }
        continue
      }

      // Detail mode: include parameters and returns
      const returns = describeReturns(action, srv.model)

      description.actions[actionName] = {
        kind: action.kind,
        description: actionDescription,
        parameters: {},
        returns
      }

      // Add parameter descriptions
      for (const [paramName, param] of Object.entries(action.params || {})) {
        const paramDescription = getDescription(param) || null
        const paramOutput = {
          type: renderTypeRef(param, srv.model),
          notNull: param.notNull || param['@mandatory'] || false,
          description: paramDescription
        }
        if (param.enum) {
          paramOutput.enum = Object.fromEntries(
            Object.entries(param.enum).map(([key, { val }]) => [key, val])
          )
        }
        if (param['@assert.range']) {
          const range = parseAssertRange(param['@assert.range'])
          paramOutput.range = range?.text || param['@assert.range']
        }
        if (param['@assert.format']) {
          paramOutput.format = param['@assert.format']
        }
        description.actions[actionName].parameters[paramName] = paramOutput
      }
    }
  }

  return {
    content: [{ type: 'text', text: formatResult(description) }],
    structuredContent: description
  }
}

module.exports = {
  createDescribeToolDefinition,
  registerDescribeTool,
  executeDescribe
}
