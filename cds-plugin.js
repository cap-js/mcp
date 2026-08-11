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
    try {
      const { path, isfile } = cds.utils
      const staticIndex = path.join(cds.root, cds.env.folders?.app || 'app/', 'index.html')
      if (isfile(staticIndex)) return next() // user-provided index.html wins
      const html = require('@sap/cds/app/index').html.replace(
        MCP_BLOCK,
        (_m, head) => `${head}\n      </div>`
      )
      return res.type('html').send(html)
    } catch (e) {
      DEBUG?.('failed to render patched welcome page:', e.message)
      return next()
    }
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
