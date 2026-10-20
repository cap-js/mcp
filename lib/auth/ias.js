const cds = require('@sap/cds')
const express = require('express')
const router = express.Router()
const iasUrl = cds.env.requires?.auth?.credentials?.url

// --- RFC 9728: Protected Resource Metadata -------------------------------
const prmHandler = (req, res) => {
  const base = `https://${req.get('host')}` // TODO: safer option to get own url
  const suffix = req.path.replace(/^\/\.well-known\/oauth-protected-resource/, '')
  const resource = suffix ? `${base}${suffix}` : base
  const o = {
    resource,
    authorization_servers: [iasUrl],
    scopes_supported: ['openid']
  }
  res.json(o)
}
router.get('/.well-known/oauth-protected-resource', prmHandler)
router.get('/.well-known/oauth-protected-resource/*splat', prmHandler)

module.exports = router
