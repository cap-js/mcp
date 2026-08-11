const {
  createActionInputSchema,
  createPerActionInputSchema,
  getDescription
} = require('../utils/cds-to-schema')

const {
  LOG,
  fmt,
  formatResult,
  errorResponse,
  formatError,
  buildQueryArgs,
  describeReturns
} = require('../utils/tools-shared')

function createCallActionToolDefinition(actionNames, serviceName, prefix = '') {
  const name = prefix + 'call'
  return {
    name,
    description: `Call an unbound action or function in ${serviceName} service. Use describe to discover available actions and their parameters.`,
    inputSchema: createActionInputSchema(actionNames),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false
    }
  }
}

// Per-action tool definition factory (shared with compile.js)
function createPerActionToolDefinition(actionName, action, serviceName, model, prefix = '') {
  let description = getDescription(action) || `Call ${action.kind} ${actionName} in ${serviceName}`

  // Append return type info so LLMs know without calling describe
  const returnsInfo = describeReturns(action, model)
  if (returnsInfo) {
    description += `. Returns: ${returnsInfo}`
  }

  const name = prefix + actionName
  return {
    name,
    description,
    inputSchema: createPerActionInputSchema(action, model),
    annotations: {
      readOnlyHint: action.kind === 'function',
      destructiveHint: action.kind === 'action',
      idempotentHint: action.kind === 'function',
      openWorldHint: false
    }
  }
}

// Register the call tool for invoking unbound actions/functions
function registerCallActionTool(server, srv, actions, prefix, { log = LOG } = {}) {
  const actionNames = Object.keys(actions)
  if (actionNames.length === 0) return // No actions to register

  const def = createCallActionToolDefinition(actionNames, srv.name, prefix)

  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.annotations
    },
    (args) => executeCallActionTool(srv, actions, args, { log })
  )

  log.debug('Registered tool', { tool: def.name, service: srv.name, actions: actionNames })
}

// Register individual tools per action/function
function registerPerActionTools(server, srv, actions, prefix, { log = LOG } = {}) {
  const actionEntries = Object.entries(actions)
  if (actionEntries.length === 0) {
    log.debug('No actions to register tools for', { service: srv.name })
    return
  }

  for (const [actionName, action] of actionEntries) {
    const def = createPerActionToolDefinition(actionName, action, srv.name, srv.model, prefix)

    server.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations
      },
      (args) => executePerActionTool(srv, actionName, action, args, { log })
    )

    log.debug('Registered tool', { tool: def.name, service: srv.name, kind: action.kind })
  }
}

// Execute a per-action tool (args ARE the parameters directly)
async function executePerActionTool(srv, actionName, action, args, { log = LOG } = {}) {
  log(actionName, fmt({ service: srv.name, ...buildQueryArgs(args) }))

  try {
    const result = await srv.send(actionName, args)

    const structured = {
      action: actionName,
      kind: action.kind,
      result
    }

    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    log.error(`Executing action '${actionName}' failed with: \n\n`, err)

    if (err.code === 401 || err.code === 403) {
      return errorResponse(
        `Authorization error (${err.code}): Not authorized to call ${actionName}. ${formatError(err)}`
      )
    }

    return errorResponse(`Error calling ${actionName}: ${formatError(err)}`)
  }
}

async function executeCallActionTool(srv, actions, args, { log = LOG } = {}) {
  const { action: actionName, parameters = {} } = args
  log(
    'call',
    fmt({ service: srv.name, action: actionName, parameters: buildQueryArgs(parameters) })
  )

  const action = actions[actionName]
  if (!action) {
    return errorResponse(
      `Error: Action '${actionName}' not found in service. Use describe to see available actions.`
    )
  }

  try {
    // Call the action via srv.send()
    const result = await srv.send(actionName, parameters)

    // Deep-clone result to plain objects — CAP may return typed instances
    // that TOON cannot enumerate (e.g. results from actions returning `many`)
    const plainResult = result != null ? JSON.parse(JSON.stringify(result)) : result

    const structured = {
      action: actionName,
      kind: action.kind, // 'action' or 'function'
      result: plainResult
    }

    return {
      content: [{ type: 'text', text: formatResult(structured) }],
      structuredContent: structured
    }
  } catch (err) {
    log.error(`Executing action '${actionName}' failed with: \n\n`, err)

    // Handle authorization errors
    if (err.code === 401 || err.code === 403) {
      return errorResponse(
        `Authorization error (${err.code}): Not authorized to call ${actionName}. ${formatError(err)}`
      )
    }

    return errorResponse(`Error calling ${actionName}: ${formatError(err)}`)
  }
}

module.exports = {
  createCallActionToolDefinition,
  createPerActionToolDefinition,
  registerCallActionTool,
  registerPerActionTools,
  executeCallActionTool,
  executePerActionTool
}
