const { validateCqnTargets } = require('../../lib/utils/validate-targets')

const ALLOWED = ['Books', 'Genres', 'Authors']
const SERVICE = 'CatalogService'

describe('validateCqnTargets', () => {

  describe('FROM — simple ref', () => {
    it('allows entity in service (local name)', () => {
      const cqn = { SELECT: { from: { ref: ['Books'] } } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('allows entity in service (qualified name)', () => {
      const cqn = { SELECT: { from: { ref: ['CatalogService.Books'] } } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('rejects entity from another service', () => {
      const cqn = { SELECT: { from: { ref: ['AdminService.Users'] } } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('AdminService.Users')
    })

    it('rejects raw DB entity', () => {
      const cqn = { SELECT: { from: { ref: ['sap.capire.bookshop.Authors'] } } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('sap.capire.bookshop.Authors')
    })
  })

  describe('FROM — JOIN', () => {
    it('allows JOIN with both entities in service', () => {
      const cqn = { SELECT: { from: {
        join: 'inner',
        args: [
          { ref: ['CatalogService.Books'], as: 'b' },
          { ref: ['CatalogService.Genres'], as: 'g' }
        ],
        on: [{ ref: ['b', 'genre_ID'] }, '=', { ref: ['g', 'ID'] }]
      } } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('rejects JOIN when one entity is from another service', () => {
      const cqn = { SELECT: { from: {
        join: 'inner',
        args: [
          { ref: ['CatalogService.Books'], as: 'b' },
          { ref: ['AdminService.Authors'], as: 'a' }
        ],
        on: [{ ref: ['b', 'author_ID'] }, '=', { ref: ['a', 'ID'] }]
      } } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('AdminService.Authors')
    })

    it('rejects LEFT JOIN with external entity', () => {
      const cqn = { SELECT: { from: {
        join: 'left',
        args: [
          { ref: ['Books'], as: 'b' },
          { ref: ['OtherService.Stuff'], as: 's' }
        ],
        on: [{ ref: ['b', 'ID'] }, '=', { ref: ['s', 'ID'] }]
      } } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('OtherService.Stuff')
    })
  })

  describe('FROM — UNION / SET', () => {
    it('allows UNION of same-service entities', () => {
      const cqn = { SELECT: { from: {
        SET: { op: 'union', all: true, args: [
          { SELECT: { from: { ref: ['CatalogService.Books'] }, columns: [{ ref: ['ID'] }] } },
          { SELECT: { from: { ref: ['CatalogService.Genres'] }, columns: [{ ref: ['ID'] }] } }
        ] }
      } } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('rejects UNION with external entity', () => {
      const cqn = { SELECT: { from: {
        SET: { op: 'union', all: true, args: [
          { SELECT: { from: { ref: ['CatalogService.Books'] }, columns: [{ ref: ['ID'] }] } },
          { SELECT: { from: { ref: ['AdminService.Authors'] }, columns: [{ ref: ['ID'] }] } }
        ] }
      } } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('AdminService.Authors')
    })
  })

  describe('WHERE — subselect', () => {
    it('allows subselect from same service', () => {
      const cqn = { SELECT: {
        from: { ref: ['CatalogService.Books'] },
        where: [
          { ref: ['genre_ID'] }, 'in',
          { SELECT: { from: { ref: ['CatalogService.Genres'] }, columns: [{ ref: ['ID'] }] } }
        ]
      } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('rejects subselect from another service', () => {
      const cqn = { SELECT: {
        from: { ref: ['CatalogService.Books'] },
        where: [
          { ref: ['author_ID'] }, 'in',
          { SELECT: { from: { ref: ['AdminService.Authors'] }, columns: [{ ref: ['ID'] }] } }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('AdminService.Authors')
    })

    it('rejects deeply nested subselect', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        where: [
          { ref: ['ID'] }, 'in',
          { SELECT: {
            from: { ref: ['Genres'] },
            where: [
              { ref: ['ID'] }, 'in',
              { SELECT: { from: { ref: ['Evil.Service.Hack'] }, columns: [{ ref: ['ID'] }] } }
            ]
          } }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Evil.Service.Hack')
    })
  })

  describe('columns — subselect and expand', () => {
    it('rejects subselect in columns', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        columns: [
          { ref: ['ID'] },
          { SELECT: { from: { ref: ['OtherService.Secret'] }, columns: [{ ref: ['data'] }] } }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('OtherService.Secret')
    })

    it('allows expand with no subselect', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        columns: [
          { ref: ['ID'] },
          { ref: ['genre'], expand: [{ ref: ['name'] }, { ref: ['ID'] }] }
        ]
      } }
      expect(validateCqnTargets(cqn, ALLOWED, SERVICE)).toEqual({ valid: true })
    })

    it('rejects subselect nested in expand', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        columns: [
          { ref: ['genre'], expand: [
            { ref: ['name'] },
            { SELECT: { from: { ref: ['Hacker.Entity'] }, columns: [{ ref: ['x'] }] } }
          ] }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Hacker.Entity')
    })

    it('rejects deeply nested expand with subselect', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        columns: [
          { ref: ['genre'], expand: [
            { ref: ['children'], expand: [
              { SELECT: { from: { ref: ['Evil.Deep'] }, columns: [{ ref: ['x'] }] } }
            ] }
          ] }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Evil.Deep')
    })
  })

  describe('having — subselect', () => {
    it('rejects subselect in having', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        having: [
          { func: 'count', args: ['*'] }, '>',
          { SELECT: { from: { ref: ['Other.Counts'] }, columns: [{ ref: ['n'] }] } }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Other.Counts')
    })
  })

  describe('xpr — nested expressions', () => {
    it('rejects subselect inside xpr in where', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        where: [
          { xpr: [
            { ref: ['ID'] }, 'in',
            { SELECT: { from: { ref: ['Bad.Entity'] }, columns: [{ ref: ['ID'] }] } }
          ] }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Bad.Entity')
    })
  })

  describe('function args', () => {
    it('rejects subselect in function args', () => {
      const cqn = { SELECT: {
        from: { ref: ['Books'] },
        columns: [
          { func: 'coalesce', args: [
            { ref: ['title'] },
            { SELECT: { from: { ref: ['Ext.Defaults'] }, columns: [{ ref: ['val'] }] } }
          ] }
        ]
      } }
      const result = validateCqnTargets(cqn, ALLOWED, SERVICE)
      expect(result.valid).toBe(false)
      expect(result.entity).toBe('Ext.Defaults')
    })
  })
})
