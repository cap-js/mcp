const cds = require('@sap/cds')
const express = require('express')
const { mount } = require('../../lib/ui')

describe('production UI availability', () => {
  it('does not mount the UI or advertise it under the production profile', () => {
    const profiles = cds.env.profiles
    profiles.push('production')
    try {
      const router = express.Router()
      const srv = {}
      const use = vi.spyOn(router, 'use')
      mount(router, srv)
      expect(use).not.toHaveBeenCalled()
      expect(srv.$linkProviders[0](undefined, { kind: 'mcp', path: '/mcp' })).toBeUndefined()
      expect(srv.$linkProviders[0]('Books', { kind: 'mcp', path: '/mcp' })).toMatchObject({
        group: 'primary',
        href: null
      })
    } finally {
      profiles.pop()
    }
  })
})
