const { FifoCache } = require('../../lib/auth/fifo-cache')

const future = () => Date.now() + 60_000

describe('FifoCache', () => {
  it('returns null for a missing key', () => {
    expect(new FifoCache().get('nope')).toBeNull()
  })

  it('stores and returns a live entry', () => {
    const cache = new FifoCache()
    cache.set('k', 'token', future())
    expect(cache.get('k')).toBe('token')
  })

  it('treats an entry past its ttl as a miss', () => {
    const cache = new FifoCache()
    cache.set('k', 'token', Date.now() - 1)
    expect(cache.get('k')).toBeNull()
  })

  it('evicts the oldest-inserted entry once max is exceeded (FIFO)', () => {
    const cache = new FifoCache(2)
    cache.set('a', 'va', future())
    cache.set('b', 'vb', future())
    cache.set('c', 'vc', future()) // size 3 > 2 → 'a' (oldest) evicted
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('vb')
    expect(cache.get('c')).toBe('vc')
  })

  it('re-setting an existing key keeps its original FIFO position', () => {
    const cache = new FifoCache(2)
    cache.set('a', 'va', future())
    cache.set('b', 'vb', future())
    cache.set('a', 'va2', future()) // update value, not insertion order
    cache.set('c', 'vc', future()) // 'a' is still oldest → evicted
    expect(cache.get('a')).toBeNull()
    expect(cache.get('b')).toBe('vb')
    expect(cache.get('c')).toBe('vc')
  })
})
