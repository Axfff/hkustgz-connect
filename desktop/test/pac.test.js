'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildPac, normalizeRouteDomains } = require('../lib/pac');

test('route domains are normalized, deduplicated, and bounded', () => {
  assert.deepEqual(
    normalizeRouteDomains('*.HKUST-GZ.EDU.CN\n.hkust.edu.hk;bad/domain\nhkust.edu.hk'),
    ['hkust-gz.edu.cn', 'hkust.edu.hk'],
  );
  assert.equal(normalizeRouteDomains(Array(100).fill('example.com')).length, 1);
});

test('PAC routes only explicit suffixes and locally supplied IPv4 ranges', () => {
  const source = buildPac(['hkust-gz.edu.cn'], 6180, ['198.51.100.0/24', '203.0.113.9/32']);
  assert.doesNotMatch(source, /dnsResolve|isInNet|PROXY /);
  assert.match(source, /SOCKS5 127\.0\.0\.1:6180/);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(
    context.FindProxyForURL('https://www.hkust-gz.edu.cn/', 'www.hkust-gz.edu.cn'),
    'SOCKS5 127.0.0.1:6180',
  );
  assert.equal(
    context.FindProxyForURL('https://hkust-gz.edu.cn/', 'hkust-gz.edu.cn'),
    'SOCKS5 127.0.0.1:6180',
  );
  assert.equal(
    context.FindProxyForURL('https://remote.hkust-gz.edu.cn/', 'remote.hkust-gz.edu.cn'),
    'DIRECT',
  );
  assert.equal(
    context.FindProxyForURL('https://REMOTE.HKUST-GZ.EDU.CN./', 'REMOTE.HKUST-GZ.EDU.CN.'),
    'DIRECT',
  );
  assert.equal(
    context.FindProxyForURL('https://x.remote.hkust-gz.edu.cn/', 'x.remote.hkust-gz.edu.cn'),
    'SOCKS5 127.0.0.1:6180',
  );
  assert.equal(
    context.FindProxyForURL('https://not-hkust-gz.edu.cn/', 'not-hkust-gz.edu.cn'),
    'DIRECT',
  );
  assert.equal(context.FindProxyForURL('http://198.51.100.1/', '198.51.100.1'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('http://198.51.100.255/', '198.51.100.255'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('http://203.0.113.9/', '203.0.113.9'), 'SOCKS5 127.0.0.1:6180');
  assert.equal(context.FindProxyForURL('http://198.51.99.255/', '198.51.99.255'), 'DIRECT');
  assert.equal(context.FindProxyForURL('http://203.0.113.10/', '203.0.113.10'), 'DIRECT');
  assert.equal(context.FindProxyForURL('http://198.51.100.999/', '198.51.100.999'), 'DIRECT');
  assert.equal(context.FindProxyForURL('https://example.com/', 'example.com'), 'DIRECT');
});

test('PAC has no private IPv4 routes unless a local policy supplies them', () => {
  const source = buildPac(['hkust-gz.edu.cn'], 6180);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(context.FindProxyForURL('http://192.0.2.1/', '192.0.2.1'), 'DIRECT');
});
