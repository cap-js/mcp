const cds = require('@sap/cds')
const { inspect } = require('util')

const { resolveI18n, resolveTypeDef } = require('../utils/cds-to-schema')

const LOG = cds.log('mcp')

const fmt = (obj) => inspect(obj, { depth: 8, compact: 3, breakLength: 80, colors: true })

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

function getInstructions(def, locale, prefix_) {
  locale = locale || cds.context?.locale || 'en'
  const custom = resolveI18n(def['@mcp.instructions'], locale)
  return (
    custom ||
    `Always use the \`${prefix_}describe\` tool to explore the data model and available actions/functions. ` +
      `Only then use \`${prefix_}query\` to read data or \`${prefix_}call\` to invoke actions or functions.`
  )
}

// Create MCP error response
function errorResponse(message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

// Format error for display — includes details when CAP groups multiple errors
function formatError(err) {
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

// Build clean args object for logging (filter out empty values)
function buildQueryArgs(args) {
  return Object.fromEntries(
    Object.entries(args).filter(
      ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
    )
  )
}

const removeCdsPrefix = (type) => type?.replace(/^cds\./, '') || type

// Resolve a type reference to a human-readable string, recursively flattening custom types
function renderTypeRef(ref, model, depth = 0) {
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
    if (ref.type.startsWith('cds.')) return removeCdsPrefix(ref.type)

    // Custom type — resolve from model
    const typeDef = model && resolveTypeDef(ref.type, model)
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
    return removeCdsPrefix(ref.type)
  }

  return 'unknown'
}

// Build a human-readable return type string from an action definition
function describeReturns(action, model) {
  if (!action.returns) return null
  return renderTypeRef(action.returns, model)
}

module.exports = {
  LOG,
  fmt,
  DRAFT_ELEMENTS,
  LOCALIZED_ELEMENTS,
  getInstructions,
  errorResponse,
  formatError,
  buildQueryArgs,
  removeCdsPrefix,
  renderTypeRef,
  describeReturns
}
