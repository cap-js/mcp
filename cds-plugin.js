const cds = require('@sap/cds')
const DEBUG = cds.debug('mcp')

// Enable doc comments in CSN for better AI context
cds.env.cdsc = { ...cds.env.cdsc, docComment: true }

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

// Register MCP as a protocol adapter
const protocols = cds.env.protocols ??= {}
if (!protocols.mcp) {
  protocols.mcp = {
    path: '/mcp',
    impl: require.resolve('./lib'),
    clients: {}
  }
}

cds.once('listening', ({ url }) => {
  const profiles = cds.env.profiles || []
  const isDev = profiles.includes('development') && !profiles.includes('test')
  if (!isDev) return
  if (cds.env.features?.mcp_client_config === false) return

  const mcpServices = cds.service.providers.filter(srv =>
    srv.endpoints.some(ep => ep.kind === 'mcp')
  )
  if (mcpServices.length > 0) {
    DEBUG?.('registering MCP services:', mcpServices.map(srv => srv.name))
    require('./lib/clients').exportAll(mcpServices, url)
  }
})
