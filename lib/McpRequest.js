const cds = require('@sap/cds')

// Tags requests dispatched by the MCP adapter with `protocol = 'mcp'`, so
// handlers can distinguish an inbound MCP call from an internal service call.
// Mirrors the OData/REST/GraphQL adapters, e.g. @cap-js/graphql's GraphQLRequest.
class McpRequest extends cds.Request {
  constructor(args) {
    super(args)
    Object.defineProperty(this, 'protocol', { value: 'mcp' })
  }
}

module.exports = McpRequest
