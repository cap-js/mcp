module.exports = function AuthTestService(srv) {
  srv.on('adminAction', (req) => req.data.x || 0)
  srv.on('editorAction', (req) => req.data.x || 0)
  srv.on('openAction', (req) => req.data.x || 0)
  srv.on('restrictedAction', (req) => req.data.x || 0)
}
