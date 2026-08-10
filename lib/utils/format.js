const cds = require('@sap/cds')

function formatAsToon(data) {
  try {
    var toon = (formatAsToon.toon ??= require('@toon-format/toon'))
  } catch {
    throw new Error(
      '@toon-format/toon is not installed.\n' +
        'Please install it with: npm add @toon-format/toon\n' +
        'Or disable TOON format with: cds.env.mcp.toon_format = false'
    )
  }
  return toon.encode(data)
}

const formatResult = cds.env.mcp?.toon_format === false ? JSON.stringify : formatAsToon

// Create MCP error response
function errorResponse(err) {
  if (typeof err === 'string') {
    return {
      content: [{ type: 'text', text: err }],
      isError: true
    }
  }
  if (err.details) {
    return {
      content: err.details.map((d) => ({
        type: 'text',
        text: `${d.message}${d.target ? ` for ${d.target}` : ''}`
      })),
      isError: true
    }
  } else {
    return {
      content: [{ type: 'text', text: `Code: ${err.status} ${err.message}` }],
      isError: true
    }
  }
}

// Format error for display — includes details when CAP groups multiple errors
function formatError(err) {
  if (err.details?.length) {
    return JSON.stringify(
      err.details.map((d) => {
        const e = { message: d.message }
        if (d.target) e.target = d.target
        return e
      })
    )
  }
  return err.message
}

module.exports = { formatResult, formatError, errorResponse }
