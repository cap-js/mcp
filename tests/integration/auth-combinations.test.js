/**
 * Comprehensive authorization tests for @requires and @restrict annotation combinations.
 *
 * Each test verifies both MCP (tools/list entity enum + query access) and OData (HTTP GET)
 * to confirm the two surfaces enforce permissions identically.
 *
 * Users:
 *   alice   — roles: [admin]         (CDS built-in)
 *   eve     — roles: [editor]        (added in bookshop/package.json)
 *   viewer  — roles: [viewer]        (added in bookshop/package.json — no matching role)
 *   bob     — roles: []              (CDS built-in — no relevant roles)
 *   <none>  — unauthenticated
 */
const cds = require('@sap/cds')
cds.env.mcp ??= {}
cds.env.mcp.format = 'cqn'
// Add users with roles not present in the CDS default mock users
cds.env.requires ??= {}
cds.env.requires.auth ??= {}
cds.env.requires.auth.users ??= {}
cds.env.requires.auth.users.eve = { roles: ['editor'] }
cds.env.requires.auth.users.viewer = { roles: ['viewer'] }
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

const MCP = '/mcp/auth-test'
const ODATA = '/odata/v4/auth-test'

// Helper: MCP entity enum from tools/list
async function getMcpEntityEnum(auth) {
  const { mcp } = mcpClient(MCP, auth)
  const res = await mcp('tools/list')
  const queryTool = res.result?.tools?.find((t) => t.name === 'query')
  return queryTool?.inputSchema?.properties?.entity?.enum ?? []
}

// Helper: MCP action enum from tools/list
async function getMcpActionEnum(auth) {
  const { mcp } = mcpClient(MCP, auth)
  const res = await mcp('tools/list')
  const callTool = res.result?.tools?.find((t) => t.name === 'call')
  return callTool?.inputSchema?.properties?.action?.enum ?? null // null = no call tool
}

// Helper: OData GET — returns HTTP status
async function odataGet(entity, auth) {
  const headers = { Accept: 'application/json' }
  if (auth) headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
  const res = await fetch(`${test.url}${ODATA}/${entity}`, { headers })
  return res.status
}

// Helper: MCP query — returns null on success, error string on failure
async function mcpQuery(entity, auth) {
  const { callTool } = mcpClient(MCP, auth)
  const { error } = await callTool('query', { entity })
  return error
}

// Helper: MCP CQL query — issues SELECT from entity, returns null on success, error string on failure
// Used to verify auth is enforced at query-time even when the entity is not in the enum
async function mcpCqlQuery(entity, auth) {
  const { callTool } = mcpClient(MCP, auth)
  const { error } = await callTool('query', { cql: `SELECT * FROM ${entity}` })
  return error
}

// ─── @requires on entity ─────────────────────────────────────────────────────

