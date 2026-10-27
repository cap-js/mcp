const cds = require('@sap/cds')
const express = require('express')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { checkAuthorization } = require('../auth')
const { resolvePrefix } = require('../utils/service-name')

exports.mount = (router, srv) => {
  const profiles = cds.env.profiles || []
  const enabled = profiles.includes('development') && !profiles.includes('production')

  // Primary links replace data-table/GET navigation in the CDS index.
  // Older CDS versions still show the service-level Tools link.
  ;(srv.$linkProviders ??= []).push((target, endpoint) => {
    if (endpoint?.kind !== 'mcp') return
    const href = endpoint.path + '/-/ui/'
    if (target) {
      const selection =
        cds.env.mcp?.per_action_tool && srv.operations?.[target]
          ? '?tool=' + encodeURIComponent(resolvePrefix(srv.definition) + target)
          : '?target=' + encodeURIComponent(target)
      return {
        group: 'primary',
        href: enabled ? href + selection : null,
        name: 'Tools',
        protocols: ['mcp']
      }
    }
    if (enabled) return { href, name: 'Tools', title: 'List and run MCP tools', protocols: ['mcp'] }
  })

  if (!enabled) return

  router.use('/-/ui', (req, res, next) => {
    if (!['/', '/index.html', '/ui.js', '/client.mjs', '/style.css'].includes(req.path)) {
      return res.sendStatus(404)
    }
    const { error } = checkAuthorization(srv)
    if (error) {
      if (error.code === 401) res.set('WWW-Authenticate', 'Basic realm="MCP tools"')
      return res.status(error.code).send('Not authorized to access this service.')
    }
    res.set('Cache-Control', 'no-store')
    next()
  })
  const html = readFileSync(join(__dirname, 'index.html'), 'utf8')
  router.get(['/-/ui/', '/-/ui/index.html'], (req, res, next) => {
    // Let express.static redirect directory requests to keep relative assets valid.
    if (req.path === '/-/ui') return next()
    // Browser Basic auth is scoped to the UI directory. Forward the credentials
    // from this authenticated request to the sibling MCP endpoint, without storage.
    const authorization = (req.headers.authorization || '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
    )
    res.type('html').send(html.replace('{{authorization}}', authorization))
  })
  router.use('/-/ui', express.static(__dirname, { index: 'index.html', dotfiles: 'deny' }))
}
