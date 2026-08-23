'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const net = require('node:net');
const test = require('node:test');
const {
  openSocksTunnel, probeSocksConnect, socksConnectRequest, socksReplyLength,
} = require('../lib/socks-health');

test('SOCKS health request is a bounded domain CONNECT', () => {
  const request = socksConnectRequest('www.hkust-gz.edu.cn', 443);
  assert.deepEqual([...request.subarray(0, 5)], [5, 1, 0, 3, 19]);
  assert.equal(request.subarray(-2).readUInt16BE(), 443);
  assert.throws(() => socksConnectRequest('x'.repeat(254), 443), /invalid/);
  assert.equal(socksReplyLength(Buffer.from([5, 0, 0, 1])), 10);
  assert.equal(socksReplyLength(Buffer.from([5, 0, 0, 3, 7])), 14);
  assert.equal(socksReplyLength(Buffer.from([5, 0, 0, 4])), 22);
  assert.equal(socksReplyLength(Buffer.from([5, 0, 1, 1])), -1);
});

test('SOCKS tunnel enforces a hard deadline despite partial activity', async () => {
  class DrippingSocket extends EventEmitter {
    constructor() {
      super();
      this.destroyed = false;
      this.interval = null;
    }
    setTimeout() {}
    write(request) {
      if (request.length === 3) {
        process.nextTick(() => this.emit('data', Buffer.from([5, 0])));
        return;
      }
      this.emit('data', Buffer.from([5, 0, 0, 3, 253]));
      this.interval = setInterval(() => this.emit('data', Buffer.from([0])), 5);
    }
    destroy() {
      this.destroyed = true;
      clearInterval(this.interval);
    }
  }

  let socket;
  const startedAt = Date.now();
  const result = await openSocksTunnel({
    proxyPort: 1080,
    targetHost: 'www.hkust-gz.edu.cn',
    timeoutMs: 30,
    connect: () => {
      socket = new DrippingSocket();
      process.nextTick(() => socket.emit('connect'));
      return socket;
    },
  });
  assert.equal(result, null);
  assert.equal(socket.destroyed, true);
  assert.ok(Date.now() - startedAt < 1000);
});

test('SOCKS health probe requires a successful proxy CONNECT reply', async () => {
  const server = net.createServer((socket) => {
    let stage = 0;
    socket.on('data', () => {
      if (stage++ === 0) socket.write(Buffer.from([5, 0]));
      else socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.equal(await probeSocksConnect({
      proxyPort: address.port,
      targetHost: 'www.hkust-gz.edu.cn',
      timeoutMs: 1000,
    }), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SOCKS tunnel waits for the complete CONNECT reply and remains open', async () => {
  const server = net.createServer((socket) => {
    let stage = 0;
    socket.on('data', () => {
      if (stage++ === 0) return socket.write(Buffer.from([5, 0]));
      socket.write(Buffer.from([5, 0, 0, 3, 4]));
      setTimeout(() => socket.write(Buffer.from([1, 2, 3, 4, 1, 187])), 10);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const socket = await openSocksTunnel({
      proxyPort: server.address().port,
      targetHost: 'www.hkust-gz.edu.cn',
      timeoutMs: 1000,
    });
    assert.ok(socket && !socket.destroyed);
    socket.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
