'use strict';

const net = require('node:net');

const MAX_HOST_BYTES = 253;
const NANOSECONDS_PER_MILLISECOND = 1000000n;

function createDeadline(timeoutMs = 5000, startedAt = process.hrtime.bigint()) {
  const duration = Number(timeoutMs);
  const milliseconds = Number.isFinite(duration) && duration > 0
    ? Math.ceil(duration)
    : 5000;
  return startedAt + (BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND);
}

function remainingDeadlineMs(deadlineNs, now = process.hrtime.bigint()) {
  if (typeof deadlineNs !== 'bigint') return 0;
  const remaining = deadlineNs - now;
  if (remaining <= 0n) return 0;
  return Number(
    (remaining + NANOSECONDS_PER_MILLISECOND - 1n) / NANOSECONDS_PER_MILLISECOND,
  );
}

function socksConnectRequest(host, port) {
  const encoded = Buffer.from(String(host), 'ascii');
  const targetPort = Number(port);
  if (!encoded.length || encoded.length > MAX_HOST_BYTES ||
      !Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
    throw new Error('invalid SOCKS health target');
  }
  return Buffer.concat([
    Buffer.from([5, 1, 0, 3, encoded.length]),
    encoded,
    Buffer.from([targetPort >> 8, targetPort & 0xff]),
  ]);
}

function socksReplyLength(buffer) {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 5 || buffer[2] !== 0) return -1;
  if (buffer[3] === 1) return 10;
  if (buffer[3] === 4) return 22;
  if (buffer[3] === 3) return buffer.length < 5 ? null : 7 + buffer[4];
  return -1;
}

function openSocksTunnel({
  proxyHost = '127.0.0.1',
  proxyPort,
  targetHost,
  targetPort = 443,
  timeoutMs = 5000,
  deadlineNs = null,
  connect = net.createConnection,
}) {
  return new Promise((resolve) => {
    const deadline = typeof deadlineNs === 'bigint'
      ? deadlineNs
      : createDeadline(timeoutMs);
    const deadlineDelayMs = remainingDeadlineMs(deadline);
    if (deadlineDelayMs === 0) return resolve(null);

    let settled = false;
    let stage = 'greeting';
    let buffered = Buffer.alloc(0);
    let socket;
    let deadlineTimer;
    const cleanup = () => {
      clearTimeout(deadlineTimer);
      socket?.removeListener('timeout', onTimeout);
      socket?.removeListener('error', onError);
      socket?.removeListener('close', onClose);
      socket?.removeListener('data', onData);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!result) socket?.destroy();
      else socket.setTimeout(0);
      resolve(result);
    };
    const onTimeout = () => finish(null);
    const onError = () => finish(null);
    const onClose = () => finish(null);
    const onData = (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (stage === 'greeting' && buffered.length >= 2) {
        if (buffered[0] !== 5 || buffered[1] !== 0) return finish(null);
        buffered = buffered.subarray(2);
        stage = 'connect';
        socket.write(socksConnectRequest(targetHost, targetPort));
      }
      if (stage !== 'connect') return;
      const replyLength = socksReplyLength(buffered);
      if (replyLength === -1) return finish(null);
      if (replyLength === null || buffered.length < replyLength) return;
      finish(buffered[1] === 0 ? socket : null);
    };

    try {
      deadlineTimer = setTimeout(onTimeout, deadlineDelayMs);
      socket = connect({
        host: proxyHost,
        port: Number(proxyPort),
      });
      socket.setTimeout(deadlineDelayMs);
      socket.once('connect', () => socket.write(Buffer.from([5, 1, 0])));
      socket.on('data', onData);
      socket.once('timeout', onTimeout);
      socket.once('error', onError);
      socket.once('close', onClose);
    } catch {
      finish(null);
    }
  });
}

async function probeSocksConnect(options) {
  const socket = await openSocksTunnel(options);
  if (!socket) return false;
  socket.destroy();
  return true;
}

module.exports = {
  createDeadline,
  openSocksTunnel,
  probeSocksConnect,
  remainingDeadlineMs,
  socksConnectRequest,
  socksReplyLength,
};
