const cds = require('@sap/cds')
const { getDescription, parseAssertRange, resolveTypeDef } = require('./cds-to-schema')

function describeParameter(param, model, renderTypeRef, depth = 0) {
  let definition = param
  const seen = new Set()
  while (typeof definition.type === 'string' && !seen.has(definition.type)) {
    seen.add(definition.type)
    const typeDef = resolveTypeDef(definition.type, model)
    if (!typeDef) break
    definition = { ...typeDef, ...definition, type: typeDef.type }
  }

  const output = {
    type: renderTypeRef(param, model),
    notNull: definition.notNull || definition['@mandatory'] || false,
    description: getDescription(definition) || null
  }
  if (definition.enum) {
    output.enum = Object.fromEntries(
      Object.entries(definition.enum).map(([key, { val }]) => [key, val])
    )
  }
  if (definition['@assert.range']) {
    const range = parseAssertRange(definition['@assert.range'])
    output.range = range?.text || definition['@assert.range']
  }
  if (definition['@assert.format']) output.format = definition['@assert.format']

  if (depth >= (cds.env.mcp?.type_depth_limit ?? 20)) return output
  if (definition.items) {
    output.items = describeParameter(definition.items, model, renderTypeRef, depth + 1)
  } else if (definition.elements) {
    output.elements = Object.fromEntries(
      Object.entries(definition.elements).map(([name, element]) => [
        name,
        describeParameter(element, model, renderTypeRef, depth + 1)
      ])
    )
  }
  return output
}

module.exports = { describeParameter }
