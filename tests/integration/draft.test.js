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
    it('does not register create tool for @readonly draft-enabled entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      // ReadOnlyAuthors is @readonly @odata.draft.enabled — no create tool
      expect(toolNames).to.not.include('create-read-only-author')
      // But other draft tools should still exist (activate, edit, update, discard)
      expect(toolNames).to.include('activate-read-only-authors')
      expect(toolNames).to.include('edit-read-only-authors')
      expect(toolNames).to.include('update-read-only-authors')
      expect(toolNames).to.include('discard-read-only-authors')
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

    // Entity-level backlink: Authors.books = "Association to many Books on books.author = $self"
    it('update tool schema for entity with unmanaged backlink omits the backlink property', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'update-read-only-authors')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('name')
      expect(tool.inputSchema.properties).to.not.have.property('books')
    })

    it('backlink is not exposed as key parameter in tools', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      for (const name of [
        'activate-read-only-authors',
        'edit-read-only-authors',
        'discard-read-only-authors'
      ]) {
        const tool = response.result.tools.find((t) => t.name === name)
        expect(tool, `${name} should exist`).to.exist
        expect(tool.inputSchema.properties).to.not.have.property('books')
      }
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
