const { singular4, singularKebab } = require('../../lib/draft')

describe('singular4 (port of @cap-js/cds-typer)', () => {
  it('handles basic plural (s → strip)', () => {
    expect(singular4('Books')).toBe('Book')
    expect(singular4('Chapters')).toBe('Chapter')
  })

  it('handles ies → y (Deliveries → Delivery)', () => {
    expect(singular4('Deliveries')).toBe('Delivery')
    expect(singular4('Categories')).toBe('Category')
  })

  it('handles ees → ee (Employees → Employee)', () => {
    expect(singular4('Employees')).toBe('Employee')
  })

  it('handles ses → s (Buses → Bus)', () => {
    expect(singular4('Buses')).toBe('Bus')
  })

  it('handles ess → invariant (Address → Address)', () => {
    expect(singular4('Address')).toBe('Address')
  })

  it('handles invariant nouns (species, news)', () => {
    expect(singular4('Species')).toBe('Species')
    expect(singular4('News')).toBe('News')
    expect(singular4('news')).toBe('news')
  })

  it('respects @singular annotation on CSN', () => {
    expect(singular4({ name: 'People', '@singular': 'Person' })).toBe('Person')
    expect(singular4({ name: 'Foos', '@singular': 'CustomFoo' })).toBe('CustomFoo')
  })

  it('falls back to derived form when @singular absent', () => {
    expect(singular4({ name: 'Chapters' })).toBe('Chapter')
  })

  it('accepts bare string names', () => {
    expect(singular4('Orders')).toBe('Order')
  })

  it('handles typer edge case: trailing _ stripped', () => {
    expect(singular4('foo_')).toBe('foo')
  })

  it('precedence: first source with @singular wins', () => {
    const compElem = { '@singular': 'FromElement' }
    const targetEntity = { name: 'Foos', '@singular': 'FromEntity' }
    expect(singular4(compElem, targetEntity, 'Foos')).toBe('FromElement')
  })

  it('precedence: falls through to next source if @singular missing', () => {
    const compElem = { name: 'foos' } // no @singular
    const targetEntity = { name: 'Foos', '@singular': 'FromEntity' }
    expect(singular4(compElem, targetEntity, 'Foos')).toBe('FromEntity')
  })

  it('precedence: derives from last source when no @singular anywhere', () => {
    const compElem = { name: 'foos' }
    const targetEntity = { name: 'Foos' }
    expect(singular4(compElem, targetEntity, 'Chapters')).toBe('Chapter')
  })
})

describe('singularKebab', () => {
  it('kebab-cases singular form', () => {
    expect(singularKebab('OrderItems')).toBe('order-item')
    expect(singularKebab('LineItems')).toBe('line-item')
  })

  it('uses @singular annotation with kebab-case', () => {
    expect(singularKebab({ name: 'People', '@singular': 'Person' })).toBe('person')
  })
})
