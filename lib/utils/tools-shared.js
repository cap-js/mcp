const cds = require('@sap/cds')

exports.getFilteredEntities = function (srv) {
  const entities = {}, composed = {}
  for (let each in srv.entities) {
    if (each.endsWith('DraftAdministrativeData')) continue
    if (each.endsWith('.drafts')) continue
    if (each.endsWith('.texts')) continue
    let entity = srv.entities[each]
    if (entity['@cds.api.ignore']) continue
    if (entity['@cds.autoexpose'] && entity['@cds.autoexposed']) continue
    else entities[each] = entity
  }
  if (Object.keys(entities).length === 0) return entities
  else return { ...entities, ...composed }
}

exports.getInstructions = function (def, locale, prefix_) {
  locale = locale || cds.context?.locale || 'en'
  const custom = exports.resolveI18n(def['@mcp.instructions'], locale)
  return (
    custom ||
    `Always use the \`${prefix_}describe\` tool to explore the data model and available actions/functions. ` +
      `Only then use \`${prefix_}query\` to read data or \`${prefix_}call\` to invoke actions or functions.`
  )
}

exports.resolveI18n = function (value, locale) {
  if (!value) return undefined
  if (value.startsWith('{i18n>')) {
    return cds.i18n.labels.texts4?.(locale)?.[value.slice(7,-1)] || value
  }
  return value
}


// Create MCP error response
exports.errorResponse = function (message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

// Format error for display — includes details when CAP groups multiple errors
exports.formatError = function (err) {
  if (err.details?.length) {
    return JSON.stringify(
      err.details.map((d) => {
        const e = { message: d.message }
        if (d.target) e.target = d.target
        return e
      })
    )
  }
  return err.message
}


// Resolve a type reference to a human-readable string, recursively flattening custom types
exports.renderTypeRef = function renderTypeRef (ref, model, depth = 0) {
  if (!ref || depth > 5) return 'unknown'

  // Array case (many / array of)
  if (ref.items) {
    return `Array of ${renderTypeRef(ref.items, model, depth + 1)}`
  }

  // Inline struct case
  if (ref.elements) {
    const fields = Object.entries(ref.elements)
      .map(([name, el]) => `${name}: ${renderTypeRef(el, model, depth + 1)}`)
      .join(', ')
    return `{${fields}}`
  }

  // Type reference
  if (ref.type) {
    // CDS primitive
    if (ref.type.startsWith('cds.')) return ref.type.replace(/^cds\./,'')

    // Custom type — resolve from model
    const typeDef = model.definitions[ref.type]
    if (typeDef) {
      // Structured custom type
      if (typeDef.elements) {
        const fields = Object.entries(typeDef.elements)
          .map(([name, el]) => `${name}: ${renderTypeRef(el, model, depth + 1)}`)
          .join(', ')
        return `{${fields}}`
      }
      // Scalar alias — recurse into the aliased type
      if (typeDef.type) {
        return renderTypeRef(typeDef, model, depth + 1)
      }
    }

    // Fallback — unknown custom type, keep its name
    return ref.type.replace(/^cds\./,'')
  }

  return 'unknown'
}

// Build a human-readable return type string from an action definition
exports.describeReturns = function (action, model) {
  if (action.returns) return exports.renderTypeRef(action.returns, model)
}
