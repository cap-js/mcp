const cds = require('@sap/cds')
const express = require('express')
const router = express.Router()

const LOG = cds.log('mcp-oauth')

// Bound XSUAA service credentials via CAP's config; some plans nest under `.uaa`.
const creds = cds.env.requires?.auth?.credentials
const xsuaa = (creds?.url ? creds : creds?.uaa) || {}


// --- RFC 9728: Protected Resource Metadata -------------------------------
const prmHandler = (req, res) => {
  const base = `https://${req.get('host')}`
  const suffix = req.path.replace(/^\/\.well-known\/oauth-protected-resource/, '')
  const resource = suffix ? `${base}${suffix}` : base
  const o = {
      resource,
      authorization_servers: [base],
      bearer_methods_supported: ['header'],
      resource_documentation: `${base}/`
  }
  if (cds.env.mcp.auth.xsuaa_scopes) o.scopes_supported = cds.env.mcp.auth.xsuaa_scopes
  res.json(o)
}
router.get('/.well-known/oauth-protected-resource', prmHandler)
router.get('/.well-known/oauth-protected-resource/*splat', prmHandler)

// --- RFC 8414: Authorization Server Metadata -----------------------------
// Authorize + token + register all route through THIS app: authorize is a
// passthrough, token is proxied to inject the app credential. The client is a
// public client toward the app (PKCE only, auth method "none").
const asHandler = (req, res) => {
  try {
    const base = `https://${req.get('host')}`
    const o = {
    issuer: base,
    authorization_endpoint: `${xsuaa.url}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    jwks_uri: `${xsuaa.url}/token_keys`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    }
    if (cds.env.mcp.auth.static_dcr) o.registration_endpoint = `${base}/oauth/register`
    if (cds.env.mcp.auth.xsuaa_scopes) o.scopes_supported = cds.env.mcp.auth.xsuaa_scopes
    res.json(o)
  } catch (err) {
    LOG.error('Failed to build authorization server metadata:', err.message)
    res.status(502).json({ error: 'temporarily_unavailable' })
  }
}
router.get('/.well-known/oauth-authorization-server', asHandler)
router.get('/.well-known/oauth-authorization-server/*splat', asHandler)
router.get('/.well-known/openid-configuration', asHandler)

// --- OAuth token: proxy the exchange, injecting the app credential -------
router.post('/oauth/token',
  express.urlencoded({ extended: true }),
  express.json(),
  async (req, res) => {
    const params = { ...req.query, ...req.body }
    const { grant_type } = params

    try {
      let body
      if (grant_type === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = params
        if (!code || !code_verifier) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing code or code_verifier'
          })
        }
        body = { grant_type, code, redirect_uri, code_verifier, client_id: xsuaa.clientid }
      } else if (grant_type === 'refresh_token') {
        const { refresh_token } = params
        if (!refresh_token) {
        return res.status(400).json({
          error: 'invalid_request',
          error_description: 'Missing refresh_token'
        })
      }
        body = { grant_type, refresh_token, client_id: xsuaa.clientid }
      } else {
        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Only authorization_code and refresh_token are supported'
        })
      }
      res.json(await xsuaaTokenRequestFetch(body))
    } catch (err) {
      LOG.error('token request failed:', err.message)
      res.status(400).json({ error: 'invalid_grant', error_description: err.message })
    }
  })

if (cds.env.mcp.auth.static_dcr) {
  router.post('/oauth/register', express.json({ limit: '32kb' }), (req, res) => {
    const meta = req.body || {}
    const o = {
      client_id: xsuaa.clientid,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_name: meta.client_name
    }
    if (meta.scope || cds.env.mcp.auth.xsuaa_scopes) o.scope = meta.scope || cds.env.mcp.auth.xsuaa_scopes.join(' ')
    res.status(201).json()
  })
}

module.exports = router

/**
 * Same as {@link xsuaaTokenRequest}, but built on Node's native `fetch` instead
 * of the https client. When authenticating with an X509 client certificate
 * (mTLS), the cert/key are attached via an undici `Agent` dispatcher, since
 * `fetch` has no per-request TLS options.
 */
async function xsuaaTokenRequestFetch(body) {
  const useSecret = !!xsuaa.clientsecret
  const host = (useSecret ? xsuaa.url : (xsuaa.certurl || xsuaa.url)).replace(/\/$/, '')
  const url = `${host}/oauth/token`
  const payload = new URLSearchParams(body).toString()
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json'
  }
  const options = { method: 'POST', headers, body: payload }
  if (useSecret) {
    const basic = Buffer.from(`${xsuaa.clientid}:${xsuaa.clientsecret}`).toString('base64')
    headers.Authorization = `Basic ${basic}`
  } else if (xsuaa.certificate && xsuaa.key) {
    const { Agent } = await import('undici')
    options.dispatcher = new Agent({ connect: { cert: xsuaa.certificate, key: xsuaa.key } })
  } else {
    LOG.warn('XSUAA token endpoint: no client secret or certificate available; request is unauthenticated')
  }
  const res = await fetch(url, options)
  const text = await res.text()
  if (res.ok) {
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`XSUAA token endpoint returned non-JSON: ${text.slice(0, 300)}`)
    }
  }
  throw new Error(`XSUAA token endpoint ${res.status}: ${text.slice(0, 300)}`)
}

