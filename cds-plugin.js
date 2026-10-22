const cds = require('@sap/cds')
const DEBUG = cds.debug('mcp')

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

const profiles = cds.env.profiles || []
const isProd = profiles.includes('production')
const isTest = profiles.includes('test')

const { FifoCache } = require('./lib/auth/fifo-cache')

!isProd &&
  cds.on('bootstrap', (app) => {
    if (cds.env.server?.index === false) return

    const MCP_BLOCK = /(<div id="[^"]+-mcp">[\s\S]*?<\/h3>)[\s\S]*?<\/ul>\s*<\/div>/g

    app.get('/', (_req, res, next) => {
      const origSend = res.send.bind(res)
      res.send = (body) => {
        if (typeof body === 'string') {
          body = body.replace(MCP_BLOCK, (_m, head) => `${head}\n      </div>`)
        }
        return origSend(body)
      }
      next()
    })
  })

!isTest &&
  !isProd &&
  cds.once('listening', ({ url }) => {
    if (cds.env.mcp?.autowire === false) return

    const mcpServices = cds.service.providers.filter((srv) =>
      srv.endpoints.some((ep) => ep.kind === 'mcp')
    )
    if (mcpServices.length > 0) {
      DEBUG?.(
        'registering MCP services:',
        mcpServices.map((srv) => srv.name)
      )
      require('./lib/clients').exportAll(mcpServices, url)
    }
  })

if (cds.env.mcp.auth && isProd) {
  cds.on('bootstrap', (app) => {
    const kind = cds.env.requires?.auth?.kind
    if (!kind) throw new Error('Unable to detect auth kind')

    const { router: auth_router, xsuaa_token_fetch } = require(`./lib/auth/${kind}`)
    app.use(auth_router)

    // Exchange the openid-scoped token for a full-scoped one, directly after
    // CAP's auth and only on MCP routes.
    if (kind === 'xsuaa' && cds.env.mcp.auth.xsuaa_exchange !== false) {
      const crypto = require('node:crypto')
      const LOG = cds.log('mcp-oauth')
      const mcpPath = cds.env.protocols?.mcp?.path || '/mcp'
      const creds = cds.env.requires?.auth?.credentials
      const xsuaa = (creds?.url ? creds : creds?.uaa) || {}
      const auth_mw = cds.middlewares.auth({})
      const exchangeCache = new FifoCache(1000)

      async function exchange_for_mcp(req, res, next) {
        if (!req.baseUrl?.startsWith(mcpPath)) return next()
        const user = cds.context?.user
        if (!user || user.id === 'anonymous' || user._is_anonymous) return next()

        const authz = req.headers.authorization
        const token = authz?.startsWith('Bearer ') ? authz.slice(7) : null
        if (!token) return next()

        const key = crypto.createHash('sha256').update(token).digest('base64')
        let full = exchangeCache.get(key)
        if (!full) {
          try {
            const data = await xsuaa_token_fetch({
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion: token,
              client_id: xsuaa.clientid
              // no `scope` → all scopes the user is entitled to for this client
            })
            full = data.access_token
            const ttl = (Number(data.expires_in) - 60 * 10) * 1000
            if (full && ttl > 0) exchangeCache.set(key, full, Date.now() + ttl)
          } catch (err) {
            err.message = `xsuaa exchange failed: ${err.message}`
            LOG.warn(err)
            next()
          }
        }
        if (!full) return next()

        req.headers.authorization = `Bearer ${full}`
        await auth_mw(req, res, next)
      }
      cds.middlewares.add(exchange_for_mcp, { after: 'auth' })
    }

    cds.middlewares.after.splice(0, 0, (err, req, res, next) => {
      req._login = () => {
        const base = `https://${req.get('host')}`
        const resourcePath = req.baseUrl
        const prm = `${base}/.well-known/oauth-protected-resource${resourcePath}`
        res.set('WWW-Authenticate', `Bearer resource_metadata="${prm}", error="invalid_token"`)
      }
      next(err)
    })
  })
}
