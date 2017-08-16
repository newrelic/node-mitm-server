# mitm-server

## Overview

`mitm-server` exports a function that opens a proxy server. This server can be
used as a system level proxy, or by a specific browser or application. Every
request made through this proxy will be passed to the handler function as a
`req` `res` pair.  The handler can then write an arbitrary response.  The
proxy server is designed to work with https connections, and therefore needs to
be initialized with a root certificate.  This root certificate is used to
generate certs for each https domain.  For https requests to work correctly,
the request application (or os) will need to either ignore ssl errors, or trust
the root cert used by the proxy.

## Example

```javascript
var MITMServer = require('@newrelic/mitm-server')
var https = require('https')
var http = require('http')
var url = require('url')

var options = {
  certDir: './cert-cache',
  caCertPath: './cacert.pem',
  caKeyPath: './cakey.pem'
}

var server = new MITMServer(options, handler)

server.listen(8081)

function handler (req, res, secure) {
  if (Math.random() > .5) {
    res.writeHead(500)
    res.end('random 500s!')
    return
  }

  var module = secure ? https : http
  var port = req.headers.host.split(':')[1]
  var reqOptions = {
    method: req.method,
    port: port ? parseInt(port, 10) : secure ? 443 : 80,
    hostname: req.headers.host.split(':')[0],
    headers: req.headers,
    path: url.parse(req.url).path
  }

  req.pipe(module.request(reqOptions, onResponse))

  function onResponse (response) {
    res.writeHead(response.statusCode, response.headers)
    response.pipe(res)
  }
}
```

## Generating a Root CA

```bash
openssl genrsa -out ca/ca.key 1024
openssl req -new -x509 -days 3650 -extensions v3_ca -keyout ca/cakey.pem -out ca/cacert.pem -nodes -subj \"/C=US/ST=STATE/L=CITY/O=ORG/CN=CERT_NAME\"
echo \"02\" > ca/cacert.srl
```

## API

`new MITMServer(options, handler) -> mitmServerInstance`

#### options
* certDir (required): path to the folder where certs will be created and stored
* caCertPath (required): path to the root certificate used to generate new
  certs for https requests.
* caKeyPath (required): path the the root certificate key
* serverTimeout (optional): an https server is created for each domain accessed
  via https. This value determines how long a server will stay open (in ms)
  without any activity.
* port (optional): port for the main proxy server, if passed constructor will
  call server.listen

#### handler

handler will be passed 3 arguments for each inbound request.

 * req: the request object
 * res: the response object
 * secure: a boolean which indicates if the request was made using https

### instance methods

#### `listen(port)`
  call once with the port the proxy should be listening on. If port is passed
  in options object during server construction, the constructor will call
  listen, and this method should not be called again.

  * port (required): an unused port, some ports (eg. 80) will require elevated
    privileges.  Passing 0 will assign a random unused port.

### instance events

#### `upgrade`

emitted anytime a proxied request requests an upgrade.  This request will not
be passed to the handler.  If this event is not listened for, the request will
be closed. This event is emitted with the same 3 arguments as a node HTTP
server's `upgrade` event, as well as a 4th `secure` argument to indicate if the
request was made using https.

##### event arguments
* request: the request that requested the upgrade
* socket: the socket for the request
* head: a buffer of data already read off of the socket
* ssl: a boolean which indicates if this is was a secure connection

#### `error`

all internal errors will be emitted on the proxy instance

#### `log`
all log messages will be emitted with 2 arguments as log events

 * level: will be one of `['error', 'warn', 'info', 'debug']`
 * msg: the log message

#### `log:{level}`

There is also an event for each log level that will only emit log messages
for messages at that level or higher.

### instance properties

#### `servers`
an object who's keys are domains, and properties are the https servers that are
currently open.

#### `httpServer`
the main http that all connections pass through

## Contributing

You are welcome to send pull requests to us - however, by doing so you agree
that you are granting New Relic a non-exclusive, non-revokable, no-cost license
to use the code, algorithms, patents, and ideas in that code in our products if
we so choose. You also agree the code is provided as-is and you provide no
warranties as to its fitness or correctness for any purpose.

Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for details on how to contribute to this
project.

## License

This project is licensed under the MIT License See
[LICENSE.md](./LICENSE.md) for the full license.