describe('@requires on entity', () => {
  describe('RequiresAdmin — @requires: "admin"', () => {
    it('alice (admin): visible in MCP, readable via OData', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('alice:'),
        odataGet('RequiresAdmin', 'alice:'),
        mcpQuery('RequiresAdmin', 'alice:')
      ])
      expect(entities).to.include('RequiresAdmin')
      expect(odataStatus).to.equal(200)
      expect(mcpError).to.be.null
    })

    it('eve (editor): NOT visible in MCP, 403 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('eve:'),
        odataGet('RequiresAdmin', 'eve:'),
        mcpCqlQuery('RequiresAdmin', 'eve:')
      ])
      expect(entities).to.not.include('RequiresAdmin')
      expect(odataStatus).to.equal(403)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })

    it('bob (no roles): NOT visible in MCP, 403 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('bob:'),
        odataGet('RequiresAdmin', 'bob:'),
        mcpCqlQuery('RequiresAdmin', 'bob:')
      ])
      expect(entities).to.not.include('RequiresAdmin')
      expect(odataStatus).to.equal(403)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })

    it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum(null),
        odataGet('RequiresAdmin', null),
        mcpCqlQuery('RequiresAdmin', null)
      ])
      expect(entities).to.not.include('RequiresAdmin')
      expect(odataStatus).to.equal(401)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })
  })

  describe('RequiresAdminOrEditor — @requires: ["admin", "editor"]', () => {
    it('alice (admin): visible in MCP, readable via OData', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('alice:'),
        odataGet('RequiresAdminOrEditor', 'alice:'),
        mcpQuery('RequiresAdminOrEditor', 'alice:')
      ])
      expect(entities).to.include('RequiresAdminOrEditor')
      expect(odataStatus).to.equal(200)
      expect(mcpError).to.be.null
    })

    it('eve (editor): visible in MCP, readable via OData', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('eve:'),
        odataGet('RequiresAdminOrEditor', 'eve:'),
        mcpQuery('RequiresAdminOrEditor', 'eve:')
      ])
      expect(entities).to.include('RequiresAdminOrEditor')
      expect(odataStatus).to.equal(200)
      expect(mcpError).to.be.null
    })

    it('bob (no roles): NOT visible in MCP, 403 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('bob:'),
        odataGet('RequiresAdminOrEditor', 'bob:'),
        mcpCqlQuery('RequiresAdminOrEditor', 'bob:')
      ])
      expect(entities).to.not.include('RequiresAdminOrEditor')
      expect(odataStatus).to.equal(403)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })

    it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum(null),
        odataGet('RequiresAdminOrEditor', null),
        mcpCqlQuery('RequiresAdminOrEditor', null)
      ])
      expect(entities).to.not.include('RequiresAdminOrEditor')
      expect(odataStatus).to.equal(401)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })
  })
})

// ─── @restrict with explicit READ grant ──────────────────────────────────────

describe('@restrict: [{ grant: "READ", to: role }]', () => {
  describe('RestrictReadAdmin — to: "admin"', () => {
    it('alice (admin): visible in MCP, readable via OData', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('alice:'),
        odataGet('RestrictReadAdmin', 'alice:'),
        mcpQuery('RestrictReadAdmin', 'alice:')
      ])
      expect(entities).to.include('RestrictReadAdmin')
      expect(odataStatus).to.equal(200)
      expect(mcpError).to.be.null
    })

    it('eve (editor): NOT visible in MCP, 403 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('eve:'),
        odataGet('RestrictReadAdmin', 'eve:'),
        mcpCqlQuery('RestrictReadAdmin', 'eve:')
      ])
      expect(entities).to.not.include('RestrictReadAdmin')
      expect(odataStatus).to.equal(403)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })

    it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum(null),
        odataGet('RestrictReadAdmin', null),
        mcpCqlQuery('RestrictReadAdmin', null)
      ])
      expect(entities).to.not.include('RestrictReadAdmin')
      expect(odataStatus).to.equal(401)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })
  })

  describe('RestrictReadEditor — to: "editor"', () => {
    it('eve (editor): visible in MCP, readable via OData', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('eve:'),
        odataGet('RestrictReadEditor', 'eve:'),
        mcpQuery('RestrictReadEditor', 'eve:')
      ])
      expect(entities).to.include('RestrictReadEditor')
      expect(odataStatus).to.equal(200)
      expect(mcpError).to.be.null
    })

    it('alice (admin): NOT visible in MCP, 403 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum('alice:'),
        odataGet('RestrictReadEditor', 'alice:'),
        mcpCqlQuery('RestrictReadEditor', 'alice:')
      ])
      expect(entities).to.not.include('RestrictReadEditor')
      expect(odataStatus).to.equal(403)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })

    it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
      const [entities, odataStatus, mcpError] = await Promise.all([
        getMcpEntityEnum(null),
        odataGet('RestrictReadEditor', null),
        mcpCqlQuery('RestrictReadEditor', null)
      ])
      expect(entities).to.not.include('RestrictReadEditor')
      expect(odataStatus).to.equal(401)
      expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
    })
  })
})

