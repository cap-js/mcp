module.exports = function RestrictedService(srv) {
  // Action: add x to accumulator 'to'
  srv.on('add', (req) => {
    const { x, to } = req.data
    return (x || 0) + (to || 0)
  })
}
