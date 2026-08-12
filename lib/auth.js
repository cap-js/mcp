const cds = require('@sap/cds')

function _hasRole(user, role) {
  if (role === 'any') return true
  if (role === 'authenticated-user') return !!(user && user.id !== 'anonymous')
  if (role === 'system-user') return !!(user?.is?.('system-user'))
  return !!(user?.is?.(role))
}

function _matchesToRoles(toRoles, user) {
  // No 'to' clause means 'any' pseudo-role — all users including unauthenticated
  if (!toRoles) return true
  const roles = Array.isArray(toRoles) ? toRoles : [toRoles]
  return roles.some(role => _hasRole(user, role))
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
function getAccessibleEntities(entities, user) {
  return Object.fromEntries(
    Object.entries(entities).filter(([, entity]) => checkEntityReadAccess(entity, user))
  )
}

// Check if user can execute an action/function based on @requires or @restrict
function checkActionAccess(action, user) {
  const requires = action['@requires']
  if (requires) return _matchesToRoles(requires, user)

  // @restrict on actions: grant is ignored (implicitly '*'), only 'to' applies
  const restrict = action['@restrict']
  if (restrict) {
    return restrict.some(privilege => _matchesToRoles(privilege.to, user))
  }

  return true
}

// Filter actions/functions to only those the user can execute
function getAccessibleActions(actions, user) {
  return Object.fromEntries(
    Object.entries(actions || {}).filter(([, action]) => checkActionAccess(action, user))
  )
}

// Check service and entity-level authorization
// Returns { entities, actions } on success or { error } on failure
function checkAuthorization(srv) {
  const user = cds.context?.user

  // Check service-level authorization (@requires)
  const requires = srv.definition?.['@requires']
  if (requires && !_matchesToRoles(requires, user)) {
    const code = !user || user.id === 'anonymous' ? 401 : 403
    return { error: { code, reason: 'service_authorization' } }
  }

  // Filter out composition-only autoexposed, draft, and @cds.api.ignore entities
  // Keep entities with @cds.autoexpose (e.g. CodeLists) => READ works on those
  // Remove entities with only @cds.autoexposed (composition targets) => CAP rejects direct READ
  let entities = Object.fromEntries(
    Object.entries(srv.entities || {}).filter(
      ([name, entity]) =>
        !(entity['@cds.autoexposed'] && !entity['@cds.autoexpose']) &&
        !name.endsWith('DraftAdministrativeData') &&
        !name.endsWith('.texts') &&
        !entity['@cds.api.ignore']
    )
  )

  // Filter by entity-level authorization
  entities = getAccessibleEntities(entities, user)

  // Get unbound actions/functions from srv.operations
  let actions = {}
  for (const op of srv.actions || []) {
    if ((op.kind === 'action' || op.kind === 'function') && !op['@cds.api.ignore']) {
      // Use local name (last part after dot)
      const localName = op.name.split('.').pop()
      actions[localName] = op
    }
  }

  // Filter by action-level authorization
  actions = getAccessibleActions(actions, user)

  return { entities, actions }
}

module.exports = {
  checkEntityReadAccess,
  getAccessibleEntities,
  checkActionAccess,
  getAccessibleActions,
  checkAuthorization
}