// ─── @restrict with wildcard grant '*' ───────────────────────────────────────

describe('@restrict: [{ grant: "*", to: "admin" }]', () => {
  it('alice (admin): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('alice:'),
      odataGet('RestrictStarAdmin', 'alice:'),
      mcpQuery('RestrictStarAdmin', 'alice:')
    ])
    expect(entities).to.include('RestrictStarAdmin')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('eve (editor): NOT visible in MCP, 403 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('eve:'),
      odataGet('RestrictStarAdmin', 'eve:'),
      mcpCqlQuery('RestrictStarAdmin', 'eve:')
    ])
    expect(entities).to.not.include('RestrictStarAdmin')
    expect(odataStatus).to.equal(403)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })

  it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum(null),
      odataGet('RestrictStarAdmin', null),
      mcpCqlQuery('RestrictStarAdmin', null)
    ])
    expect(entities).to.not.include('RestrictStarAdmin')
    expect(odataStatus).to.equal(401)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })
})

// ─── @restrict WRITE-only (no READ grant) ────────────────────────────────────

describe('@restrict: [{ grant: "WRITE", to: "admin" }] — no READ grant, READ denied for all', () => {
  it('alice (admin): NOT visible in MCP, 403 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('alice:'),
      odataGet('RestrictWriteAdmin', 'alice:'),
      mcpCqlQuery('RestrictWriteAdmin', 'alice:')
    ])
    expect(entities).to.not.include('RestrictWriteAdmin')
    expect(odataStatus).to.equal(403)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })

  it('eve (editor): NOT visible in MCP, 403 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('eve:'),
      odataGet('RestrictWriteAdmin', 'eve:'),
      mcpCqlQuery('RestrictWriteAdmin', 'eve:')
    ])
    expect(entities).to.not.include('RestrictWriteAdmin')
    expect(odataStatus).to.equal(403)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })

  it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum(null),
      odataGet('RestrictWriteAdmin', null),
      mcpCqlQuery('RestrictWriteAdmin', null)
    ])
    expect(entities).to.not.include('RestrictWriteAdmin')
    expect(odataStatus).to.equal(401)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })
})

// ─── @restrict with no 'to' clause ───────────────────────────────────────────

describe('@restrict: [{ grant: "READ" }] — no "to", defaults to "any"', () => {
  it('alice (admin): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('alice:'),
      odataGet('RestrictNoTo', 'alice:'),
      mcpQuery('RestrictNoTo', 'alice:')
    ])
    expect(entities).to.include('RestrictNoTo')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('bob (no roles): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('bob:'),
      odataGet('RestrictNoTo', 'bob:'),
      mcpQuery('RestrictNoTo', 'bob:')
    ])
    expect(entities).to.include('RestrictNoTo')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('unauthenticated: visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum(null),
      odataGet('RestrictNoTo', null),
      mcpQuery('RestrictNoTo', null)
    ])
    expect(entities).to.include('RestrictNoTo')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })
})

// ─── @restrict with multiple roles in one privilege ──────────────────────────

describe('@restrict: [{ grant: "READ", to: ["admin", "editor"] }]', () => {
  it('alice (admin): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('alice:'),
      odataGet('RestrictMultiRole', 'alice:'),
      mcpQuery('RestrictMultiRole', 'alice:')
    ])
    expect(entities).to.include('RestrictMultiRole')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('eve (editor): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('eve:'),
      odataGet('RestrictMultiRole', 'eve:'),
      mcpQuery('RestrictMultiRole', 'eve:')
    ])
    expect(entities).to.include('RestrictMultiRole')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('bob (no roles): NOT visible in MCP, 403 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('bob:'),
      odataGet('RestrictMultiRole', 'bob:'),
      mcpCqlQuery('RestrictMultiRole', 'bob:')
    ])
    expect(entities).to.not.include('RestrictMultiRole')
    expect(odataStatus).to.equal(403)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })

  it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum(null),
      odataGet('RestrictMultiRole', null),
      mcpCqlQuery('RestrictMultiRole', null)
    ])
    expect(entities).to.not.include('RestrictMultiRole')
    expect(odataStatus).to.equal(401)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })
})

