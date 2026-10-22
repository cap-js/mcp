const cds = require('@sap/cds')
const t = cds
  .test('serve', 'all', '--in-memory?', '--profile', 'xsuaa-st,production')
  .in(__dirname + '/../bookshop')
const { expect, GET, defaults, POST } = t
defaults.validateStatus = () => true

// Must match the credentials.url of the [xsuaa-st] profile in bookshop/package.json
const XSUAA_URL = 'https://abc.authentication.sap.hana.ondemand.com'

// Build a self-signed XSUAA token at runtime: signature validation is disabled
// via config.validation.enabled=false, so no real secret lives in the repo.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const makeJwt = (claims) =>
  `${b64url({ kid: 'test', alg: 'RS256' })}.${b64url({
    user_name: 'max.mustermann@sap.com',
    email: 'max.mustermann@sap.com',
    given_name: 'Max',
    family_name: 'Mustermann',
    grant_type: 'authorization_code',
    zid: '1',
    aud: 'mock-xsuaa',
    client_id: 'mock-xsuaa',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: [], // user_factory iterates this, so it must be an array
    ...claims
  })}.sig`

// openid-scoped user token presented by the client
const jwt_token = makeJwt({})
// the full-scoped token XSUAA returns from the exchange: adds the admin scope
// (xsappname is "bookshop", so "bookshop.admin" maps to the "admin" role)
const exchanged_token = makeJwt({ scope: ['openid', 'bookshop.admin'] })

// Stub fetch so neither the /oauth/token proxy nor the runtime token exchange
// hits the network. The cds test client (naxios) is itself fetch-based, so we
// only intercept calls to XSUAA and pass everything else through to the server.
const realFetch = globalThis.fetch
const urlOf = (input) => String(typeof input === 'string' ? input : (input?.url ?? input))
let fetchSpy, xsuaa_throw
const xsuaaCalls = () => fetchSpy.mock.calls.filter(([input]) => urlOf(input).startsWith(XSUAA_URL))
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (!urlOf(input).startsWith(XSUAA_URL)) return realFetch(input, init)
    if (xsuaa_throw)
      return Promise.resolve(new Response(JSON.stringify({ error: 'failed' }), { status: 400 }))
    // fresh Response per call: a Response body can only be read once
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: exchanged_token, expires_in: 3600 }), {
        status: 200
      })
    )
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
  xsuaa_throw = false
})

