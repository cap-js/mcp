const cds = require('@sap/cds')
const z = require('zod')
const { CDS_TO_ZOD_TYPE_MAP, getDescription } = require('./utils/cds-to-schema')
const { formatResult } = require('./utils/format')

const LOG = cds.log('mcp')

// Draft-related elements to skip
const DRAFT_ELEMENTS = new Set([
  'IsActiveEntity', 'HasActiveEntity', 'HasDraftEntity',
  'DraftAdministrativeData', 'DraftAdministrativeData_DraftUUID',
  'SiblingEntity', 'DraftMessages'
])

const MANAGED_ELEMENTS = new Set([
  'createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'
])

// ---------------------------------------------------------------------------
// Naming utilities
// ---------------------------------------------------------------------------

function toKebab(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

function singularize(name) {
  if (name.endsWith('ies')) return name.slice(0, -3) + 'y'
  if (name.endsWith('ses')) return name.slice(0, -2)
  if (name.endsWith('s') && !name.endsWith('ss')) return name.slice(0, -1)
  return name
}

function singularKebab(name) {
  return singularize(toKebab(name))
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function getDraftEnabledEntities(entities) {
  const result = []
  for (const [name, def] of Object.entries(entities)) {
    if (def['@odata.draft.enabled'] || def['@Common.DraftRoot.ActivationAction']) {
      result.push({ name, def })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

function getKeyElements(entity) {
  const keys = {}
  for (const [name, elem] of Object.entries(entity.elements || {})) {
    if (!elem.key) continue
    if (DRAFT_ELEMENTS.has(name)) continue
    if (elem.type === 'cds.Association') continue
    // Skip parent FK keys (up__ID pattern) — they're provided as parent key params
    if (name.startsWith('up_')) continue
    keys[name] = elem
  }
  return keys
}

function buildZodParams(elements) {
  const params = {}
  for (const [name, elem] of Object.entries(elements)) {
    const factory = CDS_TO_ZOD_TYPE_MAP[elem.type]
    let zodType = factory ? factory() : z.string()
    const desc = getDescription(elem) || name
    params[name] = zodType.describe(desc)
  }
  return params
}

function getWritableElements(entity) {
  const result = {}
  for (const [name, elem] of Object.entries(entity.elements || {})) {
    if (DRAFT_ELEMENTS.has(name)) continue
    if (MANAGED_ELEMENTS.has(name)) continue
    if (elem.key) continue
    if (name.startsWith('up_')) continue
    if (elem['@Core.Computed']) continue
    if (elem['@readonly']) continue
    if (elem.type === 'cds.Composition' || elem.type === 'cds.Association') continue
    result[name] = elem
  }
  return result
}

function buildWritableZodParams(entity) {
  const elements = getWritableElements(entity)
  const params = {}
  for (const [name, elem] of Object.entries(elements)) {
    const factory = CDS_TO_ZOD_TYPE_MAP[elem.type]
    let zodType = factory ? factory() : z.string()
    const desc = getDescription(elem)
    if (desc) zodType = zodType.describe(desc)
    if (!elem.notNull && !elem['@mandatory']) zodType = zodType.optional()
    params[name] = zodType
  }
  return params
}

// All fields optional (for partial UPDATE)
function buildOptionalWritableZodParams(entity) {
  const elements = getWritableElements(entity)
  const params = {}
  for (const [name, elem] of Object.entries(elements)) {
    const factory = CDS_TO_ZOD_TYPE_MAP[elem.type]
    let zodType = factory ? factory() : z.string()
    const desc = getDescription(elem)
    if (desc) zodType = zodType.describe(desc)
    params[name] = zodType.optional()
  }
  return params
}

function getCompositions(entity) {
  const result = []
  for (const [name, elem] of Object.entries(entity.elements || {})) {
    if (elem.type !== 'cds.Composition') continue
    if (DRAFT_ELEMENTS.has(name)) continue
    if (elem.target) result.push({ elementName: name, target: elem.target })
  }
  return result
}

// ---------------------------------------------------------------------------
// Ref-path builders (inline where inside from)
// ---------------------------------------------------------------------------

function buildDraftWhere(keyValues) {
  const parts = []
  for (const [k, v] of Object.entries(keyValues)) {
    if (parts.length > 0) parts.push('and')
    parts.push({ ref: [k] }, '=', { val: v })
  }
  parts.push('and', { ref: ['IsActiveEntity'] }, '=', { val: false })
  return parts
}

/**
 * Build a CQN ref-path for a root entity draft operation.
 * e.g. { ref: [{ id: 'Service.Entity', where: [ID=x and IsActiveEntity=false] }] }
 */
function buildRootRef(fullEntityName, keyValues) {
  return { ref: [{ id: fullEntityName, where: buildDraftWhere(keyValues) }] }
}

/**
 * Build a CQN ref-path for a composition child operation.
 * e.g. { ref: [{ id: 'Service.Root', where: [...] }, { id: 'children', where: [...] }] }
 * For INSERT (no child key): last segment is plain string (element name).
 */
function buildChildRef(fullRootEntity, rootKeyValues, compositionPath, childKeyValues) {
  const segments = [{ id: fullRootEntity, where: buildDraftWhere(rootKeyValues) }]
  // Intermediate composition segments
  for (let i = 0; i < compositionPath.length - 1; i++) {
    const seg = compositionPath[i]
    segments.push({ id: seg.elementName, where: buildDraftWhere(seg.keyValues) })
  }
  const lastSeg = compositionPath[compositionPath.length - 1]
  if (childKeyValues) {
    // UPDATE / DELETE — target specific child
    segments.push({ id: lastSeg.elementName, where: buildDraftWhere(childKeyValues) })
  } else {
    // INSERT — target composition collection
    segments.push(lastSeg.elementName)
  }
  return { ref: segments }
}

// ---------------------------------------------------------------------------
// Tool generation — root entity
// ---------------------------------------------------------------------------

function createRootDraftTools(entityName, entity, serviceName) {
  const fullEntity = `${serviceName}.${entityName}`
  const kebab = toKebab(entityName)
  const keyElements = getKeyElements(entity)
  const keyParams = buildZodParams(keyElements)
  const writableParams = buildWritableZodParams(entity)
  const tools = []

  // activate
  if (entity['@Common.DraftRoot.ActivationAction']) {
    tools.push({
      name: `activate-${kebab}`,
      description: `Activate a draft ${entityName} (make it the active version).`,
      inputSchema: z.object(keyParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (srv, args) => {
        return srv.send({ event: 'draftActivate', entity: fullEntity, data: { ...args, IsActiveEntity: false } })
      }
    })
  }

  // edit
  if (entity['@Common.DraftRoot.EditAction']) {
    tools.push({
      name: `edit-${kebab}`,
      description: `Put an active ${entityName} into edit mode (creates a draft copy).`,
      inputSchema: z.object(keyParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (srv, args) => {
        return srv.send({ event: 'draftEdit', entity: fullEntity, data: { ...args, IsActiveEntity: true } })
      }
    })
  }

  // create — skip for @readonly entities (no INSERT allowed)
  if (!entity['@readonly']) {
    tools.push({
      name: `create-${kebab}`,
      description: `Create a new draft ${entityName}.`,
      inputSchema: z.object(writableParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (srv, args) => {
        return srv.run(INSERT.into(fullEntity).entries({ ...args, IsActiveEntity: false }))
      }
    })
  }

  // update — uses ref-path with inline where (all writable fields optional for partial update)
  const optionalWritableParams = buildOptionalWritableZodParams(entity)
  tools.push({
    name: `update-${kebab}`,
    description: `Update a draft ${entityName} by its key.`,
    inputSchema: z.object({ ...keyParams, ...optionalWritableParams }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (srv, args) => {
      const keyValues = {}
      const data = {}
      for (const [k, v] of Object.entries(args)) {
        if (k in keyElements) keyValues[k] = v
        else data[k] = v
      }
      const ref = buildRootRef(fullEntity, keyValues)
      return srv.run(UPDATE.entity(ref).set(data))
    }
  })

  // discard — uses ref-path with inline where
  tools.push({
    name: `discard-${kebab}`,
    description: `Discard (delete) a draft ${entityName}.`,
    inputSchema: z.object(keyParams),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (srv, args) => {
      const ref = buildRootRef(fullEntity, args)
      return srv.run(DELETE.from(ref))
    }
  })

  return tools
}

// ---------------------------------------------------------------------------
// Tool generation — composition children (recursive)
// ---------------------------------------------------------------------------

function createChildDraftTools(serviceName, rootEntityName, rootEntity, childElementName, childEntity, parentKeyParams, compositionPath) {
  const fullRootEntity = `${serviceName}.${rootEntityName}`
  const childKebab = singularKebab(childElementName)
  const childKeyElements = getKeyElements(childEntity)
  const childKeyParams = buildZodParams(childKeyElements)
  const childWritableParams = buildWritableZodParams(childEntity)
  const childOptionalWritableParams = buildOptionalWritableZodParams(childEntity)
  const tools = []

  // create-{child} — insert into composition
  tools.push({
    name: `create-${childKebab}`,
    description: `Create a new ${childKebab} within a draft ${rootEntityName}.`,
    inputSchema: z.object({ ...parentKeyParams, ...childWritableParams }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (srv, args) => {
      const { rootKeyValues, data } = _splitArgs(args, parentKeyParams)
      const ref = buildChildRef(fullRootEntity, rootKeyValues, compositionPath, null)
      return srv.run(INSERT.into(ref).entries({ ...data, IsActiveEntity: false }))
    }
  })

  // update-{child} (all writable fields optional for partial update)
  tools.push({
    name: `update-${childKebab}`,
    description: `Update a ${childKebab} within a draft ${rootEntityName}.`,
    inputSchema: z.object({ ...parentKeyParams, ...childKeyParams, ...childOptionalWritableParams }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (srv, args) => {
      const { rootKeyValues, childKeyValues, data } = _splitArgsWithChild(args, parentKeyParams, childKeyElements)
      const ref = buildChildRef(fullRootEntity, rootKeyValues, compositionPath, childKeyValues)
      return srv.run(UPDATE.entity(ref).set(data))
    }
  })

  // discard-{child}
  tools.push({
    name: `discard-${childKebab}`,
    description: `Discard (delete) a ${childKebab} from a draft ${rootEntityName}.`,
    inputSchema: z.object({ ...parentKeyParams, ...childKeyParams }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (srv, args) => {
      const { rootKeyValues, childKeyValues } = _splitArgsWithChild(args, parentKeyParams, childKeyElements)
      const ref = buildChildRef(fullRootEntity, rootKeyValues, compositionPath, childKeyValues)
      return srv.run(DELETE.from(ref))
    }
  })

  return tools
}

function _splitArgs(args, parentKeyParams) {
  const rootKeyValues = {}
  const data = {}
  for (const [k, v] of Object.entries(args)) {
    if (k in parentKeyParams) rootKeyValues[k] = v
    else data[k] = v
  }
  return { rootKeyValues, data }
}

function _splitArgsWithChild(args, parentKeyParams, childKeyElements) {
  const rootKeyValues = {}
  const childKeyValues = {}
  const data = {}
  for (const [k, v] of Object.entries(args)) {
    if (k in parentKeyParams) rootKeyValues[k] = v
    else if (k in childKeyElements) childKeyValues[k] = v
    else data[k] = v
  }
  return { rootKeyValues, childKeyValues, data }
}

// ---------------------------------------------------------------------------
// Recursive composition walker
// ---------------------------------------------------------------------------

function walkCompositions(serviceName, rootEntityName, rootEntity, parentEntity, parentKeyParams, compositionPath, model, allTools) {
  const compositions = getCompositions(parentEntity)

  for (const { elementName, target } of compositions) {
    const childEntity = model?.definitions?.[target]
    if (!childEntity) continue

    const path = [...compositionPath, { elementName }]
    const childTools = createChildDraftTools(serviceName, rootEntityName, rootEntity, elementName, childEntity, parentKeyParams, path)
    allTools.push(...childTools)

    // Build extended key params for deeper recursion (parent keys + this child's keys)
    const childKeyElements = getKeyElements(childEntity)
    const childKeyParams = { ...parentKeyParams, ...buildZodParams(childKeyElements) }

    // Recurse into child's compositions
    walkCompositions(serviceName, rootEntityName, rootEntity, childEntity, childKeyParams, path, model, allTools)
  }
}

// ---------------------------------------------------------------------------
// Main: createDraftTools (root + all composition children)
// ---------------------------------------------------------------------------

function createDraftTools(entityName, entity, serviceName, model) {
  const tools = createRootDraftTools(entityName, entity, serviceName)

  // Walk compositions recursively
  const rootKeyElements = getKeyElements(entity)
  const rootKeyParams = buildZodParams(rootKeyElements)
  walkCompositions(serviceName, entityName, entity, entity, rootKeyParams, [], model, tools)

  return tools
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function registerDraftTools(server, srv, entities, prefix) {

  const draftEntities = getDraftEnabledEntities(entities)
  if (draftEntities.length === 0) return

  for (const { name, def } of draftEntities) {
    const tools = createDraftTools(name, def, srv.name, srv.model)

    for (const tool of tools) {
      const toolName = prefix ? `${prefix}_${tool.name}` : tool.name

      server.registerTool(
        toolName,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations
        },
        async (args) => {
          LOG(toolName, { service: srv.name, args })
          try {
            const result = await tool.handler(srv, args)
            const structured = { action: toolName, result }
            return {
              content: [{ type: 'text', text: formatResult(structured) }],
              structuredContent: structured
            }
          } catch (err) {
            LOG.error('Draft tool failed', { tool: toolName, error: err.message })
            return {
              content: [{ type: 'text', text: `Error: ${err.message}` }],
              isError: true
            }
          }
        }
      )
      LOG.debug('Registered draft tool', { tool: toolName, entity: name, service: srv.name })
    }
  }
}

module.exports = {
  getDraftEnabledEntities,
  createDraftTools,
  registerDraftTools
}
