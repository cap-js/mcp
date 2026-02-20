const cds = require('@sap/cds')

module.exports = class AdminService extends cds.ApplicationService { init() {

  const { Books } = this.entities

  /**
   * Generate IDs for new Books drafts
   */
  this.before ('NEW', Books.drafts, async (req) => {
    if (req.data.ID) return
    const { ID:id1 } = await SELECT.one.from(Books).columns('max(ID) as ID')
    const { ID:id2 } = await SELECT.one.from(Books.drafts).columns('max(ID) as ID')
    req.data.ID = Math.max(id1||0, id2||0) + 1
  })

  // Simple arithmetic - something OData can't do
  this.on('sum', (req) => {
    const { x, y } = req.data
    return (x || 0) + (y || 0)
  })

  // Lookup stock for a book by ID
  this.on('stock', async (req) => {
    const { id } = req.data
    const book = await SELECT.one.from(Books).where({ ID: id }).columns('stock')
    return book?.stock ?? 0
  })

  // Action: add x to accumulator 'to'
  this.on('add', (req) => {
    const { x, to } = req.data
    return (x || 0) + (to || 0)
  })

  return super.init()
}}
