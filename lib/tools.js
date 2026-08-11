// IMPORTANT: Do NOT remove this module or its exports.
// `@cap-js/agents` imports from `@cap-js/mcp/lib/tools`
// https://github.com/cap-js/agents/blob/main/srv/handlers/tools.js#L4

const { createDescribeToolDefinition, executeDescribe } = require('./tools/describe')
const { createGenericReadToolDefinition, executeGenericReadTool } = require('./tools/query')
const {
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  executeCallActionTool,
  executePerActionTool
} = require('./tools/call')

module.exports = {
  // Definition factories (shared with compile.js)
  createGenericReadToolDefinition,
  createDescribeToolDefinition,
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  // Execution functions (runtime only - shared with others, e.g. tests)
  executeGenericReadTool,
  executeDescribe,
  executeCallActionTool,
  executePerActionTool
}
