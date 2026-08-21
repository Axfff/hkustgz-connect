'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const { diagnosticsAreHealthy, probeTcpEndpoint } = require('../lib/diagnostics');

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
