const cds = require('@sap/cds')
const os = require('os')

const { fs, path } = cds.utils

const LOG = cds.log('mcp')
const configPath = path.join(os.homedir(), '.claude.json')

function load() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return { mcpServers: {} }
  }
}

function store(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

module.exports = {
  export(services, url) {
    if (!fs.existsSync(configPath)) return

    const config = load()
    config.mcpServers ??= {}

    for (const srv of services) {
      const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
      if (mcpEndpoint) {
        config.mcpServers[srv.name] = {
          type: 'http',
          url: url + mcpEndpoint.path
        }
      }
    }

    store(config)
    LOG.debug('Written Claude config to:', configPath)
  },

  purge(services) {
    try {
      if (!fs.existsSync(configPath)) return

      const config = load()
      if (!config.mcpServers) return

      for (const srv of services) {
        const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
        if (mcpEndpoint) {
          delete config.mcpServers[srv.name]
        }
      }

      store(config)
      LOG.debug('Purged MCP services from Claude config')
    } catch (err) {
      LOG.error('Failed to purge Claude config:', err.message)
    }
  }
}