describe('XSUAA authentication', () => {
  describe('.well-known endpoints', () => {
    it('.well-known/oauth-protected-resource is served', async () => {
      const response = await GET('.well-known/oauth-protected-resource/mcp/catalog')
      const base = t.url.replace('http', 'https')
      expect(response.data).to.deep.eq({
        resource: `${base}/mcp/catalog`,
        authorization_servers: [base]
      })
    })

    it('.well-known/oauth-authorization-server is served', async () => {
      const response = await GET('.well-known/oauth-authorization-server')
      const base = t.url.replace('http', 'https')
      expect(response.status).to.eq(200)
      expect(response.data).to.deep.eq({
        issuer: base,
        authorization_endpoint: `${XSUAA_URL}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        jwks_uri: `${XSUAA_URL}/token_keys`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none']
      })
    })
  })

  describe('oauth/token endpoint', () => {
    it('enriches request and sends it to xsuaa', async () => {
      const response = await POST(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'the-auth-code',
          code_verifier: 'the-verifier',
          redirect_uri: 'https://client/cb'
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      )

      expect(response.status).to.eq(200)
      expect(xsuaaCalls()).to.have.length(1)
      const [url, options] = xsuaaCalls()[0]
      expect(url).to.eq(`${XSUAA_URL}/oauth/token`)
      expect(options.method).to.eq('POST')
      // app credential injected via HTTP basic auth
      expect(options.headers.Authorization).to.eq(
        `Basic ${Buffer.from('mock-xsuaa:mock-secret').toString('base64')}`
      )
      const body = new URLSearchParams(options.body)
      expect(body.get('grant_type')).to.eq('authorization_code')
      expect(body.get('code')).to.eq('the-auth-code')
      expect(body.get('code_verifier')).to.eq('the-verifier')
      expect(body.get('client_id')).to.eq('mock-xsuaa')
    })

    it('only allows authorization_code and refresh_token grants', async () => {
      for (const grant_type of [
        'client_credentials',
        'password',
        'urn:ietf:params:oauth:grant-type:jwt-bearer',
        undefined // missing grant_type
      ]) {
        const denied = await POST(
          '/oauth/token',
          new URLSearchParams(grant_type ? { grant_type } : {}).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        )
        expect(denied.status, `grant_type=${grant_type}`).to.eq(400)
        expect(denied.data.error, `grant_type=${grant_type}`).to.eq('unsupported_grant_type')
      }
      expect(xsuaaCalls()).to.have.length(0)

      for (const grant of [
        { grant_type: 'authorization_code', code: 'c', code_verifier: 'v' },
        { grant_type: 'refresh_token', refresh_token: 'r' }
      ]) {
        const ok = await POST('/oauth/token', new URLSearchParams(grant).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        expect(ok.status).to.eq(200)
      }
    })

    it('rejects request if params are missing', async () => {
      for (const grant of [
        { grant_type: 'authorization_code', code_verifier: 'v' },
        { grant_type: 'authorization_code', code: 'c' },
        { grant_type: 'refresh_token' }
      ]) {
        const denied = await POST('/oauth/token', new URLSearchParams(grant).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
        expect(denied.status).to.eq(400)
        expect(denied.data.error).to.eq('invalid_request')
      }
    })

    it('rejects if xsuaa request fails', async () => {
      xsuaa_throw = true
      const denied = await POST(
        '/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: 'c',
          code_verifier: 'v'
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
      )
      expect(denied.status).to.eq(400)
      expect(denied.data.error).to.eq('token_fetch_failed')
    })

    it('id token is exchanged at runtime', async () => {
      // openid-only token; distinct (unique jti) so the module-level exchange
      // cache does not short-circuit fetch. RestrictedService.add requires the
      // 'admin' role, which this token does NOT carry — only the exchanged one does.
      const openid_token = makeJwt({ jti: 'exchange-test', user_name: 'exchange@sap.com' })
      const response = await POST(
        '/mcp/restricted',
        { jsonrpc: '2.0', id: 4711, method: 'tools/list', params: {} },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            authorization: `Bearer ${openid_token}`
          }
        }
      )

      expect(response.status).to.eq(200)

      // the presented openid token was exchanged (jwt-bearer grant) against xsuaa
      expect(xsuaaCalls()).to.have.length(1)
      const body = new URLSearchParams(xsuaaCalls()[0][1].body)
      expect(body.get('grant_type')).to.eq('urn:ietf:params:oauth:grant-type:jwt-bearer')
      expect(body.get('assertion')).to.eq(openid_token)

      // the exchanged token carries bookshop.admin, so the admin-gated `add`
      // action is now exposed as a `call` tool on the restricted service
      const payload = JSON.parse(
        (await response.text())
          .split('\n')
          .find((l) => l.startsWith('data: '))
          .slice(6)
      )
      const call = payload.result.tools.find((tool) => tool.name === 'call')
      expect(call, 'admin-gated `call` tool should be exposed after exchange').to.exist
      expect(call.inputSchema.properties.action.enum).to.include('add')
    })
  })

  it('lists available tools if authenticated', async () => {
    const httpResponse = await POST(
      '/mcp/catalog',
      { jsonrpc: '2.0', id: 4711, method: 'tools/list', params: {} },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          authorization: `Bearer ${jwt_token}`
        }
      }
    )

    const toon = require('@toon-format/toon')
    const { data } = toon.decode(await httpResponse.text())
    expect(data).to.exist
  })

  it('serves a repeated token from cache without re-hitting xsuaa', async () => {
    // unique jti so this exact token was not already cached by another test
    const token = makeJwt({ jti: 'cache-hit-test', user_name: 'cache@sap.com' })
    const req = [
      '/mcp/restricted',
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          authorization: `Bearer ${token}`
        }
      }
    ]
    const first = await POST(...req)
    const second = await POST(...req)

    expect(first.status).to.eq(200)
    expect(second.status).to.eq(200)
    // exchanged exactly once; the second request was served from the cache
    expect(xsuaaCalls()).to.have.length(1)
  })
})
