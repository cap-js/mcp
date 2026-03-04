const cds = require('@sap/cds')
const os = require('os')
const { fs, path } = cds.utils

const LOG = cds.log('mcp')

// --- Generic client config management ---

function createClient({ name, configPath, configKey, defaultConfig, entry, guard = 'directory' }) {

  function load() {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch (err) {
      if (err.code === 'ENOENT') return null  // File doesn't exist
      throw err  // Corrupt JSON, permission error, etc. - don't overwrite
    }
  }

  function store(config) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  }

  return {
    export(services, url) {
      const guardPath = guard === 'file' ? configPath : path.dirname(configPath)
      if (!fs.existsSync(guardPath)) return

      const config = load() ?? { ...defaultConfig }
      config[configKey] ??= {}

      for (const srv of services) {
        const ep = srv.endpoints.find(ep => ep.kind === 'mcp')
        if (ep) config[configKey][`cds:${srv.name}`] = entry(url + ep.path)
      }

      store(config)
      LOG.debug(`Written ${name} config to:`, configPath)
    },

    purge(services) {
      try {
        if (!fs.existsSync(configPath)) return

        const config = load()
        if (!config) return

        for (const srv of services) {
          const ep = srv.endpoints.find(ep => ep.kind === 'mcp')
          if (ep) delete config[configKey]?.[`cds:${srv.name}`]
        }

        store(config)
        LOG.debug(`Purged MCP services from ${name} config`)
      } catch (err) {
        LOG.error(`Failed to purge ${name} config:`, err.message)
      }
    }
  }
}

// --- Built-in client definitions ---

const home = os.homedir()

function getClineConfigPath() {
  if (process.platform === 'darwin') {
    return path.join(home, 'Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  } else if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || home, '.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  } else {
    return path.join(home, '.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json')
  }
}

const builtInClients = {
  opencode: createClient({
    name: 'OpenCode',
    configPath: path.join(home, '.config/opencode/opencode.json'),
    configKey: 'mcp',
    defaultConfig: { '$schema': 'https://opencode.ai/config.json', 'mcp': {} },
    entry: url => ({ type: 'remote', url, headers: { Authorization: 'Basic YWxpY2U6' }, enabled: true })
  }),

  claude: createClient({
    name: 'Claude',
    configPath: path.join(home, '.claude.json'),
    configKey: 'mcpServers',
    guard: 'file',
    defaultConfig: { mcpServers: {} },
    entry: url => ({ type: 'http', url, headers: { Authorization: 'Basic YWxpY2U6' } })
  }),

  cline: createClient({
    name: 'Cline',
    configPath: getClineConfigPath(),
    configKey: 'mcpServers',
    defaultConfig: { mcpServers: {} },
    entry: url => ({ type: 'streamableHttp', url, headers: { Authorization: 'Basic YWxpY2U6' }, autoApprove: [], disabled: false })
  })
}

// --- Orchestration ---

let services = null
let purged = false

function getClients() {
  const external = cds.env.protocols?.mcp?.clients || {}
  return { ...builtInClients, ...external }
}

async function exportAll(mcpServices, url) {
  services = mcpServices

  for (const [name, client] of Object.entries(getClients())) {
    if (typeof client?.export === 'function') {
      try {
        await client.export(mcpServices, url)
      } catch (err) {
        LOG.error(`Failed to export to client '${name}':`, err.message)
      }
    }
  }

  process.on('exit', purgeAll)
  cds.on('shutdown', purgeAll)
}

function purgeAll() {
  if (purged || !services) return
  purged = true

  for (const [name, client] of Object.entries(getClients())) {
    if (typeof client?.purge === 'function') {
      try {
        client.purge(services)
      } catch (err) {
        LOG.error(`Failed to purge client '${name}':`, err.message)
      }
    }
  }
}

module.exports = { exportAll }
