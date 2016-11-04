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
  this.httpServer.proxy = this
  this.started = false
  this.port = options.port
  this.hostname = options.hostname
  this.backlog = options.backlog
  // start listening if port is defined for backwards compatibility
  if (typeof this.port !== 'undefined') this.listen(this.port)
}

MITMServer.prototype.listen = function listen (port, hostname, backlog, cb) {
  if (this.started) throw new Error('server already listening')
  this.started = true
  if (!cb && typeof backlog === 'function') {
    cb = backlog
    backlog = null
  } else if (!backlog && !cb && typeof hostname === 'function') {
    cb = hostname
    backlog = null
    hostname = null
  }

  if (hostname) {
    this.hostname = hostname
  }

  if (backlog) {
    this.backlog = backlog
  }

  this.initServer(this.httpServer, this.hostname || 'localhost', port, false)
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

MITMServer.prototype.initServer = function initServer (server, hostname, port, secure, cb) {
  this.log('debug', 'adding listeners to server for ' + hostname)
  var proxy = this

  if (this.backlog && this.hostname) {
    server.listen(port, this.hostname, this.backlog, cb)
  } else if (this.hostname) {
    server.listen(port, this.hostname, cb)
  } else {
    server.listen(port, cb)
  }

  server.port = server.address().port
  server.hostname = hostname
  server.on('request', onRequest)
  server.on('error', this.onError.bind(this))

  // handle http connect method
  // only emitted when trying to establish a tunnel
  server.on('connect', onConnect)

  // probably web sockets
  server.on('upgrade', onUpgrade)

  function onRequest (req, res) {
    proxy.log('debug', 'received request for ' + hostname)
    req.on('error', proxy.onError.bind(this))
    res.on('error', proxy.onError.bind(this))
    proxy.handler(req, res, secure)
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
        socket.destroy()
        return
      }
      var conn = net.connect(server.port, this.hostname || 'localhost', function () {
        socket.write('HTTP/1.1 200 OK\r\n\r\n')
        conn.pipe(socket)
        socket.pipe(conn)
        proxy.log('debug', 'tunnel to server for ' + hostname + ' established')
      })

      conn.on('error', proxy.onError.bind(proxy))
      socket.on('error', proxy.onError.bind(proxy))
    }
  }

  function onUpgrade (req, socket, head) {
    if (!proxy.listeners('upgrade').length) {
      socket.destroy()
      proxy.log('warn', 'received upgrade request, but no upgrade handlers were registered')
      return
    }
    proxy.emit('upgrade', req, socket, head, secure)
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
