const cds = require('@sap/cds')
const { getFilteredEntities } = require('./utils/tools-shared.js')

function _hasRole(user, role) {
  if (role === 'any') return true
  if (role === 'authenticated-user') return !!(user && user.id !== 'anonymous')
  if (role === 'system-user') return !!user?.is?.('system-user')
  return !!user?.is?.(role)
}

function _matchesToRoles(toRoles, user) {
  // No 'to' clause means 'any' pseudo-role — all users including unauthenticated
  if (!toRoles) return true
  const roles = Array.isArray(toRoles) ? toRoles : [toRoles]
  return roles.some((role) => _hasRole(user, role))
}

// Service-level authorization aligned with CAP's HTTP protocol adapter
//   - @requires on service: normalize to role array
//   - @restrict on service: collect all 'to' roles across privileges
//   - if that yields zero roles, fall through to env fallback:
//       NODE_ENV === 'production' && cds.env.requires.auth.restrict_all_services !== false
//         → ['authenticated-user']
//       otherwise                 → no gate (public)
function checkServiceAccess(srv, user) {
  const def = srv?.definition || srv
  const requires = def?.['@requires']
  const restrict = def?.['@restrict']

  let declaredRoles
  if (requires != null) {
    declaredRoles = Array.isArray(requires) ? requires : [requires]
  } else if (restrict != null) {
    declaredRoles = restrict
      .map((r) => r.to)
      .flat()
      .filter(Boolean)
  }

  const roles = declaredRoles?.length
    ? declaredRoles
    : process.env.NODE_ENV === 'production' &&
        cds.env.requires?.auth?.restrict_all_services !== false
      ? ['authenticated-user']
      : null

  if (!roles) return { ok: true }
  if (roles.some((role) => _hasRole(user, role))) return { ok: true }

  const anonymous = !user || user.id === 'anonymous' || user._is_anonymous
  return { ok: false, code: anonymous ? 401 : 403 }
}

function checkEntityReadAccess(entity, user) {
  // @requires on entity is shorthand for @restrict: [{ grant: '*', to: <roles> }]
  const requires = entity['@requires']
  if (requires) return _matchesToRoles(requires, user)

  const restrict = entity['@restrict']
  if (!restrict) return true

  for (const privilege of restrict) {
    const grants = Array.isArray(privilege.grant) ? privilege.grant : [privilege.grant]
    if (!grants.includes('READ') && !grants.includes('*')) continue
    if (_matchesToRoles(privilege.to, user)) return true
  }
  return false
}

// Filter entities to only those the user can READ
// Filter by entity-level authorization
function getAccessibleEntities(srv, user) {
  const entities = getFilteredEntities(srv)
  const filtered = { ...entities }
  for (let each in entities) !function _check (name, is_root_entity) {
    const entity = entities [name]; if (!entity) return
    if (is_root_entity && checkEntityReadAccess(entity, user)) return // has access
    else delete filtered[name]
    for (let el in entity.elements) {
      let e = entity.elements[el]
      if (e.isComposition) _check (e.target.slice(srv.name.length+1))
    }
  } (each, true)
  return filtered
}

// Check if user can execute an action/function based on @requires or @restrict
function checkActionAccess(action, user) {
  const requires = action['@requires']
  if (requires) return _matchesToRoles(requires, user)

  // @restrict on actions: grant is ignored (implicitly '*'), only 'to' applies
  const restrict = action['@restrict']
  if (restrict) {
    return restrict.some((privilege) => _matchesToRoles(privilege.to, user))
  }

  return true
}

// Filter actions/functions to only those the user can execute
// Filter by action-level authorization
function getAccessibleActions(srv, user) {
  const actions = {}; if (!srv.actions) return actions
  for (const op of srv.actions) {
    if (op['@cds.api.ignore']) continue
    if (!checkActionAccess(op, user)) continue
    actions[op.name.slice(srv.name.length+1)] = op // use local name
  }
  return actions
}

// Check service and entity-level authorization
// Returns { entities, actions } on success or { error } on failure
exports.checkAuthorization = function(srv) {
  const user = cds.context?.user

  const serviceCheck = checkServiceAccess(srv, user)
  if (!serviceCheck.ok) {
    return { error: { code: serviceCheck.code, reason: 'service_authorization' } }
  }

  const entities = getAccessibleEntities(srv, user)
  const actions = getAccessibleActions(srv, user)
  return { entities, actions }
}
