const cds = require('@sap/cds')
const t = cds.test('serve', 'all', '--in-memory?', '--profile', 'xsuaa-st,production').in(__dirname + '/../bookshop')
const { expect, GET, defaults, POST } = t
defaults.validateStatus = () => true

// Must match the credentials.url of the [xsuaa-st] profile in bookshop/package.json
const XSUAA_URL = 'https://abc.authentication.sap.hana.ondemand.com'

// Build a self-signed XSUAA token at runtime: signature validation is disabled
// via config.validation.enabled=false, so no real secret lives in the repo.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const XSUAA_CLAIMS = {
  user_name: 'max.mustermann@sap.com',
  email: 'max.mustermann@sap.com',
  given_name: 'Max',
  family_name: 'Mustermann',
  scope: [], // openid-scoped user; user_factory iterates this, so it must be an array
  grant_type: 'authorization_code',
  zid: '1',
  aud: 'mock-xsuaa',
  client_id: 'mock-xsuaa',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
}
const jwt_token = `${b64url({ kid: 'test', alg: 'RS256' })}.${b64url(XSUAA_CLAIMS)}.sig`

describe('XSUAA authentication', () => {
  describe('.well-known endpoints', () => {
    it('.well-known/oauth-protected-resource is served', async () => {
      const response = await GET('.well-known/oauth-protected-resource/mcp/catalog')
      const base = t.url.replace('http', 'https')
      expect(response.data).to.deep.eq({
        resource: `${base}/mcp/catalog`,
        authorization_servers: [base],
        scopes_supported: ['openid']
      })
    })

    it('.well-known/oauth-authorization-server is served', async () => {
      const response = await GET('.well-known/oauth-authorization-server')
      const base = t.url.replace('http', 'https')
      expect(response.status).to.eq(200)
      expect(response.data).to.deep.eq({ //TODO. which fields are required?
        issuer: base,
        authorization_endpoint: `${XSUAA_URL}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        jwks_uri: `${XSUAA_URL}/token_keys`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['openid']
      })
    })

    it.todo('oauth/token sends a request to xsuaa') // mock fetch for this

    it.todo('oauth/token only allows authorization_code and refresh_token grants')

    it.todo('id token is exchanged at runtime') // mock fetch for this

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
  })
})
