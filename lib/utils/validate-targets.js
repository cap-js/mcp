/**
 * Unified CQN validation for MCP query tool. Enforces:
 *   1. Entity refs in FROM/JOIN/UNION/subselect must be accessible.
 *   2. Function calls must be in the CAP-advertised allowlist (blocks CURRENT_USER etc.).
 *   3. Bare refs must not be DB pseudo-columns (CURRENT_SCHEMA etc.).
 *   4. Expand target entities must be accessible (blocks privilege escalation).
 *
 * @param {object} cqn - CQN object with .SELECT
 * @param {object} opts { allowedEntities, serviceName, definitions?, rootEntity? }
 * @returns {{ valid, entity?, reason? }}
 */
function validateCqnTargets(cqn, opts, serviceNameLegacy) {
  // Back-compat: (cqn, allowedEntities, serviceName)
  let allowedEntities, serviceName, definitions, rootEntity
  if (opts instanceof Set || Array.isArray(opts)) {
    allowedEntities = opts
    serviceName = serviceNameLegacy
  } else {
    allowedEntities = opts.allowedEntities
    serviceName = opts.serviceName
    definitions = opts.definitions
    rootEntity = opts.rootEntity
  }

  const allowed =
    allowedEntities instanceof Set
      ? allowedEntities
      : Array.isArray(allowedEntities)
        ? new Set(allowedEntities)
        : new Set(Object.keys(allowedEntities || {}))

  return _validateSelect(cqn.SELECT, allowed, serviceName, definitions, rootEntity)
}

// CAP-advertised function allowlist (case-insensitive).
// Sources: OData strict list, standardDatabaseFunctions.js, CQL parser pseudo-funcs.
// Excludes current_user, session_user, sysuuid — leak DB identity.
const ALLOWED_FUNCTIONS = new Set([
  // Aggregates
  'count',
  'countdistinct',
  'sum',
  'avg',
  'average',
  'min',
  'max',
  // String search
  'concat',
  'contains',
  'endswith',
  'indexof',
  'length',
  'startswith',
  'substring',
  'matchespattern',
  // String manipulation
  'tolower',
  'toupper',
  'trim',
  'lower',
  'upper',
  // Date/Time parts
  'date',
  'day',
  'fractionalseconds',
  'hour',
  'maxdatetime',
  'mindatetime',
  'minute',
  'month',
  'second',
  'time',
  'totaloffsetminutes',
  'totalseconds',
  'year',
  // Server date/time (safe)
  'now',
  'current_date',
  'current_time',
  'current_timestamp',
  'current_utcdate',
  'current_utctime',
  'current_utctimestamp',
  // Arithmetic
  'ceiling',
  'floor',
  'round',
  'ceil',
  'abs',
  'mod',
  'power',
  'sqrt',
  // Conditional / null handling
  'case',
  'coalesce',
  'nullif',
  'cast',
  // HANA temporal diff (CAP-advertised)
  'nano100_between',
  'seconds_between',
  'days_between',
  'months_between',
  'years_between'
])

// DB pseudo-columns that parse as bare refs `{ref: ['NAME']}` (case-insensitive)
const DENIED_REFS = new Set([
  'current_schema',
  'current_database',
  'current_connection',
  'current_transaction_isolation_level',
  'session_user',
  'current_user'
])

function _isAllowedEntity(entity, allowed, serviceName) {
  if (allowed.has(entity)) return true
  if (serviceName && entity.startsWith(serviceName + '.')) {
    const localName = entity.slice(serviceName.length + 1)
    if (allowed.has(localName)) return true
  }
  return false
}

function _validateSelect(select, allowed, serviceName, definitions, rootEntity) {
  if (!select) return { valid: true }

  const fromResult = _validateFrom(select.from, allowed, serviceName, definitions)
  if (!fromResult.valid) return fromResult

  // Root entity for expand validation (explicit override or resolved from FROM)
  const contextEntity = rootEntity ?? _resolveFromEntity(select.from, definitions, serviceName)

  const colResult = _validateExprList(
    select.columns,
    allowed,
    serviceName,
    definitions,
    contextEntity
  )
  if (!colResult.valid) return colResult

  const whereResult = _validateExprList(
    select.where,
    allowed,
    serviceName,
    definitions,
    contextEntity
  )
  if (!whereResult.valid) return whereResult

  const havingResult = _validateExprList(
    select.having,
    allowed,
    serviceName,
    definitions,
    contextEntity
  )
  if (!havingResult.valid) return havingResult

  const orderResult = _validateExprList(
    select.orderBy,
    allowed,
    serviceName,
    definitions,
    contextEntity
  )
  if (!orderResult.valid) return orderResult

  return { valid: true }
}

