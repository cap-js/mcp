const cds = require('@sap/cds')
const express = require('express')
const router = express.Router()

const LOG = cds.log('mcp-oauth')

const creds = cds.env.requires?.auth?.credentials
const xsuaa = (creds?.url ? creds : creds?.uaa) || {}

// RFC 9728: Protected Resource Metadata
const prmHandler = (req, res) => {
  const base = cds.env.protocols.mcp.auth.base_url
  const suffix = req.path.replace(/^\/\.well-known\/oauth-protected-resource/, '')
  const resource = suffix ? `${base}${suffix}` : base
  const o = {
    resource,
    authorization_servers: [base]
  }
  res.json(o)
}
router.get('/.well-known/oauth-protected-resource', prmHandler)
router.get('/.well-known/oauth-protected-resource/*splat', prmHandler)

// RFC 8414 — OAuth 2.0 Authorization Server Metadata
const asHandler = (req, res) => {
  try {
    const base = cds.env.protocols.mcp.auth.base_url
    const o = {
      issuer: base,
      authorization_endpoint: `${xsuaa.url}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      jwks_uri: `${xsuaa.url}/token_keys`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none']
    }
    if (cds.env.protocols.mcp.auth.static_client_registration)
      o.registration_endpoint = `${base}/oauth/register`
    res.json(o)
  } catch (err) {
    LOG.error('Failed to build authorization server metadata:', err.message)
    res.status(502).json({ error: 'temporarily_unavailable' })
  }
}
router.get('/.well-known/oauth-authorization-server', asHandler)
router.get('/.well-known/oauth-authorization-server/*splat', asHandler)
router.get('/.well-known/openid-configuration', asHandler)

if (cds.env.protocols.mcp.auth.static_client_registration) {
  /**
   * stub the dynamic client registration by simply returning the clientid
   */
  router.post('/oauth/register', express.json({ limit: '32kb' }), (req, res) => {
    const o = {
      client_id: xsuaa.clientid,
      redirect_uris: req.body?.redirect_uris || []
    }
    res.status(201).json(o)
  })
}

// OAuth token: proxy the exchange, limit to openid, injecting the app credentials
router.post(
  '/oauth/token',
  express.urlencoded({ extended: true }),
  async (req, res) => {
    const { grant_type } = req.body

    try {
      let body
      if (grant_type === 'authorization_code') {
        const { code, code_verifier, redirect_uri } = req.body
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
        const { refresh_token } = req.body
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
      res.json(await xsuaa_token_fetch(body))
    } catch (err) {
      LOG.warn(err)
      res.status(400).json({ error: 'token_fetch_failed' })
    }
  }
)

module.exports = { router, xsuaa_token_fetch }

/**
 * utility to fetch a jwt token from xsuaa
 */
async function xsuaa_token_fetch(body) {
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
  }

  const res = await fetch(url, options)
  if (res.ok) return await res.json()

  const e = new Error(`XSUAA token request failed with status ${res.status}`)
  e.reason = await res.text()
  throw e
}
