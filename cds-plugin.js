const cds = require('@sap/cds')

// Register MCP as a protocol adapter
// This allows services to be annotated with @mcp or @protocol: 'mcp'
const protocols = cds.env.protocols ??= {}
if (!protocols.mcp) {
  protocols.mcp = {
    path: '/mcp',
    impl: require.resolve('./lib')
  }
}