function _resolveFromEntity(from, definitions, serviceName) {
  if (!from || !definitions) return null
  if (Array.isArray(from.ref) && typeof from.ref[0] === 'string') {
    const name = from.ref[0]
    return definitions[name] ?? (serviceName ? definitions[`${serviceName}.${name}`] : null)
  }
  return null
}

function _validateFrom(from, allowed, serviceName, definitions) {
  if (!from) return { valid: true }

  if (from.ref) {
    const entity = from.ref[0]
    if (typeof entity === 'string' && !_isAllowedEntity(entity, allowed, serviceName)) {
      return { valid: false, entity }
    }
  }

  if (from.join && Array.isArray(from.args)) {
    for (const arg of from.args) {
      const result = _validateFrom(arg, allowed, serviceName, definitions)
      if (!result.valid) return result
    }
  }

  if (from.SET && Array.isArray(from.SET.args)) {
    for (const arg of from.SET.args) {
      if (arg.SELECT) {
        const result = _validateSelect(arg.SELECT, allowed, serviceName, definitions)
        if (!result.valid) return result
      }
    }
  }

  if (from.SELECT) {
    return _validateSelect(from.SELECT, allowed, serviceName, definitions)
  }

  return { valid: true }
}

function _validateExprList(list, allowed, serviceName, definitions, contextEntity) {
  if (!Array.isArray(list)) return { valid: true }

  for (const item of list) {
    if (!item || typeof item !== 'object') continue

    // Function allowlist
    if (typeof item.func === 'string') {
      const fn = item.func.toLowerCase()
      if (!ALLOWED_FUNCTIONS.has(fn)) {
        return { valid: false, entity: `function '${item.func}'`, reason: 'function-not-allowed' }
      }
    }

    // Pseudo-column denylist (bare single-segment ref)
    if (Array.isArray(item.ref) && item.ref.length === 1 && typeof item.ref[0] === 'string') {
      if (DENIED_REFS.has(item.ref[0].toLowerCase())) {
        return { valid: false, entity: item.ref[0], reason: 'pseudo-column-not-allowed' }
      }
    }

    // Expand: if context available, check target accessibility; else recurse for general checks
    if (Array.isArray(item.expand)) {
      if (contextEntity) {
        const expandCheck = _validateExpand(item, contextEntity, allowed, serviceName, definitions)
        if (!expandCheck.valid) return expandCheck
      } else {
        const result = _validateExprList(item.expand, allowed, serviceName, definitions, null)
        if (!result.valid) return result
      }
    }

    if (item.SELECT) {
      const result = _validateSelect(item.SELECT, allowed, serviceName, definitions)
      if (!result.valid) return result
    }

    if (item.xpr) {
      const result = _validateExprList(item.xpr, allowed, serviceName, definitions, contextEntity)
      if (!result.valid) return result
    }

    if (item.args) {
      if (Array.isArray(item.args)) {
        const result = _validateExprList(
          item.args,
          allowed,
          serviceName,
          definitions,
          contextEntity
        )
        if (!result.valid) return result
      } else if (typeof item.args === 'object') {
        const result = _validateExprList(
          Object.values(item.args),
          allowed,
          serviceName,
          definitions,
          contextEntity
        )
        if (!result.valid) return result
      }
    }
  }

  return { valid: true }
}

// Walk expand ref path, resolving each assoc step; target must be in allowed. Recurses.
function _validateExpand(item, contextEntity, allowed, serviceName, definitions) {
  if (!Array.isArray(item.ref) || item.ref.length === 0) return { valid: true }

  let targetEntity = contextEntity
  let targetName = null
  for (const seg of item.ref) {
    const name = typeof seg === 'string' ? seg : seg?.id
    if (!name || !targetEntity?.elements?.[name]) return { valid: true } // field validation handles
    const element = targetEntity.elements[name]
    if (!element.target) return { valid: true } // not assoc — field validation handles
    targetName = element.target
    targetEntity = definitions?.[targetName]
    if (!targetEntity) return { valid: true }
  }

  if (!_isAllowedEntity(targetName, allowed, serviceName)) {
    return {
      valid: false,
      entity: item.ref.join('.'),
      reason: 'expand-not-allowed'
    }
  }

  // Recurse into nested expand items
  for (const sub of item.expand) {
    if (!sub || typeof sub !== 'object' || sub === '*') continue
    const check = _validateExprList([sub], allowed, serviceName, definitions, targetEntity)
    if (!check.valid) return check
  }

  return { valid: true }
}

module.exports = { validateCqnTargets, ALLOWED_FUNCTIONS, DENIED_REFS }
