/**
 * Validates that a CQN SELECT statement only references entities
 * belonging to a given set of allowed entity names (i.e., the service's own entities).
 *
 * Checks: FROM (refs, joins, SET/union), WHERE (subselects),
 * columns (subselects, expand), orderBy, having.
 *
 * @param {object} cqn - Parsed CQN object (must have .SELECT)
 * @param {Set<string>|string[]} allowedEntities - Entity names accessible in this service
 * @param {string} serviceName - Service name prefix (e.g. 'CatalogService')
 * @returns {{ valid: boolean, entity?: string }} - If invalid, `entity` is the offending ref
 */
function validateCqnTargets(cqn, allowedEntities, serviceName) {
  const allowed = allowedEntities instanceof Set ? allowedEntities : new Set(allowedEntities)
  return _validateSelect(cqn.SELECT, allowed, serviceName)
}

function _isAllowedEntity(entity, allowed, serviceName) {
  if (allowed.has(entity)) return true
  if (serviceName && entity.startsWith(serviceName + '.')) {
    const localName = entity.slice(serviceName.length + 1)
    if (allowed.has(localName)) return true
  }
  return false
}

function _validateSelect(select, allowed, serviceName) {
  if (!select) return { valid: true }

  const fromResult = _validateFrom(select.from, allowed, serviceName)
  if (!fromResult.valid) return fromResult

  const colResult = _validateExprList(select.columns, allowed, serviceName)
  if (!colResult.valid) return colResult

  const whereResult = _validateExprList(select.where, allowed, serviceName)
  if (!whereResult.valid) return whereResult

  const havingResult = _validateExprList(select.having, allowed, serviceName)
  if (!havingResult.valid) return havingResult

  const orderResult = _validateExprList(select.orderBy, allowed, serviceName)
  if (!orderResult.valid) return orderResult

  return { valid: true }
}

function _validateFrom(from, allowed, serviceName) {
  if (!from) return { valid: true }

  // Simple ref: { ref: ['EntityName'] }
  if (from.ref) {
    const entity = from.ref[0]
    if (typeof entity === 'string' && !_isAllowedEntity(entity, allowed, serviceName)) {
      return { valid: false, entity }
    }
  }

  // JOIN: { join: 'inner'|'left'|..., args: [{ref}, {ref}], on: [...] }
  if (from.join && Array.isArray(from.args)) {
    for (const arg of from.args) {
      const result = _validateFrom(arg, allowed, serviceName)
      if (!result.valid) return result
    }
  }

  // SET (UNION/INTERSECT/EXCEPT): { SET: { args: [{SELECT: ...}, ...] } }
  if (from.SET && Array.isArray(from.SET.args)) {
    for (const arg of from.SET.args) {
      if (arg.SELECT) {
        const result = _validateSelect(arg.SELECT, allowed, serviceName)
        if (!result.valid) return result
      }
    }
  }

  // Inline subselect as FROM source: { SELECT: {...} }
  if (from.SELECT) {
    return _validateSelect(from.SELECT, allowed, serviceName)
  }

  return { valid: true }
}

function _validateExprList(list, allowed, serviceName) {
  if (!Array.isArray(list)) return { valid: true }

  for (const item of list) {
    if (!item || typeof item !== 'object') continue

    // Subselect expression: { SELECT: { from: ..., ... } }
    if (item.SELECT) {
      const result = _validateSelect(item.SELECT, allowed, serviceName)
      if (!result.valid) return result
    }

    // Expand on column: { ref: [...], expand: [...] }
    // Expand arrays can contain further refs with their own expand (recursive)
    if (item.expand) {
      const result = _validateExprList(item.expand, allowed, serviceName)
      if (!result.valid) return result
    }

    // Nested xpr: { xpr: [...] }
    if (item.xpr) {
      const result = _validateExprList(item.xpr, allowed, serviceName)
      if (!result.valid) return result
    }

    // Function args: { func: '...', args: [...] }
    if (item.args) {
      const result = _validateExprList(item.args, allowed, serviceName)
      if (!result.valid) return result
    }
  }

  return { valid: true }
}

module.exports = { validateCqnTargets }
