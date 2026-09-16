const z = require('zod')
const toon = require('@toon-format/toon')

const { getDescription, parseAssertRange } = require('../utils/cds-to-schema')
const { resolveQueryLimits } = require('../utils/limits')

const LOG = cds.log('mcp')
const {
  renderTypeRef,
  describeReturns
} = require('../utils/tools-shared')

// Draft-related elements added by CAP for draft-enabled entities
const DRAFT_ELEMENTS = [
  'IsActiveEntity',
  'HasDraftEntity',
  'HasActiveEntity',
  'DraftAdministrativeData',
  'DraftAdministrativeData_DraftUUID',
  'SiblingEntity',
  'DraftMessages'
]

const LOCALIZED_ELEMENTS = ['localized', 'texts']


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
function registerDescribeTool(server, srv, entities, actions = {}, prefix) {
  const entityNames = Object.keys(entities)
  const actionNames = Object.keys(actions)
  if (entityNames.length === 0 && actionNames.length === 0) {
    LOG.debug(srv.name, '-', 'No entities or actions to describe')
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
    (args) => executeDescribe(srv, entities, actions, args)
  )

  LOG.debug(srv.name, '-', 'Registered tool', { tool: def.name })
}

function executeDescribe(srv, entities, actions, args) {
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

  LOG(srv.name, 'describe', {
    ...(includeEntities && { entities: entityNames }),
    ...(includeActions && { actions: actionNamesToDescribe })
  })

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

      const elements = function elements4 (csn_elements) {
        const elements = {}
        for (const [elemName, elem] of Object.entries (csn_elements || {})) {
          // Skip draft-related, localized, and @cds.api.ignore elements
          if (DRAFT_ELEMENTS.includes(elemName) || LOCALIZED_ELEMENTS.includes(elemName)) continue
          if (elem['@odata.foreignKey4']) continue
          if (elem['@cds.api.ignore']) continue

          // Prepare the spec object for this element
          const spec = {}

          // Add description if given
          const descr = getDescription(elem)
          if (descr) spec.description = descr

          // Add type information
          spec.type = elem.type?.replace(/^cds\./,'')

          if (elem.isAssociation) {
            let target = elem.target
            // Association element

            // REVISIT: We should handle dangling associations to entities not served by this service.
            // The code below attempts to resolve local entity references within the service.
            // It is currently commented out because it may not handle all edge cases correctly.
            //
            // if (target.startsWith(srv.name)) {
            //   let local = elem.target.slice(srv.name.length + 1)
            //   if (local in srv.entities) target = local
            // }

            if (elem.is2many) spec.many = true

            if (target.startsWith(srv.name) && target.slice(srv.name.length + 1) in entities) {
              spec.target = target // served by this service
            } else {
              // dangling association to an entity not served by this service.
              if (!elem.foreignKeys) continue // skip unmanaged external associations
              // use a cross-reference structure for the foreign keys instead
              spec.elements = elements4 (elem.foreignKeys) // struct like instead
              // delete spec.target
              // delete spec.type
            }


            // We likely don't need the below, but keeping it parked here, just in case...
            // if (elem.keys) spec.keys = elem.keys.map(k => k.as || k.ref.join('.'))

          } else {
            // Regular element
            if (elem.notNull || elem['@mandatory']) {
              spec.notNull = true
            }
            if (elem.enum) {
              let enums = Object.entries(elem.enum).map(([key, { val }]) => [key, val])
              spec.enum = Object.fromEntries(enums)
            }
            if (elem['@assert.range']) {
              const range = parseAssertRange(elem['@assert.range'])
              spec.range = range?.text || elem['@assert.range']
            }
            if (elem['@assert.format']) {
              spec.format = elem['@assert.format']
            }
          }

          // Finally add the spec to the elements object
          elements[elemName] = spec
        }
        return elements
      } (entity.elements)

      const keys = Object.keys(elements).filter(e => entity.elements[e].key)

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
    content: [{ type: 'text', text: toon.encode(description) }],
    structuredContent: description
  }
}

module.exports = {
  createDescribeToolDefinition,
  registerDescribeTool,
  executeDescribe
}
