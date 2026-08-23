'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { renderMihomoProfile } = require('../lib/mihomo-profile');

const template = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'mihomo-hkustgz.yaml.template'),
  'utf8',
);

test('Mihomo snippet preserves the primary policy and routes campus traffic explicitly', () => {
  const rendered = renderMihomoProfile(template, {
    port: 2080,
    routeDomains: ['hkust-gz.edu.cn', 'hkust.edu.hk'],
    routeIpv4Cidrs: ['198.51.100.9/32'],
  });
  assert.match(rendered, /server: 127\.0\.0\.1\n    port: 2080/);
  assert.match(rendered, /udp: false/);
  const domainUdpGuard = 'AND,((DOMAIN-SUFFIX,hkust-gz.edu.cn),(NETWORK,udp)),REJECT';
  const cidrUdpGuard = 'AND,((IP-CIDR,198.51.100.9/32,no-resolve),(NETWORK,udp)),REJECT';
  const gatewayDirect = 'DOMAIN,remote.hkust-gz.edu.cn,DIRECT';
  const domainRoute = 'DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ';
  const cidrRoute = 'IP-CIDR,198.51.100.9/32,HKUSTGZ,no-resolve';
  for (const rule of [domainUdpGuard, cidrUdpGuard, gatewayDirect, domainRoute, cidrRoute]) {
    assert.ok(rendered.includes(rule), `missing rule: ${rule}`);
  }
  assert.ok(rendered.indexOf(domainUdpGuard) < rendered.indexOf(gatewayDirect));
  assert.ok(rendered.indexOf(cidrUdpGuard) < rendered.indexOf(gatewayDirect));
  assert.ok(rendered.indexOf(gatewayDirect) < rendered.indexOf(domainRoute));
  assert.ok(rendered.indexOf(gatewayDirect) < rendered.indexOf(cidrRoute));
  assert.doesNotMatch(rendered, /MATCH,/);
  assert.doesNotMatch(rendered, /password|username/i);
});

test('Mihomo snippet rejects invalid ports and malformed markers', () => {
  assert.throws(() => renderMihomoProfile(template, { port: 80 }), /1025/);
  assert.throws(() => renderMihomoProfile('proxies: []\n', {}), /marker/);
});
