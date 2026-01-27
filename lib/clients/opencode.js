const cds = require('@sap/cds')
const os = require('os')

const { fs, path } = cds.utils

const LOG = cds.log('mcp')
const CONFIG_PATH = '.config/opencode/opencode.json'
const configPath = path.join(os.homedir(), CONFIG_PATH)

function load() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return { "$schema": "https://opencode.ai/config.json", "mcp": {} }
  }
}

function store(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

module.exports = {
  export(services, url) {
    if (!fs.existsSync(configPath)) return

    const config = load()

    for (const srv of services) {
      const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
      if (mcpEndpoint) {
        config.mcp[srv.name] = {
          type: 'remote',
          url: url + mcpEndpoint.path,
          enabled: true
        }
      }
    }

    store(config)
    LOG.debug('Written OpenCode config to:', configPath)
  },

  purge(services) {
    try {
      if (!fs.existsSync(configPath)) return

      const config = load()

      for (const srv of services) {
        const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
        if (mcpEndpoint) {
          delete config.mcp[srv.name]
        }
      }

      store(config)
      LOG.debug('Purged MCP services from OpenCode config')
    } catch (err) {
      LOG.error('Failed to purge OpenCode config:', err.message)
    }
  }
}
