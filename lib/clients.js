const cds = require('@sap/cds')
const { fs, path } = cds.utils

const LOG = cds.log('mcp')

// --- Generic client config management ---

class Client {

  constructor ({ name, configPath, configKey, defaultConfig, entry, guard = 'directory' }) {
    this.name = name
    this.configPath = configPath
    this.configKey = configKey
    this.defaultConfig = defaultConfig
    this.entry = entry
    this.guard = guard
  }

  export(services, url) {
    const guardPath = this.guard === 'file' ? this.configPath : path.dirname(this.configPath)
    if (!fs.existsSync(guardPath)) return

    const config = this.load() ?? { ...this.defaultConfig }
    config[this.configKey] ??= {}

    for (const srv of services) {
      const ep = srv.endpoints.find((ep) => ep.kind === 'mcp')
      if (ep) config[this.configKey][`cds:${srv.name}`] = this.entry(url + ep.path)
    }

    this.store(config)
    LOG.debug(`Written ${this.name} config to:`, this.configPath)
  }

  purge(services) {
    if (!fs.existsSync(this.configPath)) return

    const config = this.load()
    if (!config) return

    for (const srv of services) {
      const ep = srv.endpoints.find((ep) => ep.kind === 'mcp')
      if (ep) delete config[this.configKey]?.[`cds:${srv.name}`]
    }

    this.store(config)
    LOG.debug(`Purged MCP services from ${this.name} config`)
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
    } catch (err) {
      if (err.code === 'ENOENT') return null // File doesn't exist
      throw new cds.error (`Failed to load config from ${this.configPath}: ${err.message}`, {
        source: this.configPath,
        cause: err
      })
    }
  }

  store(config) {
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2))
  }
}


// --- Built-in client definitions ---

const os = require('os')
const home = os.homedir()

function authHeader() {
  const { user, password } = cds.env.mcp?.autowire ?? {}
  const credentials = `${user ?? 'alice'}:${password ?? ''}`
  return 'Basic ' + Buffer.from(credentials).toString('base64')
}

const clients = {

  opencode: new Client({
    name: 'OpenCode',
    configPath: path.join(home, '.config/opencode/opencode.json'),
    configKey: 'mcp',
    defaultConfig: { $schema: 'https://opencode.ai/config.json', mcp: {} },
    entry: (url) => ({
      type: 'remote',
      url,
      headers: { Authorization: authHeader() },
      enabled: true
    }),
    guard: 'directory',
  }),

  claude: new Client({
    name: 'Claude',
    configPath: path.join(home, '.claude.json'),
    configKey: 'mcpServers',
    guard: 'file',
    defaultConfig: { mcpServers: {} },
    entry: (url) => ({
      type: 'http',
      url,
      headers: { Authorization: authHeader() }
    })
  }),

  ... Object.fromEntries(Object.entries(
    cds.env.protocols?.mcp?.clients ?? {}
  ).map(([key, value]) => [key, new Client(value)]))

}

// --- Orchestration ---


function exportAll(services, url) {

  if (!services) return
  Object.values(clients).map(each => each.export(services, url))
  process.on('exit', purgeAll)
  cds.on('shutdown', purgeAll)

  function purgeAll() {
    if (purgeAll.done) return; else purgeAll.done = true
    Object.values(clients).map(each => each.purge(services))
  }
}


module.exports = { exportAll }
