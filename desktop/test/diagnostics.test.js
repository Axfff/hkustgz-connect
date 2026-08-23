'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const {
  classifyRelayReadiness,
  diagnosticsAreHealthy,
  listenerOwnedByLaunchAgent,
  parseHttpStatusLine,
  parseLaunchctlPid,
  parseRouteInterface,
  probeIpv4Route,
  probeTcpEndpoint,
  probeUpgradeShapedHttpsEndpoint,
  probeUpgradeShapedHttpsThroughSocks,
  summarizeHttpsReachability,
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

test('private route diagnostics report TUN capture without attributing its owner', async () => {
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
  assert.deepEqual(throughTun, {
    ok: true, interface: 'utun7', tunneled: true, error: null,
  });
  assert.deepEqual(throughWifi, {
    ok: true, interface: 'en0', tunneled: false, error: null,
  });
});

test('relay ownership requires the launch agent and listener to report the same PID', () => {
  const launchctl = 'state = running\n\tpid = 24683\n\tlast exit code = (never exited)\n';
  assert.equal(parseLaunchctlPid(launchctl), 24683);
  assert.equal(parseLaunchctlPid('state = waiting\n'), null);
  assert.equal(parseLaunchctlPid('pid = 0\n'), null);

  assert.equal(listenerOwnedByLaunchAgent({
    listenerPid: 24683,
    launchAgentPid: 24683,
    executableMatches: true,
  }), true);
  assert.equal(listenerOwnedByLaunchAgent({
    listenerPid: 24683,
    launchAgentPid: 24684,
    executableMatches: true,
  }), false);
  assert.equal(listenerOwnedByLaunchAgent({
    listenerPid: 24683,
    launchAgentPid: 24683,
    executableMatches: false,
  }), false);
});

test('relay readiness requires an owned listener and a working SOCKS data plane', () => {
  assert.equal(classifyRelayReadiness(), 'not_installed');
  assert.equal(classifyRelayReadiness({ installed: true }), 'not_running');
  assert.equal(classifyRelayReadiness({ installed: true, conflict: true }), 'conflict');
  assert.equal(classifyRelayReadiness({
    installed: true,
    listenerOwned: true,
    dataPlane: false,
  }), 'data_plane_failed');
  assert.equal(classifyRelayReadiness({
    installed: true,
    listenerOwned: true,
    dataPlane: true,
  }), 'ready');
  assert.equal(classifyRelayReadiness({
    installed: true,
    listenerOwned: true,
    needsUpdate: true,
    dataPlane: true,
  }), 'stale');
});

test('upgrade-shaped HTTPS diagnostics treat an HTTP response as reachability only', async () => {
  class FakeTlsSocket extends EventEmitter {
    setTimeout() {}
    write(request) {
      assert.match(request, /Upgrade: websocket/);
      process.nextTick(() => this.emit('data', Buffer.from('HTTP/1.1 403 Forbidden\r\n')));
    }
    destroy() {}
  }
  const result = await probeUpgradeShapedHttpsEndpoint({
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

test('explicit SOCKS HTTPS diagnostics tunnel TLS before accepting an HTTP response', async () => {
  class FakeTlsSocket extends EventEmitter {
    setTimeout() {}
    write(request) {
      assert.match(request, /Upgrade: websocket/);
      process.nextTick(() => this.emit('data', Buffer.from('HTTP/1.1 404 Not Found\r\n')));
    }
    destroy() {}
  }
  const tunnel = { destroy() {} };
  const result = await probeUpgradeShapedHttpsThroughSocks({
    proxyPort: 1082,
    host: 'chatgpt.example',
    openTunnel: async (options) => {
      assert.deepEqual({ ...options, deadlineNs: typeof options.deadlineNs }, {
        proxyHost: '127.0.0.1',
        proxyPort: 1082,
        targetHost: 'chatgpt.example',
        targetPort: 443,
        timeoutMs: 5000,
        deadlineNs: 'bigint',
      });
      return tunnel;
    },
    connect: (options, secure) => {
      assert.equal(options.socket, tunnel);
      assert.equal(options.servername, 'chatgpt.example');
      const socket = new FakeTlsSocket();
      process.nextTick(secure);
      return socket;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 404);
});

test('HTTPS diagnostics enforce a hard deadline despite partial activity', async () => {
  class DrippingTlsSocket extends EventEmitter {
    setTimeout() {}
    write() {
      this.interval = setInterval(() => this.emit('data', Buffer.from('H')), 5);
    }
    destroy() { clearInterval(this.interval); }
  }

  const startedAt = Date.now();
  const result = await probeUpgradeShapedHttpsEndpoint({
    host: 'realtime.example',
    timeoutMs: 30,
    connect: (_options, secure) => {
      const socket = new DrippingTlsSocket();
      process.nextTick(secure);
      return socket;
    },
  });
  assert.equal(result.error, 'timeout');
  assert.ok(Date.now() - startedAt < 1000);
});

test('SOCKS and HTTPS stages share one deadline', async () => {
  let tunnelDestroyed = false;
  let tlsStarted = false;
  const result = await probeUpgradeShapedHttpsThroughSocks({
    proxyPort: 1082,
    host: 'chatgpt.example',
    timeoutMs: 20,
    openTunnel: async ({ deadlineNs }) => {
      assert.equal(typeof deadlineNs, 'bigint');
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { destroy: () => { tunnelDestroyed = true; } };
    },
    connect: () => { tlsStarted = true; },
  });
  assert.equal(result.error, 'timeout');
  assert.equal(tunnelDestroyed, true);
  assert.equal(tlsStarted, false);
});

test('HTTPS reachability summaries require every requested host', () => {
  const summary = summarizeHttpsReachability([
    { host: 'chatgpt.com', ok: true, statusCode: 403, latencyMs: 12.4 },
    { host: 'ws.chatgpt.com', ok: false, error: 'timeout' },
  ]);
  assert.equal(summary.ok, false);
  assert.equal(
    summary.detail,
    'chatgpt.com returned HTTP 403 in 12 ms; ws.chatgpt.com failed (timeout)',
  );
});

test('explicit SOCKS HTTPS diagnostics fail before TLS when CONNECT fails', async () => {
  const result = await probeUpgradeShapedHttpsThroughSocks({
    proxyPort: 1082,
    host: 'chatgpt.example',
    openTunnel: async () => null,
  });
  assert.deepEqual(result, {
    ok: false,
    latencyMs: null,
    statusCode: null,
    error: 'socks_connect_failed',
  });
});

test('HTTP status parser rejects non-HTTP or malformed responses', () => {
  assert.equal(parseHttpStatusLine('HTTP/1.1 101 Switching Protocols\r\n'), 101);
  assert.equal(parseHttpStatusLine('HTTP/2 200\r\n'), null);
  assert.equal(parseHttpStatusLine('not HTTP'), null);
});
