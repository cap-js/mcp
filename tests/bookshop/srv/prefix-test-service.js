module.exports = function PrefixTestService() {
  this.on('sum', (req) => {
    const { x, y } = req.data
    return x + y
  })
}
