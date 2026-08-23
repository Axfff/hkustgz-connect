'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ROUTE_RULES_MARKER,
  TUN_ROUTES_MARKER,
  UDP_REJECT_RULES_MARKER,
  renderShadowrocketModule,
} = require('../lib/shadowrocket-module');

const template = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'shadowrocket-hkustgz.module.template'),
  'utf8',
);
const repairTemplate = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'shadowrocket-hkustgz-repair.module.template'),
  'utf8',
);

test('default module changes only explicit campus routes', () => {
  const rendered = renderShadowrocketModule(template, [
    '198.51.100.0/24',
    '203.0.113.8/32',
  ]);
  assert.doesNotMatch(rendered, /dns-server|hijack-dns|ipv6\s*=/);
  assert.doesNotMatch(rendered, /DOMAIN-SUFFIX,chatgpt\.com/);
  assert.match(
    rendered,
    /tun-included-routes = 198\.51\.100\.0\/24, 203\.0\.113\.8\/32/,
  );
  const domainUdpGuard = 'AND,((PROTOCOL,UDP),(DOMAIN-SUFFIX,hkust-gz.edu.cn)),REJECT-NO-DROP';
  const cidrUdpGuard = 'AND,((PROTOCOL,UDP),(IP-CIDR,198.51.100.0/24,no-resolve)),REJECT-NO-DROP';
  const gatewayDirect = 'DOMAIN,remote.hkust-gz.edu.cn,DIRECT';
  const domainRoute = 'DOMAIN-SUFFIX,hkust-gz.edu.cn,HKUSTGZ';
  const cidrRoute = 'IP-CIDR,198.51.100.0/24,HKUSTGZ,no-resolve';
  for (const rule of [domainUdpGuard, cidrUdpGuard, gatewayDirect, domainRoute, cidrRoute]) {
    assert.ok(rendered.includes(rule), `missing rule: ${rule}`);
  }
  assert.ok(rendered.indexOf(domainUdpGuard) < rendered.indexOf(gatewayDirect));
  assert.ok(rendered.indexOf(cidrUdpGuard) < rendered.indexOf(gatewayDirect));
  assert.ok(rendered.indexOf(gatewayDirect) < rendered.indexOf(domainRoute));
  assert.ok(rendered.indexOf(gatewayDirect) < rendered.indexOf(cidrRoute));
  assert.doesNotMatch(rendered, new RegExp(ROUTE_RULES_MARKER));
  assert.doesNotMatch(rendered, new RegExp(TUN_ROUTES_MARKER));
  assert.doesNotMatch(rendered, new RegExp(UDP_REJECT_RULES_MARKER));
});

test('realtime repair is an explicit preset with global DNS changes', () => {
  const rendered = renderShadowrocketModule(repairTemplate, ['198.51.100.0/24']);
  assert.match(rendered, /dns-server = https:\/\/dns\.google\/dns-query#proxy/);
  assert.match(rendered, /private-ip-answer = true/);
  assert.match(rendered, /hijack-dns = :53/);
  assert.match(rendered, /DOMAIN-SUFFIX,chatgpt\.com,PROXY/);
  assert.match(rendered, /DOMAIN-SUFFIX,oaiusercontent\.com,PROXY/);
  assert.match(rendered, /DOMAIN,cdn\.workos\.com,PROXY/);
  assert.ok(rendered.indexOf('AND,((PROTOCOL,UDP),(DOMAIN-SUFFIX,hkust-gz.edu.cn)),REJECT-NO-DROP')
    < rendered.indexOf('DOMAIN,remote.hkust-gz.edu.cn,DIRECT'));
  assert.ok(rendered.indexOf('AND,((PROTOCOL,UDP),(IP-CIDR,198.51.100.0/24,no-resolve)),REJECT-NO-DROP')
    < rendered.indexOf('DOMAIN,remote.hkust-gz.edu.cn,DIRECT'));
});

test('module rendering omits TUN overrides when no private routes are configured', () => {
  const rendered = renderShadowrocketModule(template);
  assert.doesNotMatch(rendered, /tun-included-routes\s*=/);
  assert.doesNotMatch(rendered, /IP-CIDR,[^\n]+,HKUSTGZ/);
  assert.doesNotMatch(rendered, new RegExp(UDP_REJECT_RULES_MARKER));
});

test('module rendering rejects missing or duplicated route markers', () => {
  assert.throws(() => renderShadowrocketModule('[Rule]\n'), /one route-rule marker/);
  assert.throws(
    () => renderShadowrocketModule(
      `${TUN_ROUTES_MARKER}\n${ROUTE_RULES_MARKER}\n${ROUTE_RULES_MARKER}`,
    ),
    /one route-rule marker/,
  );
  assert.throws(
    () => renderShadowrocketModule(
      `${TUN_ROUTES_MARKER}\n${TUN_ROUTES_MARKER}\n${ROUTE_RULES_MARKER}`,
    ),
    /one TUN-route marker/,
  );
  assert.throws(
    () => renderShadowrocketModule(`${TUN_ROUTES_MARKER}\n${ROUTE_RULES_MARKER}`),
    /one UDP-reject-rule marker/,
  );
  assert.throws(
    () => renderShadowrocketModule(
      `${TUN_ROUTES_MARKER}\n${ROUTE_RULES_MARKER}\n${UDP_REJECT_RULES_MARKER}\n${UDP_REJECT_RULES_MARKER}`,
    ),
    /one UDP-reject-rule marker/,
  );
});
