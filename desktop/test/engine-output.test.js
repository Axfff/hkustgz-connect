'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyEngineOutput, engineLifecycleSignal } = require('../lib/engine-output');

test('native engine authentication failure is terminal and user-readable', () => {
  const message = classifyEngineOutput('ec-engine: gateway authentication failed', 1080);
  assert.match(message, /账号或密码错误/);
  assert.match(message, /停止自动重试/);
});

test('bind and authentication-method failures remain distinguishable', () => {
  assert.match(classifyEngineOutput('address already in use', 2080), /2080/);
  assert.match(classifyEngineOutput('Not implemented auth', 1080), /SSO\/MFA/);
  assert.equal(classifyEngineOutput('SOCKS5 server listening', 1080), null);
});

test('the latest engine lifecycle message controls readiness', () => {
  assert.equal(engineLifecycleSignal('SOCKS5 server listening on 127.0.0.1:1080'), 'ready');
  assert.equal(engineLifecycleSignal([
    'SOCKS5 server listening on 127.0.0.1:1080',
    'ec-engine: VPN data plane disconnected; reconnecting in 2 seconds',
  ].join('\n')), 'recovering');
  assert.equal(engineLifecycleSignal([
    'ec-engine: tunnel keepalive failed 2 consecutive times; reconnecting in 2 seconds',
    'SOCKS5 server listening on 127.0.0.1:1080',
  ].join('\n')), 'ready');
  assert.equal(engineLifecycleSignal('ec-engine: tunnel keepalive failed (1/2)'), null);
});
