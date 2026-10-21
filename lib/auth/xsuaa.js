const cds = require('@sap/cds')
const express = require('express')
const crypto = require('node:crypto')
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
    scopes_supported: ['openid']
  }
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
      scopes_supported: ['openid']
    }
    if (cds.env.mcp.auth.static_dcr) o.registration_endpoint = `${base}/oauth/register`
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
router.post(
  '/oauth/token',
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
        body = {
          grant_type,
          code,
          redirect_uri,
          code_verifier,
          client_id: xsuaa.clientid,
          scope: 'openid'
        }
      } else if (grant_type === 'refresh_token') {
        const { refresh_token } = params
        if (!refresh_token) {
          return res.status(400).json({
            error: 'invalid_request',
            error_description: 'Missing refresh_token'
          })
        }
        body = { grant_type, refresh_token, client_id: xsuaa.clientid, scope: 'openid' }
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
  }
)

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
      client_name: meta.client_name,
      scope: 'openid'
    }
    res.status(201).json(o)
  })
}

module.exports = router

// --- jwt-bearer user token exchange --------------------------------------
// The browser flow mints an `openid`-only token (see /oauth/token above), so
// CAP's auth strategy builds a user with no application scopes. This middleware
// runs *after* CAP's auth (see cds-plugin.js): it exchanges the authenticated
// openid token for a full-scoped one — same user, scopes derived from the
// user's role collections — then re-runs auth to rebuild cds.context.user so
// the MCP authorization check downstream sees the application roles.
const exchangeCache = new Map()

function cacheGet(key) {
  const hit = exchangeCache.get(key)
  if (!hit) return null
  if (hit.exp <= Date.now()) {
    exchangeCache.delete(key)
    return null
  }
  return hit.token
}

const auth_mw = cds.middlewares?.auth({})
async function exchangeToken(req, res, next) {
  const user = cds.context?.user
  if (!user || user.id === 'anonymous' || user._is_anonymous) return next()

  const authz = req.headers.authorization
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : null
  if (!token) return next()

  const key = crypto.createHash('sha256').update(token).digest('base64')
  let full = cacheGet(key)
  if (!full) {
    try {
      const data = await xsuaaTokenRequestFetch({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: token,
        client_id: xsuaa.clientid
        // no `scope` → all scopes the user is entitled to for this client
      })
      full = data.access_token
      const ttl = (Math.max(0, Number(data.expires_in) || 0) - 60) * 1000
      if (full && ttl > 0) exchangeCache.set(key, { token: full, exp: Date.now() + ttl })
    } catch (err) {
      // On failure, keep the openid-scoped user; CAP's authz will then deny for
      // lack of roles rather than this middleware returning a 5xx.
      LOG.warn('token exchange failed; keeping openid-scoped user:', err.message || err)
      next()
    }
  }
  if (!full) return next()

  req.headers.authorization = `Bearer ${full}`
  await auth_mw(req, res, next)
}

router.exchangeToken = exchangeToken

/**
 * Same as {@link xsuaaTokenRequest}, but built on Node's native `fetch` instead
 * of the https client. When authenticating with an X509 client certificate
 * (mTLS), the cert/key are attached via an undici `Agent` dispatcher, since
 * `fetch` has no per-request TLS options.
 */
async function xsuaaTokenRequestFetch(body) {
  const useSecret = !!xsuaa.clientsecret
  const host = (useSecret ? xsuaa.url : xsuaa.certurl || xsuaa.url).replace(/\/$/, '')
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
    LOG.warn(
      'XSUAA token endpoint: no client secret or certificate available; request is unauthenticated'
    )
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
