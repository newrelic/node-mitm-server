var net = require('net')
var util = require('util')
var http = require('http')
var https = require('https')
var CertStore = require('./cert-store')
var EE = require('events').EventEmitter

module.exports = MITMServer

util.inherits(MITMServer, EE)

function MITMServer (options, handler) {
  if (!(this instanceof MITMServer)) return new MITMServer(options, handler)
  EE.call(this)
  this.certStore = new CertStore(options, this.log.bind(this))
  this.handler = handler
  this.serverTimeout = options.serverTimeout || 60000
  this.servers = {}
  this.httpServer = http.createServer()
  this.initServer(this.httpServer, 'localhost', options.port, false)
  this.httpServer.proxy = this
}

MITMServer.prototype.getSecureServer = function getSecureServer (hostname, done) {
  this.log('debug', 'retreiving secure server for ' + hostname)
  var server = this.servers[hostname]
  if (!server) return this.createSecureServer(hostname, done)
  process.nextTick(function () {
    done(null, server)
  })
}

MITMServer.prototype.createSecureServer = function createSecureServer (hostname, done) {
  this.log('info', 'creating new secure server for ' + hostname)
  var proxy = this
  this.certStore.getCert(hostname, createServer)

  function createServer (err, options) {
    if (err) return done(err)

    var server = https.createServer(options)
    proxy.initServer(server, hostname, 0, true)
    proxy.servers[hostname] = server
    proxy.watchServer(server)
    done(null, server)
  }
}

MITMServer.prototype.initServer = function initServer (server, hostname, port, ssl) {
  this.log('debug', 'adding listeners to server for ' + hostname)
  var proxy = this
  server.listen(port)
  server.port = server.address().port
  server.hostname = hostname
  server.on('request', onRequest)
  server.on('error', this.onError.bind(this))

  // handle http connect method
  // only emitted when trying to establish a tunnel
  server.on('connect', onConnect)

  function onRequest (req, res) {
    proxy.log('debug', 'received request for ' + hostname)
    req.on('error', proxy.onError.bind(this))
    res.on('error', proxy.onError.bind(this))
    proxy.handler(req, res, ssl)
  }

  function onConnect (req, socket) {
    var parts = req.url.split(':', 2)
    var hostname = parts[0]
    var port = parts[1] ? parseInt(parts[1], 10) : 80

    if (port === 443) {
      return proxy.getSecureServer(hostname, tunnel)
    }

    tunnel(null, proxy.httpServer)

    function tunnel (err, server) {
      proxy.log('debug', 'establishing tunnel to server for ' + hostname)
      if (err) {
        proxy.log('error', 'could not retreive secure server for ' + hostname)
        proxy.onError(err)
      }
      var conn = net.connect(server.port, 'localhost', function () {
        socket.write('HTTP/1.1 200 OK\r\n\r\n')
        conn.pipe(socket)
        socket.pipe(conn)
        proxy.log('debug', 'tunnel to server for ' + hostname + ' established')
      })

      conn.on('error', proxy.onError.bind(proxy))
      socket.on('error', proxy.onError.bind(proxy))
    }
  }
}

MITMServer.prototype.watchServer = function watchServer (server) {
  var proxy = this
  var timer = setTimeout(shutdown, proxy.serverTimeout)

  server.once('connection', function clear () {
    clearTimeout(timer)
    proxy.watchServer(server)
  })

  function shutdown () {
    proxy.log('debug', 'shutting down inactive server for ' + server.hostname)
    delete proxy.servers[server.hostname]
    server.close()
  }
}

var LOG_LEVELS = ['error', 'warn', 'info', 'debug']

MITMServer.prototype.log = function log (level, msg) {
  var levels = LOG_LEVELS.slice(LOG_LEVELS.indexOf(level))

  for (var i = 0, len = levels.length; i < len; ++i) {
    this.emit('log:' + levels[i], level, msg)
  }

  this.emit('log', level, msg)
}

MITMServer.prototype.onError = function onError (err) {
  this.log('error', err)
  this.emit('error', err)
}
