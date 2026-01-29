const cds = require('@sap/cds')

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
    Object.entries(entities).filter(([, entity]) =>
      checkEntityReadAccess(entity, user)
    )
  )
}

// Check service and entity-level authorization
// Returns { entities } on success or { error } on failure
function checkAuthorization(srv) {
  const user = cds.context?.user

  // Check service-level authorization (@requires)
  const requires = srv.definition?.['@requires']
  if (requires) {
    const roles = Array.isArray(requires) ? requires : [requires]
    let serviceAuthorized = false

    for (const role of roles) {
      if (role === 'any') { serviceAuthorized = true; break }
      if (role === 'authenticated-user') {
        if (user && user.id !== 'anonymous') { serviceAuthorized = true; break }
        continue
      }
      if (user?.is?.(role)) { serviceAuthorized = true; break }
    }

    if (!serviceAuthorized) {
      const code = (!user || user.id === 'anonymous') ? 401 : 403
      return { error: { code, reason: 'service_authorization' } }
    }
  }

  // Filter out auto-exposed and draft entities
  let entities = Object.fromEntries(
    Object.entries(srv.entities || {})
      .filter(([name, entity]) => !entity['@cds.autoexposed'] && !name.endsWith('DraftAdministrativeData'))
  )

  // Filter by entity-level authorization
  entities = getAccessibleEntities(entities, user)

  // No accessible entities = authorization error
  if (Object.keys(entities).length === 0) {
    const code = (!user || user.id === 'anonymous') ? 401 : 403
    return { error: { code, reason: 'no_accessible_entities' } }
  }

  return { entities }
}

module.exports = {
  checkEntityReadAccess,
  getAccessibleEntities,
  checkAuthorization
}
