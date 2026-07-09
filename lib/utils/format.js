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

module.exports = { formatResult }
