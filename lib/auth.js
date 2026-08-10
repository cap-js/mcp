const cds = require('@sap/cds')
const { exposeDraftEntities } = require('./draft')

function checkEntityReadAccess(entity, user) {
  const restrict = entity['@restrict']
  if (!restrict) return true

  for (const privilege of restrict) {
    const grants = Array.isArray(privilege.grant) ? privilege.grant : [privilege.grant]
    if (!grants.includes('READ') && !grants.includes('*')) continue

    const toRoles = privilege.to
    if (!toRoles) {
      if (user && user.id !== 'anonymous') return true
      continue
    }

    const roles = Array.isArray(toRoles) ? toRoles : [toRoles]
    for (const role of roles) {
      if (role === 'any') return true
      if (role === 'authenticated-user') {
        if (user && user.id !== 'anonymous') return true
        continue
      }
      if (user?.is?.(role)) return true
    }
  }
  return false
}

// Filter entities to only those the user can READ
function getAccessibleEntities(entities, user) {
  return Object.fromEntries(
    Object.entries(entities).filter(([, entity]) => checkEntityReadAccess(entity, user))
  )
}

// Check if user can execute an action/function based on @requires
function checkActionAccess(action, user) {
  const requires = action['@requires']
  if (!requires) return true

  const roles = Array.isArray(requires) ? requires : [requires]
  for (const role of roles) {
    if (role === 'any') return true
    if (role === 'authenticated-user') {
      if (user && user.id !== 'anonymous') return true
      continue
    }
    if (user?.is?.(role)) return true
  }
  return false
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
  if (requires) {
    const roles = Array.isArray(requires) ? requires : [requires]
    let serviceAuthorized = false

    for (const role of roles) {
      if (role === 'any') {
        serviceAuthorized = true
        break
      }
      if (role === 'authenticated-user') {
        if (user && user.id !== 'anonymous') {
          serviceAuthorized = true
          break
        }
        continue
      }
      if (user?.is?.(role)) {
        serviceAuthorized = true
        break
      }
    }

    if (!serviceAuthorized) {
      const code = !user || user.id === 'anonymous' ? 401 : 403
      return { error: { code, reason: 'service_authorization' } }
    }
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

  // Expose .drafts entities for draft-enabled entities
  exposeDraftEntities(entities)

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
