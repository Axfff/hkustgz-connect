'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');

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

function parseHttpStatusLine(data) {
  const line = String(data || '').split('\r\n', 1)[0];
  const match = line.match(/^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/);
  return match ? Number(match[1]) : null;
}

function probeWebSocketEndpoint({
  host,
  port = 443,
  path = '/',
  timeoutMs = 5000,
  rejectUnauthorized = true,
  connect = tls.connect,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = process.hrtime.bigint();
    let settled = false;
    let response = '';
    let socket;
    const finish = (ok, error = null, statusCode = null) => {
      if (settled) return;
      settled = true;
      const latencyMs = ok
        ? Number(process.hrtime.bigint() - startedAt) / 1e6
        : null;
      try { socket?.destroy(); } catch {}
      resolve({ ok, latencyMs, statusCode, error });
    };
    try {
      socket = connect({
        host,
        port: Number(port),
        servername: host,
        rejectUnauthorized,
      }, () => {
        const key = crypto.randomBytes(16).toString('base64');
        socket.write([
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${key}`,
          '',
          '',
        ].join('\r\n'));
      });
      socket.setTimeout(timeoutMs);
      socket.on('data', (chunk) => {
        response += chunk.toString('latin1');
        if (response.length > 8192) return finish(false, 'invalid_response');
        const end = response.indexOf('\r\n');
        if (end === -1) return;
        const statusCode = parseHttpStatusLine(response.slice(0, end));
        finish(statusCode !== null, statusCode === null ? 'invalid_response' : null, statusCode);
      });
      socket.once('timeout', () => finish(false, 'timeout'));
      socket.once('error', (error) => finish(false, error.code || 'connection_failed'));
      socket.once('close', () => finish(false, 'closed_before_response'));
    } catch (error) {
      finish(false, error.code || 'connection_failed');
    }
  });
}

module.exports = {
  diagnosticsAreHealthy,
  parseHttpStatusLine,
  probeTcpEndpoint,
  probeWebSocketEndpoint,
};
