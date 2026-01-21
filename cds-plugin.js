const cds = require('@sap/cds')

// Register compile targets (cds compile -2 mcp)
require('./lib/api').registerCompileTargets()

// Register MCP as a protocol adapter
const protocols = cds.env.protocols ??= {}
if (!protocols.mcp) {
  protocols.mcp = {
    path: '/mcp',
    impl: require.resolve('./lib')
  }
}