// ─── @restrict with multiple separate privileges ─────────────────────────────

describe('@restrict: [{ grant:"READ", to:"admin" }, { grant:"READ", to:"editor" }]', () => {
  it('alice (admin): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('alice:'),
      odataGet('RestrictMultiPrivilege', 'alice:'),
      mcpQuery('RestrictMultiPrivilege', 'alice:')
    ])
    expect(entities).to.include('RestrictMultiPrivilege')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('eve (editor): visible in MCP, readable via OData', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('eve:'),
      odataGet('RestrictMultiPrivilege', 'eve:'),
      mcpQuery('RestrictMultiPrivilege', 'eve:')
    ])
    expect(entities).to.include('RestrictMultiPrivilege')
    expect(odataStatus).to.equal(200)
    expect(mcpError).to.be.null
  })

  it('viewer (unrelated role): NOT visible in MCP, 403 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum('viewer:'),
      odataGet('RestrictMultiPrivilege', 'viewer:'),
      mcpCqlQuery('RestrictMultiPrivilege', 'viewer:')
    ])
    expect(entities).to.not.include('RestrictMultiPrivilege')
    expect(odataStatus).to.equal(403)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })

  it('unauthenticated: NOT visible in MCP, 401 from OData, query rejected', async () => {
    const [entities, odataStatus, mcpError] = await Promise.all([
      getMcpEntityEnum(null),
      odataGet('RestrictMultiPrivilege', null),
      mcpCqlQuery('RestrictMultiPrivilege', null)
    ])
    expect(entities).to.not.include('RestrictMultiPrivilege')
    expect(odataStatus).to.equal(401)
    expect(mcpError).to.match(/authoriz|not allowed|invalid/i)
  })
})

// ─── @requires on entity (same result as @restrict [grant:'*']) ───────────────

describe('RequiresAndRestrictAdmin — @requires: "admin" (cross-check with RestrictStarAdmin)', () => {
  it('alice (admin): both entities visible in MCP', async () => {
    const entities = await getMcpEntityEnum('alice:')
    expect(entities).to.include('RequiresAndRestrictAdmin')
    expect(entities).to.include('RestrictStarAdmin')
  })

  it('bob (no roles): neither entity visible in MCP', async () => {
    const entities = await getMcpEntityEnum('bob:')
    expect(entities).to.not.include('RequiresAndRestrictAdmin')
    expect(entities).to.not.include('RestrictStarAdmin')
  })

  it('alice: OData status matches between @requires and @restrict[grant:"*"]', async () => {
    const [r1, r2] = await Promise.all([
      odataGet('RequiresAndRestrictAdmin', 'alice:'),
      odataGet('RestrictStarAdmin', 'alice:')
    ])
    expect(r1).to.equal(r2).and.equal(200)
  })

  it('bob: OData status matches between @requires and @restrict[grant:"*"]', async () => {
    const [r1, r2] = await Promise.all([
      odataGet('RequiresAndRestrictAdmin', 'bob:'),
      odataGet('RestrictStarAdmin', 'bob:')
    ])
    expect(r1).to.equal(r2).and.equal(403)
  })

  it('unauthenticated: OData status matches between @requires and @restrict[grant:"*"]', async () => {
    const [r1, r2] = await Promise.all([
      odataGet('RequiresAndRestrictAdmin', null),
      odataGet('RestrictStarAdmin', null)
    ])
    expect(r1).to.equal(r2).and.equal(401)
  })
})

// ─── @requires on actions ─────────────────────────────────────────────────────

