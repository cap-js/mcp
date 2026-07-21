const cds = require('@sap/cds')
const z = require('zod')
const { CDS_TO_ZOD_TYPE_MAP, getDescription } = require('./utils/cds-to-schema')
const { formatResult } = require('./utils/format')

const LOG = cds.log('mcp')

// Draft-related elements to skip
const DRAFT_ELEMENTS = new Set([
  'IsActiveEntity',
  'HasActiveEntity',
  'HasDraftEntity',
  'DraftAdministrativeData',
  'DraftAdministrativeData_DraftUUID',
  'SiblingEntity',
  'DraftMessages'
])

const MANAGED_ELEMENTS = new Set(['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy'])

// ---------------------------------------------------------------------------
// Naming utilities
// ---------------------------------------------------------------------------

function toKebab(name) {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

/**
 * Derive singular form. Prefers `@singular` annotation.
 * Port of @cap-js/cds-typer singular4 (lib/util.js).
 * Accepts multiple sources; first with `@singular` annotation wins.
 * The last source (or a bare string) is used for derivation.
 * @param {...(object|string)} sources - CSN defs or bare names in precedence order
 */
function singular4(...sources) {
  for (const src of sources) {
    if (typeof src === 'object' && src?.['@singular']) return src['@singular']
  }
  const last = sources[sources.length - 1]
  const n = typeof last === 'string' ? last : (last?.name ?? '')
  if (/.*species|news$/i.test(n)) return n
  if (/.*ess$/.test(n)) return n // Address
  if (/.*ees$/.test(n)) return n.slice(0, -1) // Employees → Employee
  if (/.*[sz]es$/.test(n)) return n.slice(0, -2)
  if (/.*[^aeiou]ies$/.test(n)) return n.slice(0, -3) + 'y' // Deliveries → Delivery
  if (/.*s$/.test(n)) return n.slice(0, -1)
  if (/.*_$/.test(n)) return n.slice(0, -1) // typer edge case
  return n
}

/**
 * Kebab-case singularized name. Accepts multiple sources (see singular4).
 */
function singularKebab(...sources) {
  return toKebab(singular4(...sources))
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Expose `.drafts` virtual entities for draft-enabled entities.
 * Mutates the given entities object by adding `name + '.drafts'` entries.
 */
function exposeDraftEntities(entities) {
  for (const [name, entity] of Object.entries(entities)) {
    if (
      entity.drafts ||
      entity['@odata.draft.enabled'] ||
      entity['@Common.DraftRoot.ActivationAction']
    ) {
      entities[name + '.drafts'] = entity.drafts || entity
    }
  }
  return entities
}

function getDraftEnabledEntities(entities) {
  const result = []
  for (const [name, def] of Object.entries(entities)) {
    if (def.isDraft) continue
    if (def['@readonly']) continue
    if (def['@odata.draft.enabled'] || def['@Common.DraftRoot.ActivationAction']) {
      result.push({ name, def })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Schema builders
// ---------------------------------------------------------------------------

// True if `assocElem` is targeted by a Composition on its target entity ($self backlink).
// CAP's `_isBacklink` also fires for many-to-many assoc backlinks — extra check disambiguates.
function _isCompositionParentBacklink(entity, assocElem, model) {
  if (!assocElem?._isBacklink) return false
  if (!assocElem.target || !model?.definitions) return false
  const targetDef = model.definitions[assocElem.target]
  if (!targetDef) return false
  for (const el of Object.values(targetDef.elements || {})) {
    if (el.type !== 'cds.Composition') continue
    if (el.target === entity.name) return true
  }
  return false
}

function getKeyElements(entity, model) {
  const keys = {}
  const elements = entity.elements || {}
  for (const [name, elem] of Object.entries(elements)) {
    if (!elem.key) continue
    if (DRAFT_ELEMENTS.has(name)) continue
    if (elem.type === 'cds.Association') continue
    // Skip parent FK keys (up__ID pattern)
    if (name.startsWith('up_')) continue
    // Skip backlink properties (unmanaged assocs with `on` clause)
    if (elem.on) continue
    // Skip FK columns backing a composition-parent backlink assoc
    const backingAssocName = elem['@odata.foreignKey4']
    if (backingAssocName) {
      const backingAssoc = elements[backingAssocName]
      if (backingAssocName === 'up_') continue
      if (_isCompositionParentBacklink(entity, backingAssoc, model)) continue
    }
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

function getWritableElements(entity, model) {
  const result = {}
  const elements = entity.elements || {}
  for (const [name, elem] of Object.entries(elements)) {
    if (DRAFT_ELEMENTS.has(name)) continue
    if (MANAGED_ELEMENTS.has(name)) continue
    if (elem.key) continue
    if (name.startsWith('up_')) continue
    if (elem['@Core.Computed']) continue
    if (elem['@readonly']) continue
    if (elem.type === 'cds.Composition' || elem.type === 'cds.Association') continue
    // Skip backlink properties (unmanaged assocs with `on` clause) — not writable
    if (elem.on) continue
    // Skip FK columns backing a composition-parent backlink assoc.
    // Regular managed assocs (e.g. author_ID → Authors) remain writable.
    const backingAssocName = elem['@odata.foreignKey4']
    if (backingAssocName) {
      const backingAssoc = elements[backingAssocName]
      if (backingAssocName === 'up_') continue
      if (_isCompositionParentBacklink(entity, backingAssoc, model)) continue
    }
    result[name] = elem
  }
  return result
}

/**
 * Build Zod schema for writable elements.
 * @param {object} entity - CSN entity definition
 * @param {object} [opts]
 * @param {boolean} [opts.allOptional=false] - if true, all fields are optional (for partial UPDATE);
 *   otherwise mandatory fields stay required
 */
function buildWritableZodParams(entity, { allOptional = false, model } = {}) {
  const elements = getWritableElements(entity, model)
  const params = {}
  for (const [name, elem] of Object.entries(elements)) {
    const factory = CDS_TO_ZOD_TYPE_MAP[elem.type]
    let zodType = factory ? factory() : z.string()
    const desc = getDescription(elem)
    if (desc) zodType = zodType.describe(desc)
    const isRequired = !allOptional && (elem.notNull || elem['@mandatory'])
    if (!isRequired) zodType = zodType.optional()
    params[name] = zodType
  }
  return params
}

function getCompositions(entity) {
  const result = []
  for (const [name, elem] of Object.entries(entity.elements || {})) {
    if (elem.type !== 'cds.Composition') continue
    if (DRAFT_ELEMENTS.has(name)) continue
    if (elem.target) result.push({ elementName: name, target: elem.target, element: elem })
  }
  return result
}

function getCompositionParentLink(entity) {
  for (const elem of Object.values(entity.elements || {})) {
    if (!elem?._isBacklink) continue
    const key = elem.keys?.[0]
    const fk = key?.$generatedFieldName
    const parentKey = key?.ref?.[0]
    if (fk && parentKey) return { fk, parentKey }
  }
  return null
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
function buildChildRef(fullRootEntity, parentParams, compositionPath, childKeyValues) {
  const segments = [{ id: fullRootEntity, where: buildDraftWhere(parentParams[0] || {}) }]
  // Intermediate composition segments
  for (let i = 0; i < compositionPath.length - 1; i++) {
    const seg = compositionPath[i]
    segments.push({ id: seg.elementName, where: buildDraftWhere(parentParams[i + 1] || {}) })
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

function createRootDraftTools(entityName, entity, serviceName, model) {
  const fullEntity = `${serviceName}.${entityName}`
  const kebab = toKebab(entityName)
  const keyElements = getKeyElements(entity, model)
  const keyParams = buildZodParams(keyElements)
  const writableParams = buildWritableZodParams(entity, { model })
  const tools = []
  const entityPath = entityName

  // activate
  if (entity['@Common.DraftRoot.ActivationAction']) {
    tools.push({
      name: `activate-${kebab}`,
      entityPath,
      op: 'activate',
      description: `Activate a draft ${entityName} (make it the active version).`,
      inputSchema: z.object(keyParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      // Signals to agent plugins that this tool requires human-in-the-loop approval
      _requiresHITL: true,
      handler: async (srv, args) => {
        // Activate: target .drafts entity via SAVE event (CAP maps SAVE → draftActivate)
        const draftEntity = srv.entities[entityName]?.drafts
        return srv.send('SAVE', draftEntity || fullEntity, args)
      }
    })
  }

  // edit
  if (entity['@Common.DraftRoot.EditAction']) {
    tools.push({
      name: `edit-${kebab}`,
      entityPath,
      op: 'edit',
      description: `Put an active ${entityName} into edit mode (creates a draft copy).`,
      inputSchema: z.object(keyParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (srv, args) => {
        // Edit: target active entity via EDIT event (CAP maps EDIT → draftEdit)
        return srv.send('EDIT', fullEntity, args)
      }
    })
  }

  // create — skip for @readonly entities (no INSERT allowed)
  if (!entity['@readonly']) {
    tools.push({
      name: `create-${kebab}`,
      entityPath,
      op: 'create',
      description: `Create a new draft ${entityName}.`,
      inputSchema: z.object(writableParams),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (srv, args) => {
        // Use CAP draft API: target the .drafts entity via NEW event.
        // Fires before('NEW', Entity.drafts) handlers for ID gen, defaults, etc.
        const draftEntity = srv.entities[entityName]?.drafts
        return srv.send('NEW', draftEntity || fullEntity, {
          ...args,
          IsActiveEntity: false
        })
      }
    })
  }

  // update — target .drafts entity so before/on handlers fire
  const optionalWritableParams = buildWritableZodParams(entity, { allOptional: true, model })
  tools.push({
    name: `update-${kebab}`,
    entityPath,
    op: 'update',
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
      const draftEntity = srv.entities[entityName]?.drafts
      if (draftEntity) {
        const query = UPDATE(draftEntity)
          .set(data)
          .where({ ...keyValues, IsActiveEntity: false })
        return srv.send({
          event: 'UPDATE',
          entity: draftEntity,
          data,
          query,
          params: [keyValues]
        })
      }
      // Fallback for models without draft support
      const ref = buildRootRef(fullEntity, keyValues)
      return srv.run(UPDATE.entity(ref).set(data))
    }
  })

  // discard — target .drafts entity via CANCEL event (CAP's draft discard)
  tools.push({
    name: `discard-${kebab}`,
    entityPath,
    op: 'discard',
    description: `Discard (delete) a draft ${entityName}.`,
    inputSchema: z.object(keyParams),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (srv, args) => {
      const draftEntity = srv.entities[entityName]?.drafts
      if (draftEntity) {
        const query = DELETE.from(draftEntity).where({ ...args, IsActiveEntity: false })
        return srv.send({
          event: 'CANCEL',
          entity: draftEntity,
          query,
          params: [args]
        })
      }
      const ref = buildRootRef(fullEntity, args)
      return srv.run(DELETE.from(ref))
    }
  })

  return tools
}

// ---------------------------------------------------------------------------
// Tool generation — composition children (recursive)
// ---------------------------------------------------------------------------

function createChildDraftTools(
  serviceName,
  rootEntityName,
  rootEntity,
  childElementName,
  childEntity,
  parentKeyParams,
  parentParamGroups,
  compositionPath,
  compositionElement,
  model
) {
  const fullRootEntity = `${serviceName}.${rootEntityName}`
  const childKebab = singularKebab(compositionElement, childEntity, childElementName)
  const childKeyElements = getKeyElements(childEntity, model)
  const childKeyParams = buildZodParams(childKeyElements)
  const childWritableParams = buildWritableZodParams(childEntity, { model })
  const childOptionalWritableParams = buildWritableZodParams(childEntity, {
    allOptional: true,
    model
  })
  const childDraftEntity =
    childEntity.drafts || model?.definitions?.[`${childEntity.name}.drafts`] || childEntity
  const parentLink = getCompositionParentLink(childEntity)
  const tools = []
  const entityPath = `${rootEntityName}.${compositionPath.map((p) => p.elementName).join('.')}`

  // create-{child} — dispatch NEW on composition child's draft entity
  tools.push({
    name: `create-${childKebab}`,
    entityPath,
    op: 'create',
    description: `Create a new ${childKebab} within a draft ${rootEntityName}.`,
    inputSchema: z.object({ ...parentKeyParams, ...childWritableParams }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (srv, args) => {
      const { parentParams, data } = _splitArgs(args, parentParamGroups)
      const draftRoot = srv.entities[rootEntityName]?.drafts?.name || fullRootEntity
      const ref = buildChildRef(draftRoot, parentParams, compositionPath, null)
      const draftData = { ...data, IsActiveEntity: false }
      const immediateParent = parentParams[parentParams.length - 1] || {}
      if (parentLink?.fk && parentLink.parentKey in immediateParent) {
        draftData[parentLink.fk] = immediateParent[parentLink.parentKey]
      }
      // Dispatch NEW with path query + params so application handlers see req.query and req.params.
      const result = await srv.send({
        event: 'NEW',
        entity: childDraftEntity,
        data: draftData,
        query: INSERT.into(ref).entries(draftData),
        params: parentParams
      })
      // Normalize: CDS 9 returns single object, CDS 10+ returns array
      return Array.isArray(result) ? result : [result]
    }
  })

  // update-{child} (all writable fields optional for partial update)
  tools.push({
    name: `update-${childKebab}`,
    entityPath,
    op: 'update',
    description: `Update a ${childKebab} within a draft ${rootEntityName}.`,
    inputSchema: z.object({
      ...parentKeyParams,
      ...childKeyParams,
      ...childOptionalWritableParams
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: async (srv, args) => {
      const { parentParams, childKeyValues, data } = _splitArgs(
        args,
        parentParamGroups,
        childKeyElements
      )
      const query = UPDATE(childDraftEntity)
        .set(data)
        .where(_buildChildWhere(parentParams, childKeyValues, parentLink))
      return srv.send({
        event: 'UPDATE',
        entity: childDraftEntity,
        data,
        query,
        params: [...parentParams, childKeyValues]
      })
    }
  })

  // discard-{child}
  tools.push({
    name: `discard-${childKebab}`,
    entityPath,
    op: 'discard',
    description: `Discard (delete) a ${childKebab} from a draft ${rootEntityName}.`,
    inputSchema: z.object({ ...parentKeyParams, ...childKeyParams }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    handler: async (srv, args) => {
      const { parentParams, childKeyValues } = _splitArgs(args, parentParamGroups, childKeyElements)
      const query = DELETE.from(childDraftEntity).where(
        _buildChildWhere(parentParams, childKeyValues, parentLink)
      )
      return srv.send({
        event: 'CANCEL',
        entity: childDraftEntity,
        query,
        params: [...parentParams, childKeyValues]
      })
    }
  })

  return tools
}

function _buildChildWhere(parentParams, childKeyValues, parentLink) {
  const where = { ...childKeyValues, IsActiveEntity: false }
  const immediateParent = parentParams[parentParams.length - 1] || {}
  if (parentLink?.fk && parentLink.parentKey in immediateParent) {
    where[parentLink.fk] = immediateParent[parentLink.parentKey]
  }
  return where
}

// Split tool args into parent path params + remaining data.
// parentParamGroups: [{ params, reverseMap }] ordered root → immediate parent.
function _splitArgs(args, parentParamGroups, childKeyElements) {
  const parentParams = parentParamGroups.map(() => ({}))
  const childKeyValues = {}
  const data = {}
  for (const [k, v] of Object.entries(args)) {
    let matched = false
    for (let i = 0; i < parentParamGroups.length; i++) {
      const { params, reverseMap } = parentParamGroups[i]
      if (k in params) {
        parentParams[i][reverseMap[k] || k] = v
        matched = true
        break
      }
    }
    if (matched) continue
    if (childKeyElements && k in childKeyElements) {
      childKeyValues[k] = v
    } else {
      data[k] = v
    }
  }
  return { parentParams, childKeyValues, data }
}

// ---------------------------------------------------------------------------
// Recursive composition walker
// ---------------------------------------------------------------------------

function walkCompositions(
  serviceName,
  rootEntityName,
  rootEntity,
  parentEntity,
  parentKeyParams,
  parentParamGroups,
  compositionPath,
  model,
  allTools
) {
  const compositions = getCompositions(parentEntity)

  for (const { elementName, target, element } of compositions) {
    const childEntity = model?.definitions?.[target]
    if (!childEntity) continue

    const path = [...compositionPath, { elementName }]
    const childTools = createChildDraftTools(
      serviceName,
      rootEntityName,
      rootEntity,
      elementName,
      childEntity,
      parentKeyParams,
      parentParamGroups,
      path,
      element,
      model
    )
    allTools.push(...childTools)

    // Build extended key params for deeper recursion
    const childKeyElements = getKeyElements(childEntity, model)
    const { params: childPrefixed, reverseMap: childReverse } = buildPrefixedKeyParams(
      elementName,
      childKeyElements,
      element,
      childEntity
    )
    const nextParams = { ...parentKeyParams, ...childPrefixed }
    const nextParamGroups = [
      ...parentParamGroups,
      { params: childPrefixed, reverseMap: childReverse }
    ]

    walkCompositions(
      serviceName,
      rootEntityName,
      rootEntity,
      childEntity,
      nextParams,
      nextParamGroups,
      path,
      model,
      allTools
    )
  }
}

// ---------------------------------------------------------------------------
// Main: createDraftTools (root + all composition children)
// ---------------------------------------------------------------------------

function createDraftTools(entityName, entity, serviceName, model) {
  const tools = createRootDraftTools(entityName, entity, serviceName, model)

  // Walk compositions recursively
  const rootKeyElements = getKeyElements(entity, model)
  const { params: rootKeyParams, reverseMap: rootReverseMap } = buildPrefixedKeyParams(
    entityName,
    rootKeyElements
  )
  const rootParamGroups = [{ params: rootKeyParams, reverseMap: rootReverseMap }]
  walkCompositions(
    serviceName,
    entityName,
    entity,
    entity,
    rootKeyParams,
    rootParamGroups,
    [],
    model,
    tools
  )

  return tools
}

/**
 * Build Zod key params prefixed with singular entity name.
 * E.g. entity "Books" with key `ID` → param `book_ID`.
 * Returns { paramName: zodType } AND a reverse-map { paramName: originalKeyName }.
 */
function buildPrefixedKeyParams(entityName, keyElements, ...singularSources) {
  const prefix = singular4(...singularSources, entityName).toLowerCase()
  const params = {}
  const reverseMap = {} // paramName → original key name
  for (const [name, elem] of Object.entries(keyElements)) {
    const paramName = `${prefix}_${name}`
    const factory = CDS_TO_ZOD_TYPE_MAP[elem.type]
    let zodType = factory ? factory() : z.string()
    const desc = getDescription(elem) || `${entityName} ${name}`
    params[paramName] = zodType.describe(desc)
    reverseMap[paramName] = name
  }
  return { params, reverseMap }
}

// ---------------------------------------------------------------------------
// Registration — per-entity mode (per_action_tool = true)
// ---------------------------------------------------------------------------

function registerPerEntityDraftTools(server, srv, draftEntities, prefix) {
  const model = cds.context?.model || srv.model

  for (const { name, def } of draftEntities) {
    const tools = createDraftTools(name, def, srv.name, model)

    for (const tool of tools) {
      const toolName = prefix ? `${prefix}_${tool.name}` : tool.name

      server.registerTool(
        toolName,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          // Signal to agent plugins (e.g. deepagents interruptOn) — HITL required for activation
          ...(tool._requiresHITL && { _meta: { requiresHITL: true } })
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
            LOG.error('Draft tool failed', {
              tool: toolName,
              error: err?.message || err,
              stack: err?.stack
            })
            return {
              content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
              isError: true
            }
          }
        }
      )
      LOG.debug('Registered draft tool', { tool: toolName, entity: name, service: srv.name })
    }
  }
}

// ---------------------------------------------------------------------------
// Registration — combined mode (per_action_tool = false, default)
// ---------------------------------------------------------------------------

function registerCombinedDraftTools(server, srv, draftEntities, prefix) {
  const model = cds.context?.model || srv.model

  // Collect all tools from all draft entities, bucketed by operation
  const buckets = { activate: [], edit: [], create: [], update: [], discard: [] }

  for (const { name, def } of draftEntities) {
    const tools = createDraftTools(name, def, srv.name, model)
    for (const tool of tools) {
      if (buckets[tool.op]) buckets[tool.op].push(tool)
    }
  }

  // Build combined tool for each operation bucket
  const combinedDefs = [
    {
      op: 'activate',
      toolName: 'activate-draft',
      description:
        'Activate a draft entity (make it the active version). Specify the entity and its keys.',
      _requiresHITL: true,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      op: 'edit',
      toolName: 'edit-draft',
      description:
        'Put an active entity into edit mode (creates a draft copy). Specify the entity and its keys.',
      _requiresHITL: false,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      op: 'create',
      toolName: 'create-draft',
      description: 'Create a new draft entity. Specify the entity and provide field values.',
      _requiresHITL: false,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      op: 'update',
      toolName: 'update-draft',
      description: 'Update a draft entity. Specify the entity, its keys, and fields to update.',
      _requiresHITL: false,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
    },
    {
      op: 'discard',
      toolName: 'discard-draft',
      description: 'Discard (delete) a draft entity. Specify the entity and its keys.',
      _requiresHITL: false,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
    }
  ]

  for (const def of combinedDefs) {
    const tools = buckets[def.op]
    if (tools.length === 0) continue

    // Build handler map and entity-specific field documentation
    const handlerMap = {}
    const entityPaths = []
    const entityDescriptions = []

    for (const tool of tools) {
      handlerMap[tool.entityPath] = tool.handler
      entityPaths.push(tool.entityPath)
      const rawShape = tool.inputSchema._def.shape
      const shape = typeof rawShape === 'function' ? rawShape() : rawShape
      const required = []
      const optional = []
      for (const [key, zodType] of Object.entries(shape)) {
        if (zodType.isOptional()) optional.push(key)
        else required.push(key)
      }
      const parts = []
      if (required.length) parts.push(`required: ${required.join(', ')}`)
      if (optional.length) parts.push(`optional: ${optional.join(', ')}`)
      entityDescriptions.push(`  ${tool.entityPath} { ${parts.join('; ')} }`)
    }

    const fullDescription = `${def.description}\n\nEntities and their fields:\n${entityDescriptions.join('\n')}`

    const inputSchema = z.object({
      entity: z
        .enum([entityPaths[0], ...entityPaths.slice(1)])
        .describe('The draft entity to operate on'),
      keys: z
        .object({})
        .passthrough()
        .optional()
        .describe('Entity keys (e.g. {ID: 1}). Use describe to see key fields per entity.'),
      data: z
        .object({})
        .passthrough()
        .optional()
        .describe('Fields to set. Use describe to see writable fields per entity.')
    })

    const fullToolName = prefix ? `${prefix}_${def.toolName}` : def.toolName

    server.registerTool(
      fullToolName,
      {
        description: fullDescription,
        inputSchema,
        annotations: def.annotations,
        ...(def._requiresHITL && { _meta: { requiresHITL: true } })
      },
      async (args) => {
        const { entity, keys, data } = args
        // Merge keys + data into flat args for the per-entity handler
        const handlerArgs = { ...keys, ...data }
        LOG(fullToolName, { service: srv.name, entity, args: handlerArgs })
        const handler = handlerMap[entity]
        if (!handler) {
          return {
            content: [{ type: 'text', text: `Error: Unknown entity "${entity}"` }],
            isError: true
          }
        }
        try {
          const result = await handler(srv, handlerArgs)
          const structured = { action: fullToolName, entity, result }
          return {
            content: [{ type: 'text', text: formatResult(structured) }],
            structuredContent: structured
          }
        } catch (err) {
          LOG.error('Draft tool failed', {
            tool: fullToolName,
            entity,
            error: err?.message || err,
            stack: err?.stack
          })
          return {
            content: [{ type: 'text', text: `Error: ${err?.message || String(err)}` }],
            isError: true
          }
        }
      }
    )
    LOG.debug('Registered combined draft tool', { tool: fullToolName, service: srv.name })
  }
}

// ---------------------------------------------------------------------------
// Registration — entry point
// ---------------------------------------------------------------------------

function registerDraftTools(server, srv, entities, prefix) {
  const draftEntities = getDraftEnabledEntities(entities)
  if (draftEntities.length === 0) return

  if (cds.env.mcp?.per_action_tool) {
    registerPerEntityDraftTools(server, srv, draftEntities, prefix)
  } else {
    registerCombinedDraftTools(server, srv, draftEntities, prefix)
  }
}

module.exports = {
  exposeDraftEntities,
  getDraftEnabledEntities,
  createDraftTools,
  registerDraftTools,
  singular4,
  singularKebab,
  _isCompositionParentBacklink
}
