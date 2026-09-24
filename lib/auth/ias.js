const cds = require('@sap/cds')
const express = require('express')
const router = express.Router()
const iasUrl = cds.env.requires?.auth?.credentials?.url

// --- RFC 9728: Protected Resource Metadata -------------------------------
const prmHandler = (req, res) => {
  const base = `https://${req.get('host')}`
  const suffix = req.path.replace(/^\/\.well-known\/oauth-protected-resource/, '')
  const resource = suffix ? `${base}${suffix}` : base
  const o = {
      resource,
      resource_documentation: `${base}/`,
      authorization_servers: [iasUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid']
  }

  // not yet implemented
  if (cds.env.mcp.auth.static_dcr) o.authorization_servers = [base]
  res.json(o)
}
router.get('/.well-known/oauth-protected-resource', prmHandler)
router.get('/.well-known/oauth-protected-resource/*splat', prmHandler)

module.exports = router
