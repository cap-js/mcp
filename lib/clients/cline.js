const cds = require('@sap/cds')
const os = require('os')

const { fs, path } = cds.utils

const LOG = cds.log('mcp')

function getConfigPath() {
  const platform = process.platform
  const home = os.homedir()

  if (platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  } else if (platform === 'win32') {
    return path.join(process.env.APPDATA || home, 'Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  } else {
    return path.join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  }
}

const configPath = getConfigPath()

function load() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch {
    return { mcpServers: {} }
  }
}

function store(config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

module.exports = {
  export(services, url) {
    const settingsDir = path.dirname(configPath)
    if (!fs.existsSync(settingsDir)) return

    const config = load()

    for (const srv of services) {
      const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
      if (mcpEndpoint) {
        config.mcpServers[srv.name] = {
          type: 'streamableHttp',
          url: url + mcpEndpoint.path,
          autoApprove: [],
          disabled: false
        }
      }
    }

    store(config)
    LOG.debug('Written Cline config to:', configPath)
  },

  purge(services) {
    try {
      if (!fs.existsSync(configPath)) return

      const config = load()

      for (const srv of services) {
        const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
        if (mcpEndpoint) {
          delete config.mcpServers[srv.name]
        }
      }

      store(config)
      LOG.debug('Purged MCP services from Cline config')
    } catch (err) {
      LOG.error('Failed to purge Cline config:', err.message)
    }
  }
}
