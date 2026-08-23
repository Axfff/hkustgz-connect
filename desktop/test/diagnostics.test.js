'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const {
  diagnosticsAreHealthy,
  parseHttpStatusLine,
  parseRouteInterface,
  probeIpv4Route,
  probeTcpEndpoint,
  probeWebSocketEndpoint,
} = require('../lib/diagnostics');

test('TCP diagnostics report a reachable loopback endpoint with latency', async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await probeTcpEndpoint({
      port: server.address().port,
      timeoutMs: 1000,
    });
    assert.equal(result.ok, true);
    assert.ok(result.latencyMs >= 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('optional diagnostics do not make a healthy tunnel fail', () => {
  assert.equal(diagnosticsAreHealthy([
    { status: 'pass', required: true },
    { status: 'fail', required: false },
  ]), true);
  assert.equal(diagnosticsAreHealthy([
    { status: 'pass', required: true },
    { status: 'fail', required: true },
  ]), false);
});

test('private route diagnostics distinguish Shadowrocket TUN from a physical interface', async () => {
  assert.equal(parseRouteInterface('  interface: en0\n'), 'en0');
  const throughTun = await probeIpv4Route({
    address: '198.51.100.8',
    platform: 'darwin',
    run: (_file, _args, _options, callback) => callback(null, '  interface: utun7\n'),
  });
  const throughWifi = await probeIpv4Route({
    address: '198.51.100.8',
    platform: 'darwin',
    run: (_file, _args, _options, callback) => callback(null, '  interface: en0\n'),
  });
  assert.deepEqual(throughTun, { ok: true, interface: 'utun7', error: null });
  assert.deepEqual(throughWifi, { ok: false, interface: 'en0', error: null });
});

test('WebSocket diagnostics accept an authenticated or unauthenticated HTTP response', async () => {
  class FakeTlsSocket extends EventEmitter {
    setTimeout() {}
    write(request) {
      assert.match(request, /Upgrade: websocket/);
      process.nextTick(() => this.emit('data', Buffer.from('HTTP/1.1 403 Forbidden\r\n')));
    }
    destroy() {}
  }
  const result = await probeWebSocketEndpoint({
    host: 'realtime.example',
    connect: (_options, secure) => {
      const socket = new FakeTlsSocket();
      process.nextTick(secure);
      return socket;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 403);
});

test('HTTP status parser rejects non-HTTP or malformed responses', () => {
  assert.equal(parseHttpStatusLine('HTTP/1.1 101 Switching Protocols\r\n'), 101);
  assert.equal(parseHttpStatusLine('HTTP/2 200\r\n'), null);
  assert.equal(parseHttpStatusLine('not HTTP'), null);
});