describe('@requires on actions', () => {
  describe('adminAction — @requires: "admin"', () => {
    it('alice (admin): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('alice:')
      expect(actions).to.include('adminAction')
    })

    it('eve (editor): action NOT visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('eve:')
      expect(actions).to.not.include('adminAction')
    })

    it('bob (no roles): action NOT visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('bob:')
      expect(actions).to.not.include('adminAction')
    })

    it('unauthenticated: call tool present (openAction has no restriction)', async () => {
      const actions = await getMcpActionEnum(null)
      // openAction has no @requires/@restrict — visible to all including unauthenticated
      expect(actions).to.include('openAction')
      expect(actions).to.not.include('adminAction')
      expect(actions).to.not.include('restrictedAction')
    })

    it('alice (admin): OData action call returns 200', async () => {
      const headers = {
        Authorization: `Basic ${Buffer.from('alice:').toString('base64')}`,
        'Content-Type': 'application/json'
      }
      const res = await fetch(`${test.url}${ODATA}/adminAction`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ x: 1 })
      })
      expect(res.status).to.equal(200)
    })

    it('bob (no roles): OData action call returns 403', async () => {
      const headers = {
        Authorization: `Basic ${Buffer.from('bob:').toString('base64')}`,
        'Content-Type': 'application/json'
      }
      const res = await fetch(`${test.url}${ODATA}/adminAction`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ x: 1 })
      })
      expect(res.status).to.equal(403)
    })

    it('unauthenticated: OData action call returns 401', async () => {
      const res = await fetch(`${test.url}${ODATA}/adminAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 1 })
      })
      expect(res.status).to.equal(401)
    })
  })

  describe('editorAction — @requires: "editor"', () => {
    it('eve (editor): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('eve:')
      expect(actions).to.include('editorAction')
    })

    it('alice (admin): action NOT visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('alice:')
      expect(actions).to.not.include('editorAction')
    })
  })

  describe('openAction — no auth annotation', () => {
    it('alice (admin): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('alice:')
      expect(actions).to.include('openAction')
    })

    it('eve (editor): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('eve:')
      expect(actions).to.include('openAction')
    })

    it('bob (no roles): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('bob:')
      expect(actions).to.include('openAction')
    })
  })
})

// ─── @restrict on actions ─────────────────────────────────────────────────────

describe('@restrict on actions (grant ignored, only "to" enforced)', () => {
  describe('restrictedAction — @restrict: [{ grant: "READ", to: "admin" }]', () => {
    it('alice (admin): action visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('alice:')
      expect(actions).to.include('restrictedAction')
    })

    it('eve (editor): action NOT visible in MCP call tool', async () => {
      const actions = await getMcpActionEnum('eve:')
      expect(actions).to.not.include('restrictedAction')
    })

    it('unauthenticated: call tool present (openAction has no restriction)', async () => {
      const actions = await getMcpActionEnum(null)
      // openAction has no @requires/@restrict — visible to all including unauthenticated
      expect(actions).to.include('openAction')
      expect(actions).to.not.include('adminAction')
      expect(actions).to.not.include('restrictedAction')
    })

    it('alice (admin): OData action call returns 200', async () => {
      const headers = {
        Authorization: `Basic ${Buffer.from('alice:').toString('base64')}`,
        'Content-Type': 'application/json'
      }
      const res = await fetch(`${test.url}${ODATA}/restrictedAction`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ x: 1 })
      })
      expect(res.status).to.equal(200)
    })

    it('eve (editor): OData action call returns 403', async () => {
      const headers = {
        Authorization: `Basic ${Buffer.from('eve:').toString('base64')}`,
        'Content-Type': 'application/json'
      }
      const res = await fetch(`${test.url}${ODATA}/restrictedAction`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ x: 1 })
      })
      expect(res.status).to.equal(403)
    })
  })
})

// ─── MCP call tool visibility rules ──────────────────────────────────────────

describe('MCP call tool presence rules', () => {
  it('call tool is absent when user has no accessible actions', async () => {
    // bob has no roles → adminAction, editorAction, restrictedAction all hidden
    // openAction has no auth → still visible → call tool should still appear
    const actions = await getMcpActionEnum('bob:')
    expect(actions).to.include('openAction')
    expect(actions).to.not.include('adminAction')
    expect(actions).to.not.include('editorAction')
    expect(actions).to.not.include('restrictedAction')
  })

  it('call tool is present when unauthenticated but openAction has no restriction', async () => {
    // unauthenticated: openAction is visible (no auth), so call tool should exist
    const actions = await getMcpActionEnum(null)
    expect(actions).to.include('openAction')
  })
})

// ─── Service-level @requires / @restrict ─────────────────────────────────────
//
// Mirrors CAP HTTP protocol adapter's `authorize` semantics
// (@sap/cds/lib/srv/protocols/http.js — `get authorize()`):
//
//   - @requires on service          → all requests must match a role
//   - @restrict on service          → 'to' roles across all clauses; if none,
//                                     falls through to env fallback:
//                                       prod + restrict_all_services !== false
//                                         → ['authenticated-user']
//                                       otherwise → public
//
// Both MCP (via checkServiceAccess) and OData (via CAP's HttpAdapter) must
// enforce these gates identically.

async function mcpRawStatus(path, auth) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  }
  if (auth) headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
  const res = await fetch(`${test.url}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  })
  return res.status
}

