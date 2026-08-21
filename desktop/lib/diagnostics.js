'use strict';

const net = require('node:net');

function probeTcpEndpoint({ host = '127.0.0.1', port, timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    let settled = false;
    const socket = net.createConnection({ host, port: Number(port) });
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      const latencyMs = ok
        ? Number(process.hrtime.bigint() - startedAt) / 1e6
        : null;
      socket.destroy();
      resolve({ ok, latencyMs });
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

function diagnosticsAreHealthy(checks) {
  const required = (Array.isArray(checks) ? checks : [])
    .filter((check) => check.required !== false);
  return required.length > 0 && required.every((check) => check.status === 'pass');
}

module.exports = { diagnosticsAreHealthy, probeTcpEndpoint };
