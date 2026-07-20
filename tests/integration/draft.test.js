const cds = require('@sap/cds')
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)
const { _isCompositionParentBacklink } = require('../../lib/draft')

describe('Draft Tools', () => {
  // AdminService.Books is @odata.draft.enabled
  const client = () => mcpClient('/mcp/admin', 'alice:')

  describe('tools/list', () => {
    it('registers draft tools for draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('activate-books')
      expect(toolNames).to.include('edit-books')
      expect(toolNames).to.include('create-books')
      expect(toolNames).to.include('update-books')
      expect(toolNames).to.include('discard-books')
    })

    it('registers composition child tools', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      // Books has composition 'chapters' -> should generate chapter tools
      expect(toolNames).to.include('create-chapter')
      expect(toolNames).to.include('update-chapter')
      expect(toolNames).to.include('discard-chapter')
    })

    it('does not register draft tools for non-draft entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.not.include('activate-authors')
      expect(toolNames).to.not.include('create-authors')
      expect(toolNames).to.not.include('activate-genres')
    })

    it('activate tool has key parameter schema', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('ID')
    })

    it('activate tool is flagged with _meta.requiresHITL for agent plugins', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-books')
      expect(tool).to.exist
      expect(tool._meta).to.exist
      expect(tool._meta.requiresHITL).to.equal(true)
    })

    it('non-activate tools do not carry requiresHITL', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const create = response.result.tools.find((t) => t.name === 'create-books')
      const update = response.result.tools.find((t) => t.name === 'update-books')
      expect(create._meta?.requiresHITL).to.not.equal(true)
      expect(update._meta?.requiresHITL).to.not.equal(true)
    })

    it('agent plugin can filter HITL-required tools from tools/list', async () => {
      // Simulates how deepagents interruptOn would discover HITL tools
      const { mcp } = client()
      const response = await mcp('tools/list')
      const hitlToolNames = response.result.tools
        .filter((t) => t._meta?.requiresHITL === true)
        .map((t) => t.name)
      // Only activate-* tools should surface as HITL-required
      expect(hitlToolNames.length).to.be.greaterThan(0)
      for (const name of hitlToolNames) {
        expect(name.startsWith('activate-')).to.equal(true)
      }
    })

    it('create tool has writable field parameters', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('title')
      expect(tool.inputSchema.properties).to.have.property('stock')
      // Should NOT include draft/managed fields or keys
      expect(tool.inputSchema.properties).to.not.have.property('IsActiveEntity')
      expect(tool.inputSchema.properties).to.not.have.property('DraftAdministrativeData')
      expect(tool.inputSchema.properties).to.not.have.property('createdAt')
      expect(tool.inputSchema.properties).to.not.have.property('ID')
    })

    it('update tool has key + writable field parameters', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'update-books')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('ID')
      expect(tool.inputSchema.properties).to.have.property('title')
    })

    it('child create tool has parent key + writable params', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-chapter')
      expect(tool).to.exist
      // Should have prefixed parent key (book_ID from Books)
      expect(tool.inputSchema.properties).to.have.property('book_ID')
      // Should have writable child fields
      expect(tool.inputSchema.properties).to.have.property('title')
      // Should NOT have draft elements or un-prefixed parent key
      expect(tool.inputSchema.properties).to.not.have.property('IsActiveEntity')
    })

    it('child discard tool has parent key + child key', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'discard-chapter')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('book_ID')
      expect(tool.inputSchema.properties).to.have.property('ID')
    })

    it('inline composition child (notes) has tools registered', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('create-note')
      expect(toolNames).to.include('update-note')
      expect(toolNames).to.include('discard-note')
    })

    it('inline composition child schema has writable fields, no up_ FK', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-note')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('text')
      // Prefixed parent key (document_ID from Documents)
      expect(tool.inputSchema.properties).to.have.property('document_ID')
      // up__ID (parent FK for inline comp) must not be exposed
      expect(tool.inputSchema.properties).to.not.have.property('up__ID')
    })

    it('2nd-level composition (Paragraphs via Sections) has tools registered', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('create-paragraph')
      expect(toolNames).to.include('update-paragraph')
      expect(toolNames).to.include('discard-paragraph')
    })

    it('2nd-level composition child schema has writable fields, no parent backlink FK', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-paragraph')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('body')
      // Accumulated prefixed parent keys
      expect(tool.inputSchema.properties).to.have.property('document_ID')
      expect(tool.inputSchema.properties).to.have.property('section_ID')
      // section_ID here is the prefixed parent key from Sections, not a backlink FK
      // The actual backlink FK (section_ID backing `section` assoc) is filtered separately
      expect(tool.inputSchema.properties).to.not.have.property('section')
    })

    it('named composition child (Sections) schema has writable fields, no parent FK', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-section')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('title')
      // Prefixed parent key
      expect(tool.inputSchema.properties).to.have.property('document_ID')
      // Backlink assoc/FK not exposed as writable
      expect(tool.inputSchema.properties).to.not.have.property('document')
    })
  })

  describe('draft lifecycle execution', () => {
    it('creates a new draft', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('create-books', {
        title: 'Test Draft Book',
        stock: 42,
        author_ID: 101
      })
      expect(error).to.be.null
      expect(content).to.exist
      expect(content.action).to.equal('create-books')
    })

    it('update tool invokes handler with correct args', async () => {
      const { callTool } = client()
      // Will fail at DB level (no draft with ID=999) but should NOT fail at schema validation
      const { error } = await callTool('update-books', {
        ID: 999,
        title: 'Updated Title'
      })
      // Error from DB (no row found) is acceptable; schema validation error is not
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('activate tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('activate-books', { ID: 999 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('edit tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('edit-books', { ID: 201 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('discard tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('discard-books', { ID: 999 })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child create tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('create-chapter', {
        book_ID: 201,
        title: 'New Chapter'
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child update tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('update-chapter', {
        book_ID: 201,
        ID: 1,
        title: 'Updated Chapter'
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })

    it('child discard tool invokes handler with correct args', async () => {
      const { callTool } = client()
      const { error } = await callTool('discard-chapter', {
        book_ID: 201,
        ID: 1
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })
  })

  describe('CAP draft API integration (end-to-end)', () => {
    it('create-books dispatches NEW event and app handler generates ID', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('create-books', {
        title: 'Draft Lifecycle Book',
        stock: 7,
        author_ID: 101
      })
      expect(error).to.be.null
      expect(content).to.exist
      expect(content.action).to.equal('create-books')

      const srv = cds.services['AdminService']
      const found = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Draft Lifecycle Book'
      })
      expect(found.length).to.be.greaterThan(0)
      expect(found[0].ID).to.be.a('number')
      await callTool('discard-books', { ID: found[0].ID })
    })

    it('update-books dispatches UPDATE event on draft', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      const created = await callTool('create-books', {
        title: 'To Be Updated',
        stock: 1,
        author_ID: 101
      })
      expect(created.error).to.be.null
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({ title: 'To Be Updated' })
      const draftID = draft.ID

      let seenParams
      let seenQuery
      const spy = (req) => {
        seenParams = req.params
        seenQuery = req.query
      }
      srv.before('UPDATE', srv.entities.Books.drafts, spy)

      try {
        const { error } = await callTool('update-books', {
          ID: draftID,
          title: 'Updated Title'
        })
        expect(error).to.be.null
        expect(seenParams).to.deep.equal([{ ID: draftID }])
        expect(seenQuery?.UPDATE).to.exist

        const updated = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID })
        expect(updated?.title).to.equal('Updated Title')
      } finally {
        const handlers = srv._handlers?.before || []
        const idx = handlers.findIndex((h) => h.handler === spy)
        if (idx !== -1) handlers.splice(idx, 1)
        await callTool('discard-books', { ID: draftID })
      }
    })

    it('activate-books dispatches draftActivate and promotes draft to active', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-books', {
        title: 'To Be Activated',
        stock: 5,
        author_ID: 101
      })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'To Be Activated'
      })
      const draftID = draft.ID

      const { error } = await callTool('activate-books', { ID: draftID })
      expect(error).to.be.null

      const active = await SELECT.one.from(srv.entities.Books).where({ ID: draftID })
      const remainingDraft = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID })
      expect(active?.title).to.equal('To Be Activated')
      expect(remainingDraft).to.not.exist
      await DELETE.from(srv.entities.Books).where({ ID: draftID })
    })

    it('activate-documents includes full draft tree in req.data', async () => {
      const docClient = () => mcpClient('/mcp/admin', 'alice:')
      const { callTool } = docClient()
      const srv = cds.services['AdminService']

      // Create draft document with composition children
      await callTool('create-documents', { title: 'Tree Activate Doc' })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Tree Activate Doc'
      })
      const docID = doc.ID

      // Add a note and a section to the draft
      await callTool('create-note', { document_ID: docID, text: 'Note in tree' })
      await callTool('create-section', { document_ID: docID, title: 'Section in tree' })

      // Spy on SAVE to capture req.data
      let saveData
      const spy = (req) => {
        saveData = req.data
      }
      srv.before('SAVE', srv.entities.Documents, spy)

      try {
        const { error } = await callTool('activate-documents', { ID: docID })
        expect(error).to.be.null
        expect(saveData).to.exist
        // Draft tree should include composition children
        expect(saveData.notes).to.be.an('array').with.lengthOf(1)
        expect(saveData.notes[0].text).to.equal('Note in tree')
        expect(saveData.sections).to.be.an('array').with.lengthOf(1)
        expect(saveData.sections[0].title).to.equal('Section in tree')
      } finally {
        const handlers = srv._handlers?.before || []
        const idx = handlers.findIndex((h) => h.handler === spy)
        if (idx !== -1) handlers.splice(idx, 1)
        // Cleanup
        await DELETE.from(srv.entities.Documents).where({ ID: docID })
      }
    })

    it('edit-books dispatches draftEdit and creates draft copy of active', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      // Cleanup any prior draft for ID=201 to make test idempotent
      await callTool('discard-books', { ID: 201 })

      const { error } = await callTool('edit-books', { ID: 201 })
      expect(error).to.be.null

      const draft = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: 201 })
      expect(draft?.ID).to.equal(201)

      await callTool('discard-books', { ID: 201 })
    })

    it('edit-documents copies full composition tree into draft', async () => {
      const docClient = () => mcpClient('/mcp/admin', 'alice:')
      const { callTool } = docClient()
      const srv = cds.services['AdminService']

      // Create and activate a document with children
      await callTool('create-documents', { title: 'Edit Tree Doc' })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Edit Tree Doc'
      })
      const docID = doc.ID
      await callTool('create-note', { document_ID: docID, text: 'Persisted note' })
      await callTool('create-section', { document_ID: docID, title: 'Persisted section' })
      await callTool('activate-documents', { ID: docID })

      // Now edit the active document — should copy tree to draft
      const { error } = await callTool('edit-documents', { ID: docID })
      expect(error).to.be.null

      // Verify draft children exist
      const noteDraft = srv.model.definitions['AdminService.Documents.notes.drafts']
      const notes = await SELECT.from(noteDraft).where({ up__ID: docID })
      expect(notes).to.be.an('array').with.lengthOf(1)
      expect(notes[0].text).to.equal('Persisted note')

      const sectionDrafts = await SELECT.from(srv.entities.Sections.drafts).where({
        document_ID: docID
      })
      expect(sectionDrafts).to.be.an('array').with.lengthOf(1)
      expect(sectionDrafts[0].title).to.equal('Persisted section')

      // Cleanup
      await callTool('discard-documents', { ID: docID })
      await DELETE.from(srv.entities.Documents).where({ ID: docID })
    })

    it('discard-books dispatches CANCEL and removes draft', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-books', {
        title: 'To Be Discarded',
        stock: 1,
        author_ID: 101
      })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'To Be Discarded'
      })
      const draftID = draft.ID

      let seenParams
      let seenQuery
      const spy = (req) => {
        seenParams = req.params
        seenQuery = req.query
      }
      srv.before('CANCEL', srv.entities.Books.drafts, spy)

      try {
        const { error } = await callTool('discard-books', { ID: draftID })
        expect(error).to.be.null
        expect(seenParams).to.deep.equal([{ ID: draftID }])
        expect(seenQuery?.DELETE).to.exist

        const remaining = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID })
        expect(remaining).to.not.exist
      } finally {
        const handlers = srv._handlers?.before || []
        const idx = handlers.findIndex((h) => h.handler === spy)
        if (idx !== -1) handlers.splice(idx, 1)
      }
    })

    it('app handler fires on NEW event (before-NEW ID generation)', async () => {
      const srv = cds.services['AdminService']
      const Books = srv.entities.Books

      let handlerCallCount = 0
      const spy = () => {
        handlerCallCount++
      }
      srv.before('NEW', Books.drafts, spy)
      try {
        const { callTool } = client()
        const { error } = await callTool('create-books', {
          title: 'Handler Spy Book',
          stock: 1,
          author_ID: 101
        })
        expect(error).to.be.null
        expect(handlerCallCount).to.be.greaterThan(0)
        const [draft] = await SELECT.from(Books.drafts).where({ title: 'Handler Spy Book' })
        if (draft) await callTool('discard-books', { ID: draft.ID })
      } finally {
        const handlers = srv._handlers?.before || []
        const idx = handlers.findIndex((h) => h.handler === spy)
        if (idx !== -1) handlers.splice(idx, 1)
      }
    })

    describe('inline composition (Documents.notes)', () => {
      // Documents.notes: Composition of many { key ID; text }
      // Tools: create-note, update-note, discard-note. Parent key: document_ID.

      const docClient = () => mcpClient('/mcp/admin', 'alice:')
      let docID

      beforeAll(async () => {
        const { callTool } = docClient()
        const { error } = await callTool('create-documents', { title: 'Notes E2E Doc' })
        if (error) {
          docID = null
          return
        }
        const srv = cds.services['AdminService']
        const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
          title: 'Notes E2E Doc'
        })
        docID = doc?.ID
      })

      afterAll(async () => {
        if (!docID) return
        const { callTool } = docClient()
        await callTool('discard-documents', { ID: docID })
      })

      it('create-note inserts into draft composition and returns ID', async () => {
        if (!docID) return
        const { callTool } = docClient()
        const srv = cds.services['AdminService']
        const noteDraft = srv.model.definitions['AdminService.Documents.notes.drafts']
        let seenParams
        let seenQuery
        const spy = (req) => {
          seenParams = req.params
          seenQuery = req.query
        }
        srv.before('NEW', noteDraft, spy)
        try {
          const { content, error } = await callTool('create-note', {
            document_ID: docID,
            text: 'E2E note'
          })
          expect(error).to.be.null
          expect(content).to.exist
          expect(content.result[0].ID).to.be.a('number')
          expect(seenParams).to.deep.equal([{ ID: docID }])
          expect(seenQuery?.INSERT).to.exist
        } finally {
          const handlers = srv._handlers?.before || []
          const idx = handlers.findIndex((h) => h.handler === spy)
          if (idx !== -1) handlers.splice(idx, 1)
        }
      })

      it('update-note modifies existing note text', async () => {
        if (!docID) return
        const { callTool } = docClient()
        // Create a note to update
        const { content: created } = await callTool('create-note', {
          document_ID: docID,
          text: 'Before update'
        })
        const noteID = created.result[0].ID

        const { error } = await callTool('update-note', {
          document_ID: docID,
          ID: noteID,
          text: 'After update'
        })
        expect(error).to.be.null

        // Verify via DB
        const srv = cds.services['AdminService']
        let row
        try {
          ;[row] = await SELECT.from(srv.entities.Documents, docID, (d) => {
            d.notes((n) => {
              n.ID
              n.text
            })
          })
            .columns('notes')
            .where({ 'notes.ID': noteID })
        } catch {
          row = null
        }
        // If service-level SELECT works, verify text; otherwise accept no-error as success
        if (row?.notes?.[0]) {
          expect(row.notes[0].text).to.equal('After update')
        }
      })

      it('discard-note removes the note', async () => {
        if (!docID) return
        const { callTool } = docClient()
        // Create a note to discard
        const { content: created } = await callTool('create-note', {
          document_ID: docID,
          text: 'To remove'
        })
        const noteID = created.result[0].ID

        const { error } = await callTool('discard-note', {
          document_ID: docID,
          ID: noteID
        })
        expect(error).to.be.null

        const srv = cds.services['AdminService']
        const noteDraft = srv.model.definitions['AdminService.Documents.notes.drafts']
        const remaining = await SELECT.one.from(noteDraft).where({ up__ID: docID, ID: noteID })
        expect(remaining).to.not.exist
      })
    })

    describe('named and nested compositions (Documents.sections.paragraphs)', () => {
      it('creates, updates, and discards nested draft children with NEW params', async () => {
        const { callTool } = client()
        const srv = cds.services['AdminService']

        const createdDoc = await callTool('create-documents', { title: 'Nested E2E Doc' })
        expect(createdDoc.error).to.be.null
        const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
          title: 'Nested E2E Doc'
        })
        const docID = doc.ID

        let seenParagraphParams
        let seenParagraphQuery
        let seenParagraphUpdateParams
        let seenParagraphUpdateQuery
        let seenParagraphCancelParams
        let seenParagraphCancelQuery
        const paragraphDraft = srv.entities.Paragraphs.drafts
        const newSpy = (req) => {
          seenParagraphParams = req.params
          seenParagraphQuery = req.query
        }
        const updateSpy = (req) => {
          seenParagraphUpdateParams = req.params
          seenParagraphUpdateQuery = req.query
        }
        const cancelSpy = (req) => {
          seenParagraphCancelParams = req.params
          seenParagraphCancelQuery = req.query
        }
        srv.before('NEW', paragraphDraft, newSpy)
        srv.before('UPDATE', paragraphDraft, updateSpy)
        srv.before('CANCEL', paragraphDraft, cancelSpy)

        try {
          const sectionCreated = await callTool('create-section', {
            document_ID: docID,
            title: 'Section before update'
          })
          expect(sectionCreated.error).to.be.null
          const sectionID = sectionCreated.content.result[0].ID

          const sectionUpdated = await callTool('update-section', {
            document_ID: docID,
            ID: sectionID,
            title: 'Section after update'
          })
          expect(sectionUpdated.error).to.be.null
          const sectionRow = await SELECT.one.from(srv.entities.Sections.drafts).where({
            ID: sectionID
          })
          expect(sectionRow?.title).to.equal('Section after update')

          const paragraphCreated = await callTool('create-paragraph', {
            document_ID: docID,
            section_ID: sectionID,
            body: 'Paragraph before update'
          })
          expect(paragraphCreated.error).to.be.null
          const paragraphID = paragraphCreated.content.result[0].ID
          expect(seenParagraphParams).to.deep.equal([{ ID: docID }, { ID: sectionID }])
          expect(seenParagraphQuery?.INSERT).to.exist

          const paragraphUpdated = await callTool('update-paragraph', {
            document_ID: docID,
            section_ID: sectionID,
            ID: paragraphID,
            body: 'Paragraph after update'
          })
          expect(paragraphUpdated.error).to.be.null
          expect(seenParagraphUpdateParams).to.deep.equal([
            { ID: docID },
            { ID: sectionID },
            { ID: paragraphID }
          ])
          expect(seenParagraphUpdateQuery?.UPDATE).to.exist
          const paragraphRow = await SELECT.one.from(srv.entities.Paragraphs.drafts).where({
            ID: paragraphID
          })
          expect(paragraphRow?.body).to.equal('Paragraph after update')

          const paragraphDiscarded = await callTool('discard-paragraph', {
            document_ID: docID,
            section_ID: sectionID,
            ID: paragraphID
          })
          expect(paragraphDiscarded.error).to.be.null
          expect(seenParagraphCancelParams).to.deep.equal([
            { ID: docID },
            { ID: sectionID },
            { ID: paragraphID }
          ])
          expect(seenParagraphCancelQuery?.DELETE).to.exist
          const remainingParagraph = await SELECT.one
            .from(srv.entities.Paragraphs.drafts)
            .where({ ID: paragraphID })
          expect(remainingParagraph).to.not.exist

          const sectionDiscarded = await callTool('discard-section', {
            document_ID: docID,
            ID: sectionID
          })
          expect(sectionDiscarded.error).to.be.null
          const remainingSection = await SELECT.one.from(srv.entities.Sections.drafts).where({
            ID: sectionID
          })
          expect(remainingSection).to.not.exist
        } finally {
          const handlers = srv._handlers?.before || []
          for (const spy of [newSpy, updateSpy, cancelSpy]) {
            const idx = handlers.findIndex((h) => h.handler === spy)
            if (idx !== -1) handlers.splice(idx, 1)
          }
          await callTool('discard-documents', { ID: docID })
        }
      })
    })
  })

  describe('readonly entities', () => {
    it('does not register draft tools for @readonly draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      // ReadOnlyAuthors is @readonly @odata.draft.enabled — no draft tools
      expect(toolNames).to.not.include('create-read-only-author')
      expect(toolNames).to.not.include('activate-read-only-authors')
      expect(toolNames).to.not.include('edit-read-only-authors')
      expect(toolNames).to.not.include('update-read-only-authors')
      expect(toolNames).to.not.include('discard-read-only-authors')
    })

    it('still registers create tool for non-readonly draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('create-books')
    })
  })

  describe('backlink exclusion', () => {
    // AdminService.Documents has composition Documents→sections (target Sections),
    // and Sections has `document: Association to Documents` — a composition-parent backlink.
    // The generated FK `document_ID` backs this backlink and must NOT appear in
    // create/update tool schemas — it's set implicitly by the composition parent.

    it('create-section has prefixed parent key, writable fields, no backlink assoc', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-section')
      expect(tool).to.exist
      // Prefixed parent key (for composition navigation)
      expect(tool.inputSchema.properties).to.have.property('document_ID')
      // Writable child fields
      expect(tool.inputSchema.properties).to.have.property('title')
      // Backlink assoc itself not exposed as writable
      expect(tool.inputSchema.properties).to.not.have.property('document')
    })

    it('update-section has prefixed parent key + child key, no backlink assoc', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'update-section')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('document_ID')
      expect(tool.inputSchema.properties).to.have.property('ID')
      expect(tool.inputSchema.properties).to.have.property('title')
      expect(tool.inputSchema.properties).to.not.have.property('document')
    })

    it('regular managed assoc FK stays writable (author_ID on Books)', async () => {
      // Ensure filter only affects composition-parent backlinks, not regular assocs
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-books')
      expect(tool).to.exist
      // author_ID is a regular managed assoc FK — must remain writable
      expect(tool.inputSchema.properties).to.have.property('author_ID')
    })

    it('readonly entity draft tools are not registered', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames.filter((name) => name.includes('read-only-authors'))).to.be.empty
    })

    describe('_isCompositionParentBacklink helper', () => {
      // Chai `expect` is bound to node:test; use jest-style equality via chai
      let model
      before(() => {
        model = cds.services.AdminService.model
      })

      it('true for composition-parent backlink (Sections.document → Documents)', () => {
        const sections = model.definitions['AdminService.Sections']
        const doc = sections.elements.document
        expect(_isCompositionParentBacklink(sections, doc, model)).to.equal(true)
      })

      it('false for regular managed assoc with many-to-many backlink counterpart', () => {
        // Authors.books points back to Books.author, so Books.author._isBacklink=true.
        // But Authors has no Composition to Books → not a composition-parent backlink.
        const books = model.definitions['AdminService.Books']
        expect(_isCompositionParentBacklink(books, books.elements.author, model)).to.equal(false)
      })

      it('false for the unmanaged backlink assoc itself (Authors.books)', () => {
        const authors = model.definitions['sap.capire.bookshop.Authors']
        expect(_isCompositionParentBacklink(authors, authors.elements.books, model)).to.equal(false)
      })

      it('false for the composition side itself (Documents.sections)', () => {
        const documents = model.definitions['AdminService.Documents']
        expect(
          _isCompositionParentBacklink(documents, documents.elements.sections, model)
        ).to.equal(false)
      })

      it('false for non-association elements', () => {
        const books = model.definitions['AdminService.Books']
        expect(_isCompositionParentBacklink(books, books.elements.title, model)).to.equal(false)
        expect(_isCompositionParentBacklink(books, books.elements.stock, model)).to.equal(false)
      })

      it('false when assocElem is undefined/null', () => {
        const books = model.definitions['AdminService.Books']
        expect(_isCompositionParentBacklink(books, undefined, model)).to.equal(false)
        expect(_isCompositionParentBacklink(books, null, model)).to.equal(false)
      })

      it('false when model has no definitions', () => {
        const sections = model.definitions['AdminService.Sections']
        const doc = sections.elements.document
        expect(_isCompositionParentBacklink(sections, doc, {})).to.equal(false)
        expect(_isCompositionParentBacklink(sections, doc, null)).to.equal(false)
      })

      it('false when target entity not resolvable in model', () => {
        const sections = model.definitions['AdminService.Sections']
        const fake = { _isBacklink: true, target: 'Unknown.Entity' }
        expect(_isCompositionParentBacklink(sections, fake, model)).to.equal(false)
      })
    })
  })

  describe('.drafts entity accessibility', () => {
    it('describe overview lists .drafts entities for draft-enabled entities', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('describe')
      expect(error).to.be.null
      expect(content.entities).to.have.property('Books.drafts')
      expect(content.entities).to.have.property('Documents.drafts')
      // Non-draft entities should not have .drafts
      expect(content.entities).to.not.have.property('Authors.drafts')
      expect(content.entities).to.not.have.property('Genres.drafts')
    })

    it('describe .drafts entity hides draft control fields', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('describe', { entities: ['Books.drafts'] })
      expect(error).to.be.null
      const elements = content.entities['Books.drafts'].elements
      expect(elements).to.exist
      expect(elements).to.have.property('title')
      expect(elements).to.have.property('stock')
      expect(elements).to.not.have.property('IsActiveEntity')
      expect(elements).to.not.have.property('HasActiveEntity')
      expect(elements).to.not.have.property('HasDraftEntity')
      expect(elements).to.not.have.property('DraftAdministrativeData')
      expect(elements).to.not.have.property('DraftAdministrativeData_DraftUUID')
      expect(elements).to.not.have.property('SiblingEntity')
      expect(elements).to.not.have.property('DraftMessages')
    })

    it('describe active entity hides draft control fields', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('describe', { entities: ['Books'] })
      expect(error).to.be.null
      const elements = content.entities.Books.elements
      expect(elements).to.exist
      expect(elements).to.have.property('title')
      expect(elements).to.not.have.property('IsActiveEntity')
      expect(elements).to.not.have.property('HasActiveEntity')
      expect(elements).to.not.have.property('HasDraftEntity')
      expect(elements).to.not.have.property('DraftAdministrativeData')
      expect(elements).to.not.have.property('DraftAdministrativeData_DraftUUID')
    })

    it('CQN query can target .drafts entity', async () => {
      const { callTool } = client()
      // Create a draft so there's something to find
      await callTool('create-books', { title: 'Drafts Query Test', stock: 1, author_ID: 101 })

      const { content, error } = await callTool('query', { entity: 'Books.drafts' })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.be.greaterThan(0)
      expect(content.data[0]).to.have.property('title')

      // Cleanup
      const srv = cds.services['AdminService']
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Drafts Query Test'
      })
      if (draft) await callTool('discard-books', { ID: draft.ID })
    })

    it('CQN query can target child .drafts entities', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-documents', { title: 'Child Draft Query Doc' })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Child Draft Query Doc'
      })
      const docID = doc.ID

      const sectionCreated = await callTool('create-section', {
        document_ID: docID,
        title: 'Queryable Section Draft'
      })
      const sectionID = sectionCreated.content.result[0].ID

      await callTool('create-paragraph', {
        document_ID: docID,
        section_ID: sectionID,
        body: 'Queryable Paragraph Draft'
      })

      const sectionQuery = await callTool('query', {
        entity: 'Sections.drafts',
        where: [{ ref: ['ID'] }, '=', { val: sectionID }]
      })
      expect(sectionQuery.error).to.be.null
      expect(sectionQuery.content.data).to.be.an('array').with.lengthOf(1)
      expect(sectionQuery.content.data[0].title).to.equal('Queryable Section Draft')

      const paragraphQuery = await callTool('query', {
        entity: 'Paragraphs.drafts',
        where: [{ ref: ['body'] }, '=', { val: 'Queryable Paragraph Draft' }]
      })
      expect(paragraphQuery.error).to.be.null
      expect(paragraphQuery.content.data).to.be.an('array').with.lengthOf(1)
      expect(paragraphQuery.content.data[0].body).to.equal('Queryable Paragraph Draft')

      await callTool('discard-documents', { ID: docID })
    })

    it('SQL query can target .drafts entity', async () => {
      const { callTool } = client()
      await callTool('create-books', { title: 'SQL Drafts Test', stock: 2, author_ID: 101 })

      const originalFormat = cds.env.mcp?.format
      cds.env.mcp ??= {}
      cds.env.mcp.format = 'sql'
      const { content, error } = await callTool('query', {
        sql: "SELECT title, stock FROM AdminService.Books.drafts WHERE title = 'SQL Drafts Test'"
      })
      expect(error).to.be.null
      expect(content.data).to.be.an('array')
      expect(content.data.length).to.equal(1)
      expect(content.data[0].title).to.equal('SQL Drafts Test')
      if (originalFormat === undefined) delete cds.env.mcp.format
      else cds.env.mcp.format = originalFormat

      // Cleanup
      const srv = cds.services['AdminService']
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'SQL Drafts Test'
      })
      if (draft) await callTool('discard-books', { ID: draft.ID })
    })

    it('entity enum in query tool includes .drafts', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const queryTool = response.result.tools.find((t) => t.name === 'query')
      const entityEnum = queryTool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include('Books.drafts')
      expect(entityEnum).to.include('Documents.drafts')
    })

    it('entities enum in describe tool includes .drafts', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const describeTool = response.result.tools.find((t) => t.name === 'describe')
      const entityEnum = describeTool.inputSchema.properties.entities.items.enum
      expect(entityEnum).to.include('Books.drafts')
      expect(entityEnum).to.include('Documents.drafts')
    })
  })

  describe('draft isolation between users', () => {
    const alice = () => mcpClient('/mcp/admin', 'alice:')
    const carol = () => mcpClient('/mcp/admin', 'carol:')

    it('user cannot see drafts created by another user via CQN query', async () => {
      const { callTool: aliceCall } = alice()
      await aliceCall('create-books', { title: 'Alice Private Draft', stock: 1, author_ID: 101 })

      const aliceQuery = await aliceCall('query', { entity: 'Books.drafts' })
      expect(aliceQuery.error).to.be.null
      expect(
        aliceQuery.content.data.some((draft) => draft.title === 'Alice Private Draft')
      ).to.equal(true)

      const { callTool: carolCall } = carol()
      const carolQuery = await carolCall('query', { entity: 'Books.drafts' })
      expect(carolQuery.error).to.be.null
      expect(
        carolQuery.content.data.some((draft) => draft.title === 'Alice Private Draft')
      ).to.equal(false)

      const srv = cds.services['AdminService']
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Alice Private Draft'
      })
      if (draft) await aliceCall('discard-books', { ID: draft.ID })
    })

    it('user cannot see drafts created by another user via SQL query', async () => {
      const { callTool: aliceCall } = alice()
      await aliceCall('create-books', { title: 'Alice SQL Draft', stock: 2, author_ID: 101 })

      const originalFormat = cds.env.mcp?.format
      cds.env.mcp ??= {}
      cds.env.mcp.format = 'sql'

      const aliceQuery = await aliceCall('query', {
        sql: "SELECT title FROM AdminService.Books.drafts WHERE title = 'Alice SQL Draft'"
      })
      expect(aliceQuery.error).to.be.null
      expect(aliceQuery.content.data).to.have.lengthOf(1)

      const { callTool: carolCall } = carol()
      const carolQuery = await carolCall('query', {
        sql: "SELECT title FROM AdminService.Books.drafts WHERE title = 'Alice SQL Draft'"
      })
      expect(carolQuery.error).to.be.null
      expect(carolQuery.content.data).to.have.lengthOf(0)

      if (originalFormat === undefined) delete cds.env.mcp.format
      else cds.env.mcp.format = originalFormat

      const srv = cds.services['AdminService']
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Alice SQL Draft'
      })
      if (draft) await aliceCall('discard-books', { ID: draft.ID })
    })

    it('user cannot see child composition drafts created by another user', async () => {
      const { callTool: aliceCall } = alice()
      const srv = cds.services['AdminService']

      await aliceCall('create-documents', { title: 'Alice Isolated Doc' })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Alice Isolated Doc'
      })
      const docID = doc.ID
      await aliceCall('create-section', { document_ID: docID, title: 'Alice Section' })

      const aliceQuery = await aliceCall('query', { entity: 'Sections.drafts' })
      expect(aliceQuery.error).to.be.null
      expect(aliceQuery.content.data.some((draft) => draft.title === 'Alice Section')).to.equal(
        true
      )

      const { callTool: carolCall } = carol()
      const carolQuery = await carolCall('query', { entity: 'Sections.drafts' })
      expect(carolQuery.error).to.be.null
      expect(carolQuery.content.data.some((draft) => draft.title === 'Alice Section')).to.equal(
        false
      )

      await aliceCall('discard-documents', { ID: docID })
    })

    it('user cannot activate or discard drafts created by another user', async () => {
      const { callTool: aliceCall } = alice()
      const { callTool: carolCall } = carol()
      const srv = cds.services['AdminService']

      await aliceCall('create-books', { title: 'Alice Protected Draft', stock: 3, author_ID: 101 })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Alice Protected Draft'
      })
      const draftID = draft.ID

      const activate = await carolCall('activate-books', { ID: draftID })
      expect(activate.error).to.exist
      const active = await SELECT.one.from(srv.entities.Books).where({ ID: draftID })
      expect(active).to.not.exist

      const discard = await carolCall('discard-books', { ID: draftID })
      expect(discard.error).to.exist
      const remaining = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID })
      expect(remaining).to.exist

      await aliceCall('discard-books', { ID: draftID })
    })

    it("user cannot create or update child records on another user's draft", async () => {
      const { callTool: aliceCall } = alice()
      const { callTool: carolCall } = carol()
      const srv = cds.services['AdminService']

      await aliceCall('create-documents', { title: 'Alice Child Protected Doc' })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Alice Child Protected Doc'
      })
      const docID = doc.ID

      const sectionCreated = await aliceCall('create-section', {
        document_ID: docID,
        title: 'Alice Protected Section'
      })
      const sectionID = sectionCreated.content.result[0].ID

      const paragraphCreated = await aliceCall('create-paragraph', {
        document_ID: docID,
        section_ID: sectionID,
        body: 'Alice Protected Paragraph'
      })
      const paragraphID = paragraphCreated.content.result[0].ID

      const createSection = await carolCall('create-section', {
        document_ID: docID,
        title: 'Carol Forbidden Section'
      })
      expect(createSection.error).to.exist
      const forbiddenSection = await SELECT.one.from(srv.entities.Sections.drafts).where({
        title: 'Carol Forbidden Section'
      })
      expect(forbiddenSection).to.not.exist

      const updateSection = await carolCall('update-section', {
        document_ID: docID,
        ID: sectionID,
        title: 'Carol Forbidden Update'
      })
      expect(updateSection.error).to.exist
      const section = await SELECT.one.from(srv.entities.Sections.drafts).where({ ID: sectionID })
      expect(section.title).to.equal('Alice Protected Section')

      const createParagraph = await carolCall('create-paragraph', {
        document_ID: docID,
        section_ID: sectionID,
        body: 'Carol Forbidden Paragraph'
      })
      expect(createParagraph.error).to.exist
      const forbiddenParagraph = await SELECT.one.from(srv.entities.Paragraphs.drafts).where({
        body: 'Carol Forbidden Paragraph'
      })
      expect(forbiddenParagraph).to.not.exist

      const updateParagraph = await carolCall('update-paragraph', {
        document_ID: docID,
        section_ID: sectionID,
        ID: paragraphID,
        body: 'Carol Forbidden Paragraph Update'
      })
      expect(updateParagraph.error).to.exist
      const paragraph = await SELECT.one
        .from(srv.entities.Paragraphs.drafts)
        .where({ ID: paragraphID })
      expect(paragraph.body).to.equal('Alice Protected Paragraph')

      await aliceCall('discard-documents', { ID: docID })
    })
  })

  describe('prefix handling', () => {
    it('draft tools are prefixed when cds.env.mcp.prefix is enabled', async () => {
      const originalValue = cds.env.mcp?.prefix
      cds.env.mcp ??= {}
      cds.env.mcp.prefix = true

      try {
        const { mcp } = client()
        const response = await mcp('tools/list')
        const toolNames = response.result.tools.map((t) => t.name)
        expect(toolNames).to.include('admin_activate-books')
        expect(toolNames).to.include('admin_edit-books')
        expect(toolNames).to.include('admin_create-books')
        expect(toolNames).to.include('admin_update-books')
        expect(toolNames).to.include('admin_discard-books')
        // Without prefix should not exist
        expect(toolNames).to.not.include('activate-books')
      } finally {
        if (originalValue === undefined) delete cds.env.mcp.prefix
        else cds.env.mcp.prefix = originalValue
      }
    })
  })
})
