const cds = require('@sap/cds')

const MCP_DEFAULT_LIMIT = 20
const GLOBAL_MAX_DEFAULT = 1000

function parseLimitAnnotation(def) {
  if (!def) return null

  const limit = def['@cds.query.limit']
  const limitDefault = def['@cds.query.limit.default']
  const limitMax = def['@cds.query.limit.max']

  // Check if any limit annotation exists (use explicit undefined check for 0 values)
  if (limit === undefined && limitDefault === undefined && limitMax === undefined) {
    return null
  }

  // @cds.query.limit: 0 disables at this level
  if (limit === 0) {
    return { disabled: true }
  }

  // @cds.query.limit: Number (shorthand for max only)
  if (typeof limit === 'number') {
    return { max: limit }
  }

  const result = {}
  if (limitDefault !== undefined) result.default = limitDefault
  if (limitMax !== undefined) result.max = limitMax
  return Object.keys(result).length > 0 ? result : null
}

// Entity annotation > Service annotation > Global config (cds.env.query.limit)
// MCP fallback (default: 20) applies when no default is resolved from any level
function resolveQueryLimits(entity, serviceDefinition) {
  const globalConfig = cds.env.query?.limit || {}

  const serviceLimits = parseLimitAnnotation(serviceDefinition)

  const entityLimits = parseLimitAnnotation(entity)

  // Start with global config values
  let effectiveDefault = globalConfig.default  // undefined if not set
  let effectiveMax = globalConfig.max ?? GLOBAL_MAX_DEFAULT

  // Apply service-level limits (if not disabled)
  if (serviceLimits && !serviceLimits.disabled) {
    if (serviceLimits.default !== undefined) effectiveDefault = serviceLimits.default
    if (serviceLimits.max !== undefined) effectiveMax = serviceLimits.max
  }

  // Apply entity-level limits (closest wins)
  if (entityLimits) {
    if (entityLimits.disabled) {
      // @cds.query.limit: 0 disables default at entity level
      // Falls back through service to global
      effectiveDefault = serviceLimits?.default ?? globalConfig.default
    } else {
      if (entityLimits.default !== undefined) effectiveDefault = entityLimits.default
      if (entityLimits.max !== undefined) effectiveMax = entityLimits.max
    }
  }

  // MCP fallback: apply when no default is resolved from any level
  // This ensures AI agents always have a sensible default limit
  if (effectiveDefault === undefined) {
    effectiveDefault = MCP_DEFAULT_LIMIT
  }

  return {
    default: effectiveDefault,
    max: effectiveMax
  }
}

module.exports = {
  resolveQueryLimits
}
