const cds = require('@sap/cds')

const TARGETS = ['mcp']

function _lazyRegisterCompileTargets() {
  const value = require('./compile')
  TARGETS.forEach((target) => Object.defineProperty(this, target, { value }))
  return value
}

// Register mcp as cds.compile.to target
const registerCompileTargets = () => {
  TARGETS.forEach((target) =>
    Object.defineProperty(cds.compile.to, target, {
      get: _lazyRegisterCompileTargets,
      configurable: true
    })
  )
}

module.exports = { registerCompileTargets }
