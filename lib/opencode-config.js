const cds = require('@sap/cds')
const fs = require('fs')
const path = require('path')
const os = require('os')

const LOG = cds.log('mcp')
const CONFIG_PATH = '.config/opencode/opencode.json'

class OpenCodeConfig {
  #configPath

  get configPath() {
    if (!this.#configPath) {
      this.#configPath = path.join(os.homedir(), CONFIG_PATH)
    }
    return this.#configPath
  }

  async load(read = fs.promises.readFile) {
    try {
      const content = await read(this.configPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {
        "$schema": "https://opencode.ai/config.json",
        "mcp": {}
      }
    }
  }

  loadSync(read = fs.readFileSync) {
    try {
      const content = read(this.configPath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return {
        "$schema": "https://opencode.ai/config.json",
        "mcp": {}
      }
    }
  }

  async store(config, write = fs.promises.writeFile) {
    const dir = path.dirname(this.configPath)
    await fs.promises.mkdir(dir, { recursive: true })
    const json = JSON.stringify(config, null, 2)
    return write(this.configPath, json)
  }

  storeSync(config, write = fs.writeFileSync) {
    const dir = path.dirname(this.configPath)
    fs.mkdirSync(dir, { recursive: true })
    const json = JSON.stringify(config, null, 2)
    return write(this.configPath, json)
  }

  async export(services, url) {
    const config = await this.load()

    for (const srv of services) {
      const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
      if (mcpEndpoint) {
        const serviceName = srv.name
        config.mcp[serviceName] = {
          type: 'remote',
          url: url + mcpEndpoint.path,
          enabled: true
        }
        LOG.debug('Registered MCP service in OpenCode config:', { service: serviceName, url: url + mcpEndpoint.path })
      }
    }

    await this.store(config)
    LOG('Written OpenCode config to:', this.configPath)

    process.on('exit', () => this.purge(services))
    cds.on('shutdown', () => this.purge(services))

    return config
  }

  purge(services) {
    if (this.done) return
    this.done = true

    try {
      const config = this.loadSync()

      for (const srv of services) {
        const mcpEndpoint = srv.endpoints.find(ep => ep.kind === 'mcp')
        if (mcpEndpoint) {
          const serviceName = srv.name
          delete config.mcp[serviceName]
        }
      }

      this.storeSync(config)
      LOG.debug('Purged MCP services from OpenCode config')
    } catch (err) {
      LOG.error('Failed to purge OpenCode config:', err.message)
    }
  }
}

module.exports = new OpenCodeConfig()