async function odataRootStatus(path, auth) {
  const headers = { Accept: 'application/json' }
  if (auth) headers['Authorization'] = `Basic ${Buffer.from(auth).toString('base64')}`
  const res = await fetch(`${test.url}${path}/Books`, { headers })
  return res.status
}

describe('Service-level @requires — @requires: "admin"', () => {
  const MCP_PATH = '/mcp/service-requires-admin'
  const ODATA_PATH = '/odata/v4/service-requires-admin'

  it('alice (admin): MCP and OData both grant access', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, 'alice:'),
      odataRootStatus(ODATA_PATH, 'alice:')
    ])
    expect(mcp).to.equal(200)
    expect(odata).to.equal(200)
  })

  it('bob (no roles): both surfaces return 403', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, 'bob:'),
      odataRootStatus(ODATA_PATH, 'bob:')
    ])
    expect(mcp).to.equal(403)
    expect(odata).to.equal(403)
  })

  it('unauthenticated: both surfaces return 401', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, null),
      odataRootStatus(ODATA_PATH, null)
    ])
    expect(mcp).to.equal(401)
    expect(odata).to.equal(401)
  })
})

describe('Service-level @restrict — @restrict: [{ grant: "READ", to: "admin" }]', () => {
  const MCP_PATH = '/mcp/service-restrict-admin'
  const ODATA_PATH = '/odata/v4/service-restrict-admin'

  it('alice (admin): MCP and OData both grant access', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, 'alice:'),
      odataRootStatus(ODATA_PATH, 'alice:')
    ])
    expect(mcp).to.equal(200)
    expect(odata).to.equal(200)
  })

  it('bob (no roles): both surfaces return 403', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, 'bob:'),
      odataRootStatus(ODATA_PATH, 'bob:')
    ])
    expect(mcp).to.equal(403)
    expect(odata).to.equal(403)
  })

  it('unauthenticated: both surfaces return 401', async () => {
    const [mcp, odata] = await Promise.all([
      mcpRawStatus(MCP_PATH, null),
      odataRootStatus(ODATA_PATH, null)
    ])
    expect(mcp).to.equal(401)
    expect(odata).to.equal(401)
  })
})

