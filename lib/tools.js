// Barrel module: re-exports the tool APIs from the split tool modules.
// The implementation lives in ./tools/{describe,query,action}.js
// with shared helpers in ./utils/tools-shared.js

const { getInstructions } = require('./utils/tools-shared')
const {
  createDescribeToolDefinition,
  registerDescribeTool,
  executeDescribe
} = require('./tools/describe')
const {
  createGenericReadToolDefinition,
  registerGenericReadTool,
  executeGenericReadTool
} = require('./tools/query')
const {
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  registerCallActionTool,
  registerPerActionTools,
  executeCallActionTool,
  executePerActionTool
} = require('./tools/action')

module.exports = {
  // Definition factories (shared with compile.js)
  createGenericReadToolDefinition,
  createDescribeToolDefinition,
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  // Utilities (shared with compile.js)
  getInstructions,
  // Registration functions (runtime only)
  registerGenericReadTool,
  registerDescribeTool,
  registerCallActionTool,
  registerPerActionTools,
  // Execution functions (runtime only - shared with others)
  executeGenericReadTool,
  executeDescribe,
  executeCallActionTool,
  executePerActionTool
}
