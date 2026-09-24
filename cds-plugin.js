const cds = require('@sap/cds')
const DEBUG = cds.debug('mcp')

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

const profiles = cds.env.profiles || []
const isProd = profiles.includes('production')
const isTest = profiles.includes('test')

!isProd && cds.on('bootstrap', (app) => {
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

!isTest && !isProd && cds.once('listening', ({ url }) => {
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

if (cds.env.mcp.auth !== false) {
  isProd && cds.on('bootstrap', (app) => {
    const kind = cds.env.requires?.auth?.kind
    if (!kind) throw new Error('Unable to detect auth kind')
  
    const auth_router = require(`./lib/auth/${kind}`)
    app.use(auth_router)

    cds.middlewares.after.splice(0,0,(err,req,res,next) => {
      req._login = () => {
        const base = `https://${req.get('host')}`
        const resourcePath = req.baseUrl
        const prm = `${base}/.well-known/oauth-protected-resource${resourcePath}`
        res.set(
            'WWW-Authenticate',
            `Bearer resource_metadata="${prm}", error="invalid_token"`
        )
      }
      next(err)
    })
  })
}

