// Bounded FIFO cache with per-entry TTL. Evicts the oldest-inserted entry once
// `max` is exceeded. Map iteration order is insertion order, so the oldest key
// is always the first one.
class FifoCache {
  constructor(max = 1000) {
    this.max = max
    this.map = new Map()
  }
  get(key) {
    const hit = this.map.get(key)
    if (!hit) return null
    if (hit.exp <= Date.now()) {
      this.map.delete(key)
      return null
    }
    return hit.token
  }
  set(key, token, exp) {
    this.map.set(key, { token, exp }) // existing keys keep their original position (FIFO)
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value) // evict oldest
    }
  }
}

module.exports = { FifoCache }
