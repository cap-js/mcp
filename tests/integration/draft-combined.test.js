const cds = require('@sap/cds')
cds.env.mcp ??= {}
cds.env.mcp.draft = true
// per_action_tool NOT set → combined mode (default)
const test = cds.test(__dirname + '/../bookshop')
const { expect } = test
const mcpClient = require('./mcp-test-client')(test)

describe('Draft Combined Tools (entity-independent)', () => {
  const client = () => mcpClient('/mcp/admin', 'alice:')

  describe('tools/list', () => {
    it('registers 5 combined draft tools', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.include('activate-draft')
      expect(toolNames).to.include('edit-draft')
      expect(toolNames).to.include('create-draft')
      expect(toolNames).to.include('update-draft')
      expect(toolNames).to.include('discard-draft')
    })

    it('does NOT register per-entity draft tools', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const toolNames = response.result.tools.map((t) => t.name)
      expect(toolNames).to.not.include('activate-books')
      expect(toolNames).to.not.include('edit-books')
      expect(toolNames).to.not.include('create-books')
      expect(toolNames).to.not.include('update-books')
      expect(toolNames).to.not.include('discard-books')
      expect(toolNames).to.not.include('create-chapter')
    })

    it('activate-draft has entity enum with Books and Documents', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-draft')
      expect(tool).to.exist
      const entityProp = tool.inputSchema.properties.entity
      expect(entityProp).to.exist
      expect(entityProp.enum).to.include('Books')
      expect(entityProp.enum).to.include('Documents')
    })

    it('activate-draft has keys and data passthrough params', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-draft')
      expect(tool.inputSchema.properties).to.have.property('keys')
      expect(tool.inputSchema.properties).to.have.property('data')
    })

    it('activate-draft is flagged with _meta.requiresHITL', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-draft')
      expect(tool._meta).to.exist
      expect(tool._meta.requiresHITL).to.equal(true)
    })

    it('non-activate combined tools do not carry requiresHITL', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      for (const name of ['edit-draft', 'create-draft', 'update-draft', 'discard-draft']) {
        const tool = response.result.tools.find((t) => t.name === name)
        expect(tool._meta?.requiresHITL).to.not.equal(true)
      }
    })

    it('create-draft entity enum excludes @readonly entities', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-draft')
      const entityEnum = tool.inputSchema.properties.entity.enum
      expect(entityEnum).to.not.include('ReadOnlyAuthors')
    })

    it('create-draft entity enum includes composition children', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'create-draft')
      const entityEnum = tool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include('Books.chapters')
      expect(entityEnum).to.include('Documents.notes')
      expect(entityEnum).to.include('Documents.sections')
      expect(entityEnum).to.include('Documents.sections.paragraphs')
    })

    it('discard-draft entity enum includes nested composition children', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'discard-draft')
      const entityEnum = tool.inputSchema.properties.entity.enum
      expect(entityEnum).to.include('Documents.sections.paragraphs')
    })

    it('description lists entities with required/optional fields', async () => {
      const { mcp } = client()
      const response = await mcp('tools/list')
      const tool = response.result.tools.find((t) => t.name === 'activate-draft')
      expect(tool.description).to.include('Books {')
      expect(tool.description).to.include('Documents {')
      expect(tool.description).to.include('required:')
    })
  })

  describe('draft lifecycle execution', () => {
    it('create-draft creates a new draft for root entity', async () => {
      const { callTool } = client()
      const { content, error } = await callTool('create-draft', {
        entity: 'Books',
        data: { title: 'Combined Draft Book', stock: 42, author_ID: 101 }
      })
      expect(error).to.be.null
      expect(content).to.exist
      expect(content.entity).to.equal('Books')

      // Cleanup
      const srv = cds.services['AdminService']
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'Combined Draft Book'
      })
      if (draft) await callTool('discard-draft', { entity: 'Books', keys: { ID: draft.ID } })
    })

    it('update-draft updates a draft', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', {
        entity: 'Books',
        data: { title: 'To Update Combined', stock: 1, author_ID: 101 }
      })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'To Update Combined'
      })

      const { error } = await callTool('update-draft', {
        entity: 'Books',
        keys: { ID: draft.ID },
        data: { title: 'Updated Combined' }
      })
      expect(error).to.be.null

      const updated = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draft.ID })
      expect(updated?.title).to.equal('Updated Combined')
      await callTool('discard-draft', { entity: 'Books', keys: { ID: draft.ID } })
    })

    it('activate-draft activates a draft', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', {
        entity: 'Books',
        data: { title: 'To Activate Combined', stock: 5, author_ID: 101 }
      })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'To Activate Combined'
      })
      const draftID = draft.ID

      const { error } = await callTool('activate-draft', { entity: 'Books', keys: { ID: draftID } })
      expect(error).to.be.null

      const active = await SELECT.one.from(srv.entities.Books).where({ ID: draftID })
      expect(active?.title).to.equal('To Activate Combined')
      await DELETE.from(srv.entities.Books).where({ ID: draftID })
    })

    it('edit-draft puts active entity into edit mode', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      // Cleanup any prior draft for ID=201
      await callTool('discard-draft', { entity: 'Books', keys: { ID: 201 } })

      const { error } = await callTool('edit-draft', { entity: 'Books', keys: { ID: 201 } })
      expect(error).to.be.null

      const draft = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: 201 })
      expect(draft?.ID).to.equal(201)

      await callTool('discard-draft', { entity: 'Books', keys: { ID: 201 } })
    })

    it('discard-draft removes a draft', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', {
        entity: 'Books',
        data: { title: 'To Discard Combined', stock: 1, author_ID: 101 }
      })
      const [draft] = await SELECT.from(srv.entities.Books.drafts).where({
        title: 'To Discard Combined'
      })
      const draftID = draft.ID

      const { error } = await callTool('discard-draft', { entity: 'Books', keys: { ID: draftID } })
      expect(error).to.be.null

      const remaining = await SELECT.one.from(srv.entities.Books.drafts).where({ ID: draftID })
      expect(remaining).to.not.exist
    })
  })

  describe('composition children', () => {
    it('create-draft creates composition child', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', { entity: 'Documents', data: { title: 'Combined Child Doc' } })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Combined Child Doc'
      })
      const docID = doc.ID

      const { content, error } = await callTool('create-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID },
        data: { title: 'Combined Section' }
      })
      expect(error).to.be.null
      expect(content.result[0].ID).to.be.a('number')

      await callTool('discard-draft', { entity: 'Documents', keys: { ID: docID } })
    })

    it('update-draft updates composition child', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', { entity: 'Documents', data: { title: 'Update Child Doc' } })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Update Child Doc'
      })
      const docID = doc.ID

      const created = await callTool('create-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID },
        data: { title: 'Before Update' }
      })
      const sectionID = created.content.result[0].ID

      const { error } = await callTool('update-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID, ID: sectionID },
        data: { title: 'After Update' }
      })
      expect(error).to.be.null

      const section = await SELECT.one.from(srv.entities.Sections.drafts).where({ ID: sectionID })
      expect(section?.title).to.equal('After Update')

      await callTool('discard-draft', { entity: 'Documents', keys: { ID: docID } })
    })

    it('discard-draft discards composition child', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', { entity: 'Documents', data: { title: 'Discard Child Doc' } })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Discard Child Doc'
      })
      const docID = doc.ID

      const created = await callTool('create-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID },
        data: { title: 'To Remove' }
      })
      const sectionID = created.content.result[0].ID

      const { error } = await callTool('discard-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID, ID: sectionID }
      })
      expect(error).to.be.null

      const remaining = await SELECT.one.from(srv.entities.Sections.drafts).where({
        ID: sectionID
      })
      expect(remaining).to.not.exist

      await callTool('discard-draft', { entity: 'Documents', keys: { ID: docID } })
    })

    it('nested composition child (paragraphs) works end-to-end', async () => {
      const { callTool } = client()
      const srv = cds.services['AdminService']

      await callTool('create-draft', {
        entity: 'Documents',
        data: { title: 'Nested Combined Doc' }
      })
      const [doc] = await SELECT.from(srv.entities.Documents.drafts).where({
        title: 'Nested Combined Doc'
      })
      const docID = doc.ID

      const sectionCreated = await callTool('create-draft', {
        entity: 'Documents.sections',
        keys: { document_ID: docID },
        data: { title: 'Nested Section' }
      })
      const sectionID = sectionCreated.content.result[0].ID

      const paragraphCreated = await callTool('create-draft', {
        entity: 'Documents.sections.paragraphs',
        keys: { document_ID: docID, section_ID: sectionID },
        data: { body: 'Nested Paragraph' }
      })
      expect(paragraphCreated.error).to.be.null
      const paragraphID = paragraphCreated.content.result[0].ID

      const { error: updateErr } = await callTool('update-draft', {
        entity: 'Documents.sections.paragraphs',
        keys: { document_ID: docID, section_ID: sectionID, ID: paragraphID },
        data: { body: 'Updated Paragraph' }
      })
      expect(updateErr).to.be.null

      const paragraph = await SELECT.one.from(srv.entities.Paragraphs.drafts).where({
        ID: paragraphID
      })
      expect(paragraph?.body).to.equal('Updated Paragraph')

      const { error: discardErr } = await callTool('discard-draft', {
        entity: 'Documents.sections.paragraphs',
        keys: { document_ID: docID, section_ID: sectionID, ID: paragraphID }
      })
      expect(discardErr).to.be.null

      await callTool('discard-draft', { entity: 'Documents', keys: { ID: docID } })
    })
  })

  describe('prefix handling', () => {
    it('combined draft tools are prefixed when cds.env.mcp.prefix is enabled', async () => {
      const originalValue = cds.env.mcp?.prefix
      cds.env.mcp ??= {}
      cds.env.mcp.prefix = true

      try {
        const { mcp } = client()
        const response = await mcp('tools/list')
        const toolNames = response.result.tools.map((t) => t.name)
        expect(toolNames).to.include('admin_activate-draft')
        expect(toolNames).to.include('admin_edit-draft')
        expect(toolNames).to.include('admin_create-draft')
        expect(toolNames).to.include('admin_update-draft')
        expect(toolNames).to.include('admin_discard-draft')
        expect(toolNames).to.not.include('activate-draft')
      } finally {
        if (originalValue === undefined) delete cds.env.mcp.prefix
        else cds.env.mcp.prefix = originalValue
      }
    })
  })

  describe('unknown entity handling', () => {
    it('returns error for unknown entity', async () => {
      const { callTool } = client()
      const { error } = await callTool('activate-draft', {
        entity: 'NonExistent',
        keys: { ID: 1 }
      })
      expect(error).to.exist
    })
  })
})
