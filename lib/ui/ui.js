import { McpClient } from './client.mjs'

const $ = (id) => document.getElementById(id)
const endpoint = new URL('../../', location.href)
const auth = document.querySelector('meta[name="mcp-authorization"]')
const client = new McpClient(endpoint.href, undefined, auth?.content || '')
auth?.remove()
const drafts = new Map()
let tools = []
let selected
let busy = false

$('endpoint').textContent = endpoint.pathname

function status(message, error = false) {
  $('status').textContent = message
  $('status').dataset.error = String(error)
}

function setBusy(value) {
  busy = value
  $('reload').disabled = value
  $('run').disabled = value
  renderTools()
}

function renderTools() {
  const filter = $('search').value.toLowerCase()
  $('tools').replaceChildren()
  for (const tool of tools) {
    if (!(tool.name + ' ' + (tool.description || '')).toLowerCase().includes(filter)) continue
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = tool.title || tool.name
    button.title = tool.description || tool.name
    button.disabled = busy
    button.setAttribute('aria-pressed', String(tool === selected))
    button.addEventListener('click', () => select(tool))
    li.append(button)
    $('tools').append(li)
  }
}

function initialArguments(schema) {
  const args = {}
  for (const [name, property] of Object.entries(schema?.properties || {})) {
    if (Object.hasOwn(property, 'default')) args[name] = property.default
    else if (schema.required?.includes(name)) {
      args[name] =
        property.enum?.[0] ??
        { string: '', number: 0, integer: 0, boolean: false, array: [], object: {} }[
          property.type
        ] ??
        null
    }
  }
  return args
}

function select(tool, args) {
  if (selected) drafts.set(selected.name, $('arguments').value)
  selected = tool
  $('runner').hidden = !tool
  if (!tool) return
  $('name').textContent = tool.name
  $('description').textContent = tool.description || ''
  $('schema').textContent = JSON.stringify(tool.inputSchema, null, 2)
  $('arguments').value = args
    ? JSON.stringify(args, null, 2)
    : drafts.get(tool.name) || JSON.stringify(initialArguments(tool.inputSchema), null, 2)
  $('result').textContent = 'Run the tool to see its result.'
  $('result').dataset.error = 'false'
  renderTools()
}

function selectFromLink() {
  const params = new URLSearchParams(location.search)
  const name = params.get('tool')
  const target = params.get('target')
  const named = tools.find((tool) => tool.name === name)
  if (named) {
    select(named)
    return true
  }
  if (target) {
    const call = tools.find((tool) => tool.inputSchema?.properties?.action?.enum?.includes(target))
    if (call) {
      select(call, { action: target, parameters: {} })
      return true
    }
    const action = tools.find((tool) => tool.name === target || tool.name.endsWith('-' + target))
    if (action) {
      select(action)
      return true
    }
    const describe = tools.find((tool) =>
      tool.inputSchema?.properties?.entities?.items?.enum?.includes(target)
    )
    if (describe) {
      select(describe, { entities: [target] })
      return true
    }
  }
  if (name || target) {
    select(undefined)
    return false
  }
  select(tools.find((tool) => tool.name === selected?.name) || tools[0])
  return true
}

async function load() {
  setBusy(true)
  status('Connecting…')
  try {
    const info = await client.initialize()
    tools = await client.listTools()
    document.title = info.serverInfo.name + ' · MCP Tools'
    const found = selectFromLink()
    if (!found && tools.length) {
      status('The requested tool or target is not available for the current user.', true)
      return
    }
    status(
      tools.length
        ? tools.length + ' tools available in ' + info.serverInfo.name + '.'
        : 'No tools available for the current user.'
    )
  } catch (error) {
    tools = []
    select(undefined)
    status(error.message, true)
  } finally {
    setBusy(false)
  }
}

$('search').addEventListener('input', renderTools)
$('reload').addEventListener('click', load)
$('form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!selected || busy) return
  let args
  try {
    args = JSON.parse($('arguments').value)
    if (!args || typeof args !== 'object' || Array.isArray(args))
      throw new Error('Arguments must be a JSON object.')
  } catch (error) {
    status('Invalid arguments: ' + error.message, true)
    $('arguments').focus()
    return
  }
  setBusy(true)
  status('Running ' + selected.name + '…')
  $('result').textContent = 'Running…'
  try {
    const result = await client.callTool(selected.name, args)
    $('result').textContent = result.structuredContent
      ? JSON.stringify(result.structuredContent, null, 2)
      : result.content
          ?.map((content) =>
            content.type === 'text' ? content.text : JSON.stringify(content, null, 2)
          )
          .join('\n\n') || JSON.stringify(result, null, 2)
    $('result').dataset.error = String(!!result.isError)
    status(result.isError ? 'The tool returned an error.' : 'Tool completed.', !!result.isError)
  } catch (error) {
    $('result').textContent = error.message
    $('result').dataset.error = 'true'
    status(error.message, true)
  } finally {
    setBusy(false)
  }
})

load()
