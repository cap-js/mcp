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
      // Should have parent key (Books.ID)
      expect(tool.inputSchema.properties).to.have.property('ID')
      // Should have writable child fields
      expect(tool.inputSchema.properties).to.have.property('title')
      // Should NOT have draft elements
      expect(tool.inputSchema.properties).to.not.have.property('IsActiveEntity')
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
        ID: 201,
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
        ID: 201,
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
        ID: 201
      })
      if (error) {
        expect(error).to.not.include('validation')
        expect(error).to.not.include('Invalid arguments')
      }
    })
  })

  describe('CAP draft API integration (end-to-end)', () => {
    // Run privileged reads bypassing auth (test asserts on DB state, not permissions)
    const asAdmin = (fn) =>
      cds.tx({ user: new cds.User({ id: 'alice', roles: ['admin'] }) }, async (tx) => fn(tx))

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
      const found = await asAdmin((tx) =>
        tx.run(SELECT.from(srv.entities.Books.drafts).where({ title: 'Draft Lifecycle Book' }))
      )
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
      const [draft] = await asAdmin((tx) =>
        tx.run(SELECT.from(srv.entities.Books.drafts).where({ title: 'To Be Updated' }))
      )
      const draftID = draft.ID

      const { error } = await callTool('update-books', {
        ID: draftID,
        title: 'Updated Title'
      })
      expect(error).to.be.null

      const updated = await asAdmin((tx) =>
        tx.run(SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID }))
      )
      expect(updated?.title).to.equal('Updated Title')
      await callTool('discard-books', { ID: draftID })
    })

    it('activate-books dispatches draftActivate and promotes draft to active', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-books', {
        title: 'To Be Activated',
        stock: 5,
        author_ID: 101
      })
      const [draft] = await asAdmin((tx) =>
        tx.run(SELECT.from(srv.entities.Books.drafts).where({ title: 'To Be Activated' }))
      )
      const draftID = draft.ID

      const { error } = await callTool('activate-books', { ID: draftID })
      expect(error).to.be.null

      const active = await asAdmin((tx) =>
        tx.run(SELECT.one.from(srv.entities.Books).where({ ID: draftID }))
      )
      const remainingDraft = await asAdmin((tx) =>
        tx.run(SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID }))
      )
      expect(active?.title).to.equal('To Be Activated')
      expect(remainingDraft).to.not.exist
      await asAdmin((tx) => tx.run(DELETE.from(srv.entities.Books).where({ ID: draftID })))
    })

    it('edit-books dispatches draftEdit and creates draft copy of active', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      // Cleanup any prior draft for ID=201 to make test idempotent
      await callTool('discard-books', { ID: 201 })

      const { error } = await callTool('edit-books', { ID: 201 })
      expect(error).to.be.null

      const draft = await asAdmin((tx) =>
        tx.run(SELECT.one.from(srv.entities.Books.drafts).where({ ID: 201 }))
      )
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
      const [draft] = await asAdmin((tx) =>
        tx.run(SELECT.from(srv.entities.Books.drafts).where({ title: 'To Be Discarded' }))
      )
      const draftID = draft.ID

      const { error } = await callTool('discard-books', { ID: draftID })
      expect(error).to.be.null

      const remaining = await asAdmin((tx) =>
        tx.run(SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID }))
      )
      expect(remaining).to.not.exist
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
        const [draft] = await asAdmin((tx) =>
          tx.run(SELECT.from(Books.drafts).where({ title: 'Handler Spy Book' }))
        )
        if (draft) await callTool('discard-books', { ID: draft.ID })
      } finally {
        const handlers = srv._handlers?.before || []
        const idx = handlers.findIndex((h) => h.handler === spy)
        if (idx !== -1) handlers.splice(idx, 1)
      }
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

    it('create-section schema omits document_ID FK (composition-parent backlink)', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-section')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('title')
      // Parent key from Documents present for composition navigation
      expect(tool.inputSchema.properties).to.have.property('ID')
      // Backlink FK `document_ID` must NOT be exposed
      expect(tool.inputSchema.properties).to.not.have.property('document_ID')
      // The assoc itself (document) also not writable (filtered as Association type)
      expect(tool.inputSchema.properties).to.not.have.property('document')
    })

    it('update-section schema omits document_ID FK (composition-parent backlink)', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'update-section')
      expect(tool).to.exist
      expect(tool.inputSchema.properties).to.have.property('title')
      expect(tool.inputSchema.properties).to.not.have.property('document_ID')
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
        expect(_isCompositionParentBacklink(authors, authors.elements.books, model)).to.equal(
          false
        )
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
