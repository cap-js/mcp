const cds = require('@sap/cds')
const { fs, path } = cds.utils

const LOG = cds.log('mcp')

let services = null
let purged = false

function getClients() {
  const builtIn = {}
  const clientsDir = __dirname
  for (const file of fs.readdirSync(clientsDir)) {
    if (file === 'index.js') continue
    if (!file.endsWith('.js')) continue
    const name = file.replace(/\.js$/, '')
    builtIn[name] = require(path.join(clientsDir, file))
  }

  const external = cds.env.protocols?.mcp?.clients || {}

  return { ...builtIn, ...external }
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

module.exports = { exportAll, purgeAll }
