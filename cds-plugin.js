const cds = require('@sap/cds')
const DEBUG = cds.debug('mcp')

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

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
