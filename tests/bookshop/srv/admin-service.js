const cds = require('@sap/cds')

module.exports = class AdminService extends cds.ApplicationService {
  init() {
    const { Books } = this.entities

    /**
     * Generate IDs for new Books drafts.
     * Books uses cds.Integer keys without auto-generation — HANA rejects NULL.
     */
    this.before('NEW', Books.drafts, async (req) => {
      if (req.data.ID) return
      const { ID: id1 } = await SELECT.one.from(Books).columns('max(ID) as ID')
      const { ID: id2 } = await SELECT.one.from(Books.drafts).columns('max(ID) as ID')
      req.data.ID = Math.max(id1 || 0, id2 || 0) + 1
    })

    // Generate IDs for Documents draft
    const { Documents } = this.entities
    this.before('NEW', Documents.drafts, async (req) => {
      if (req.data.ID) return
      const { ID: id1 } = await SELECT.one.from(Documents).columns('max(ID) as ID')
      const { ID: id2 } = await SELECT.one.from(Documents.drafts).columns('max(ID) as ID')
      req.data.ID = Math.max(id1 || 0, id2 || 0) + 1
    })

    const addIntegerIDHandler = (entity) => {
      if (!entity?.drafts) return
      this.before('NEW', entity.drafts, async (req) => {
        if (req.data.ID) return
        const { ID: id1 } = await SELECT.one.from(entity).columns('max(ID) as ID')
        const { ID: id2 } = await SELECT.one.from(entity.drafts).columns('max(ID) as ID')
        req.data.ID = Math.max(id1 || 0, id2 || 0) + 1
      })
    }

    addIntegerIDHandler(this.entities['Documents.notes'])
    addIntegerIDHandler(this.entities.Sections)
    addIntegerIDHandler(this.entities.Paragraphs)

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
  }
}