describe('Service-level @restrict — multiple "to" roles', () => {
  const MCP_PATH = '/mcp/service-restrict-admin-or-editor'
  const ODATA_PATH = '/odata/v4/service-restrict-admin-or-editor'

  it('alice (admin): granted', async () => {
    expect(await mcpRawStatus(MCP_PATH, 'alice:')).to.equal(200)
    expect(await odataRootStatus(ODATA_PATH, 'alice:')).to.equal(200)
  })

  it('eve (editor): granted', async () => {
    expect(await mcpRawStatus(MCP_PATH, 'eve:')).to.equal(200)
    expect(await odataRootStatus(ODATA_PATH, 'eve:')).to.equal(200)
  })

  it('bob (no roles): 403', async () => {
    expect(await mcpRawStatus(MCP_PATH, 'bob:')).to.equal(403)
    expect(await odataRootStatus(ODATA_PATH, 'bob:')).to.equal(403)
  })

  it('unauthenticated: 401', async () => {
    expect(await mcpRawStatus(MCP_PATH, null)).to.equal(401)
    expect(await odataRootStatus(ODATA_PATH, null)).to.equal(401)
  })
})

describe('Service-level @restrict without "to" — env fallback', () => {
  const MCP_PATH = '/mcp/service-restrict-no-to'
  const ODATA_PATH = '/odata/v4/service-restrict-no-to'

  describe('dev (NODE_ENV !== "production"): public — everyone including anonymous', () => {
    // Base config: development. NODE_ENV is not explicitly set to production here.
    it('alice (admin): 200', async () => {
      expect(await mcpRawStatus(MCP_PATH, 'alice:')).to.equal(200)
      expect(await odataRootStatus(ODATA_PATH, 'alice:')).to.equal(200)
    })

    it('bob (no roles): 200', async () => {
      expect(await mcpRawStatus(MCP_PATH, 'bob:')).to.equal(200)
      expect(await odataRootStatus(ODATA_PATH, 'bob:')).to.equal(200)
    })

    it('unauthenticated: 200 on MCP (OData may still gate via other middleware)', async () => {
      // MCP has no outer auth middleware — anonymous reaches checkServiceAccess and passes.
      expect(await mcpRawStatus(MCP_PATH, null)).to.equal(200)
    })
  })

  describe('prod (NODE_ENV === "production"): authenticated-user fallback', () => {
    let savedNodeEnv
    let savedRestrictAll
    let restrictAllWasSet

    beforeAll(() => {
      savedNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      cds.env.requires ??= {}
      cds.env.requires.auth ??= {}
      restrictAllWasSet = 'restrict_all_services' in cds.env.requires.auth
      savedRestrictAll = cds.env.requires.auth.restrict_all_services
      cds.env.requires.auth.restrict_all_services = true
    })

    afterAll(() => {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = savedNodeEnv
      if (restrictAllWasSet) cds.env.requires.auth.restrict_all_services = savedRestrictAll
      else delete cds.env.requires.auth.restrict_all_services
    })

    it('alice (admin): 200 (authenticated-user is satisfied)', async () => {
      expect(await mcpRawStatus(MCP_PATH, 'alice:')).to.equal(200)
    })

    it('bob (no roles): 200 (authenticated-user is satisfied)', async () => {
      expect(await mcpRawStatus(MCP_PATH, 'bob:')).to.equal(200)
    })

    it('unauthenticated: 401 on MCP', async () => {
      expect(await mcpRawStatus(MCP_PATH, null)).to.equal(401)
    })
  })

  describe('prod with restrict_all_services=false: public again', () => {
    let savedNodeEnv
    let savedRestrictAll
    let restrictAllWasSet

    beforeAll(() => {
      savedNodeEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'
      cds.env.requires ??= {}
      cds.env.requires.auth ??= {}
      restrictAllWasSet = 'restrict_all_services' in cds.env.requires.auth
      savedRestrictAll = cds.env.requires.auth.restrict_all_services
      cds.env.requires.auth.restrict_all_services = false
    })

    afterAll(() => {
      if (savedNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = savedNodeEnv
      if (restrictAllWasSet) cds.env.requires.auth.restrict_all_services = savedRestrictAll
      else delete cds.env.requires.auth.restrict_all_services
    })

    it('unauthenticated: 200 on MCP (opt-out disables the prod fallback)', async () => {
      expect(await mcpRawStatus(MCP_PATH, null)).to.equal(200)
    })
  })
})
