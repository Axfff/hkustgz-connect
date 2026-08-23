'use strict';

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const net = require('node:net');
const tls = require('node:tls');
const {
  createDeadline, openSocksTunnel, remainingDeadlineMs,
} = require('./socks-health');

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

function parseRouteInterface(output) {
  return String(output || '').match(/^\s*interface:\s*(\S+)\s*$/m)?.[1] || null;
}

function parseLaunchctlPid(output) {
  const pid = Number(String(output || '').match(/^\s*pid\s*=\s*(\d+)\s*$/m)?.[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function listenerOwnedByLaunchAgent({ listenerPid, launchAgentPid, executableMatches } = {}) {
  return Number.isInteger(listenerPid)
    && listenerPid > 0
    && listenerPid === launchAgentPid
    && executableMatches === true;
}

function classifyRelayReadiness({
  installed = false,
  listenerOwned = false,
  needsUpdate = false,
  conflict = false,
  dataPlane = null,
} = {}) {
  if (needsUpdate) return 'stale';
  if (listenerOwned) return dataPlane === true ? 'ready' : 'data_plane_failed';
  if (conflict) return 'conflict';
  return installed ? 'not_running' : 'not_installed';
}

function probeIpv4Route({ address, platform = process.platform, run = execFile } = {}) {
  if (platform !== 'darwin' || !address) {
    return Promise.resolve({ ok: false, interface: null, tunneled: false, error: 'unavailable' });
  }
  return new Promise((resolve) => {
    run('/sbin/route', ['-n', 'get', String(address)], {
      encoding: 'utf8',
      timeout: 1500,
      maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) {
        return resolve({
          ok: false, interface: null, tunneled: false, error: 'route_lookup_failed',
        });
      }
      const routeInterface = parseRouteInterface(stdout);
      resolve({
        ok: !!routeInterface,
        interface: routeInterface,
        tunneled: routeInterface?.startsWith('utun') || false,
        error: routeInterface ? null : 'route_interface_missing',
      });
    });
  });
}

function parseHttpStatusLine(data) {
  const line = String(data || '').split('\r\n', 1)[0];
  const match = line.match(/^HTTP\/1\.[01] ([1-5][0-9]{2})(?: |$)/);
  return match ? Number(match[1]) : null;
}

function summarizeHttpsReachability(results) {
  const probes = Array.isArray(results) ? results : [];
  const detail = probes.map((probe) => {
    const host = String(probe?.host || 'unknown host');
    if (!probe?.ok) return `${host} failed (${probe?.error || 'no HTTP response'})`;
    const latency = Number.isFinite(probe.latencyMs)
      ? ` in ${Math.round(probe.latencyMs)} ms`
      : '';
    return `${host} returned HTTP ${probe.statusCode}${latency}`;
  }).join('; ');
  return {
    ok: probes.length > 0 && probes.every((probe) => probe?.ok === true),
    detail: detail || 'No HTTPS probes ran',
  };
}

function probeUpgradeShapedHttpsEndpoint({
  host,
  port = 443,
  path = '/',
  timeoutMs = 5000,
  rejectUnauthorized = true,
  connect = tls.connect,
  startedAt = process.hrtime.bigint(),
  deadlineNs = null,
} = {}) {
  return new Promise((resolve) => {
    const deadline = typeof deadlineNs === 'bigint'
      ? deadlineNs
      : createDeadline(timeoutMs, startedAt);
    const deadlineDelayMs = remainingDeadlineMs(deadline);
    if (deadlineDelayMs === 0) {
      return resolve({ ok: false, latencyMs: null, statusCode: null, error: 'timeout' });
    }

    let settled = false;
    let response = '';
    let socket;
    let deadlineTimer;
    const finish = (ok, error = null, statusCode = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadlineTimer);
      const latencyMs = ok
        ? Number(process.hrtime.bigint() - startedAt) / 1e6
        : null;
      try { socket?.destroy(); } catch {}
      resolve({ ok, latencyMs, statusCode, error });
    };
    try {
      deadlineTimer = setTimeout(() => finish(false, 'timeout'), deadlineDelayMs);
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
      socket.setTimeout(deadlineDelayMs);
      socket.on('data', (chunk) => {
        response += chunk.toString('latin1');
        if (response.length > 8192) return finish(false, 'invalid_response');
        const end = response.indexOf('\r\n');
        if (end === -1) return;
        const statusCode = parseHttpStatusLine(response.slice(0, end));
        // A status line proves HTTPS reachability only. The target may reject or
        // ignore Upgrade, so this probe must never be presented as a WebSocket pass.
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

async function probeUpgradeShapedHttpsThroughSocks({
  proxyHost = '127.0.0.1',
  proxyPort,
  host,
  port = 443,
  path = '/',
  timeoutMs = 5000,
  rejectUnauthorized = true,
  openTunnel = openSocksTunnel,
  connect = tls.connect,
} = {}) {
  const startedAt = process.hrtime.bigint();
  const deadlineNs = createDeadline(timeoutMs, startedAt);
  let tunnel;
  try {
    tunnel = await openTunnel({
      proxyHost,
      proxyPort,
      targetHost: host,
      targetPort: port,
      timeoutMs,
      deadlineNs,
    });
  } catch {
    tunnel = null;
  }
  if (!tunnel) {
    const error = remainingDeadlineMs(deadlineNs) === 0 ? 'timeout' : 'socks_connect_failed';
    return { ok: false, latencyMs: null, statusCode: null, error };
  }
  if (remainingDeadlineMs(deadlineNs) === 0) {
    try { tunnel.destroy(); } catch {}
    return { ok: false, latencyMs: null, statusCode: null, error: 'timeout' };
  }

  return probeUpgradeShapedHttpsEndpoint({
    host,
    port,
    path,
    timeoutMs,
    rejectUnauthorized,
    startedAt,
    deadlineNs,
    connect: (options, secure) => {
      try {
        return connect({ ...options, socket: tunnel }, secure);
      } catch (error) {
        try { tunnel.destroy(); } catch {}
        throw error;
      }
    },
  });
}

module.exports = {
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
};
