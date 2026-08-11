const cds = require('@sap/cds')
const DEBUG = cds.debug('mcp')

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

cds.on('bootstrap', (app) => {
  const profiles = cds.env.profiles || []
  const isDev = profiles.includes('development') && !profiles.includes('production')
  if (!isDev) return
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

cds.once('listening', ({ url }) => {
  const profiles = cds.env.profiles || []
  const isDev = profiles.includes('development') && !profiles.includes('test')
  if (!isDev) return
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
