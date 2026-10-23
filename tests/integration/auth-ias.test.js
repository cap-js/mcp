const cds = require('@sap/cds')
const t = cds
  .test('serve', 'all', '--in-memory?', '--profile', 'ias-st,production')
  .in(__dirname + '/../bookshop')
const { expect, GET, defaults, POST } = t
defaults.validateStatus = () => true

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const IAS_CLAIMS = {
  sub: 'i@sap.com',
  email: 'i@sap.com',
  given_name: 'Max',
  family_name: 'Mustermann',
  app_tid: '1',
  iss: 'https://abc.accounts400.ondemand.com',
  aud: '1',
  azp: '1',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600
}
const jwt_token = `${b64url({ kid: 'test', alg: 'RS256' })}.${b64url(IAS_CLAIMS)}.sig`
let baseUrl
before(() => { baseUrl = cds.env.protocols.mcp.auth.baseUrl = t.url.replace('http', 'https')})

describe('IAS authentication', () => {
  describe('.well-known endpoints', () => {
    it('.well-known/oauth-protected-resource is served', async () => {
      const response = await GET('.well-known/oauth-protected-resource/mcp/catalog')
      expect(response.data).to.deep.eq({
        authorization_servers: ['https://abc.accounts400.ondemand.com'],
        resource: `${baseUrl}/mcp/catalog`,
        scopes_supported: ['openid']
      })
    })

    it('.well-known/oauth-authorization-server is not served', async () => {
      const response = await GET('.well-known/oauth-authorization-server')
      expect(response.status).to.eq(404)
    })

    it.skip('includes challenge if unauthenticated access', async () => {
      // TODO: requires a change in mcp protocol adapter implementation
      const response = await POST(
        '/mcp/catalog',
        { jsonrpc: '2.0', id: 4711, method: 'tools/list', params: {} },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream'
          }
        }
      )
      expect(response.status).to.eq(401)
      expect(response.headers['WWW-Authenticate']).to.eq(
        `Bearer resource_metadata="${baseUrl}/mcp/catalog", error="invalid_token"`
      )
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
  })
})
