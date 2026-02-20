const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

// Configurable stress test parameters
const SEQUENTIAL_REQUEST_COUNT = 1000
const PARALLEL_REQUEST_COUNT = 1000
const PARALLEL_BATCH_SIZE = 20

// We had an issue with to many HANA connections when removing session management,
// so this tests were created to execute in hybrid mode and check if the issue was resolved 
describe('Stress Test', () => {
  it('handles sequential MCP requests', async () => {
    for (let i = 0; i < SEQUENTIAL_REQUEST_COUNT; i++) {
      const { callTool } = mcpClient()
      const { content, error } = await callTool('query', {
        entity: 'Books',
        limit: 1
      })
      expect(error).to.be.null
      expect(content.entity).to.equal('Books')
    }
  }, 300000)

  it('handles parallel MCP requests', async () => {
    const batchCount = PARALLEL_REQUEST_COUNT / PARALLEL_BATCH_SIZE

    for (let batch = 0; batch < batchCount; batch++) {
      const promises = Array.from({ length: PARALLEL_BATCH_SIZE }, () => {
        const { callTool } = mcpClient()
        return callTool('query', { entity: 'Books', limit: 1 })
      })

      const results = await Promise.all(promises)

      for (const { content, error } of results) {
        expect(error).to.be.null
        expect(content.entity).to.equal('Books')
      }
    }
  }, 300000)
})
