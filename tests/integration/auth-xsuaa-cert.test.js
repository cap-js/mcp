const cds = require('@sap/cds')
const t = cds
  .test('serve', 'all', '--in-memory?', '--profile', 'xsuaa-cert-st,production')
  .in(__dirname + '/../bookshop')
const { expect, GET, defaults, POST } = t
defaults.validateStatus = () => true

// Must match the credentials.url of the [xsuaa-st] profile in bookshop/package.json
const XSUAA_URL = 'https://abc.authentication.sap.hana.ondemand.com'

const realFetch = globalThis.fetch
const urlOf = (input) => String(typeof input === 'string' ? input : (input?.url ?? input))
let fetchSpy
const xsuaaCalls = () => fetchSpy.mock.calls.filter(([input]) => urlOf(input).startsWith(XSUAA_URL))
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (!urlOf(input).startsWith(XSUAA_URL)) return realFetch(input, init)
    // fresh Response per call: a Response body can only be read once
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: 'jwt', expires_in: 3600 }), { status: 200 })
    )
  })
})
afterEach(() => {
  fetchSpy.mockRestore()
})
let baseUrl
before(() => { baseUrl = cds.env.protocols.mcp.auth.baseUrl = t.url.replace('http', 'https')})

describe('XSUAA authentication using certificates', () => {
  it('.well-known/oauth-authorization-server promotes dcr', async () => {
    const response = await GET('.well-known/oauth-authorization-server')
    expect(response.status).to.eq(200)
    expect(response.data.registration_endpoint).to.eq(`${baseUrl}/oauth/register`)
  })

  it('oauth/register mocks the registration', async () => {
    const response = await POST('oauth/register', { redirect_uris: ['1', '2'] })
    expect(response.status).to.eq(201)
    expect(response.data).to.deep.eq({
      client_id: 'mock-xsuaa',
      redirect_uris: ['1', '2']
    })
  })

  it('oauth/token endpoint enriches request and sends it to xsuaa', async () => {
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
    expect(options.dispatcher).to.exist
    const body = new URLSearchParams(options.body)
    expect(body.get('grant_type')).to.eq('authorization_code')
    expect(body.get('code')).to.eq('the-auth-code')
    expect(body.get('code_verifier')).to.eq('the-verifier')
    expect(body.get('client_id')).to.eq('mock-xsuaa')
  })
})
