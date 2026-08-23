'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ROUTE_RULES_MARKER,
  renderShadowrocketModule,
} = require('../lib/shadowrocket-module');

const template = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'shadowrocket-hkustgz.module.template'),
  'utf8',
);

test('module keeps realtime apps on the normal proxy and campus traffic isolated', () => {
  const rendered = renderShadowrocketModule(template, [
    '198.51.100.0/24',
    '203.0.113.8/32',
  ]);
  assert.match(rendered, /dns-server = https:\/\/dns\.google\/dns-query#proxy/);
  assert.match(rendered, /hijack-dns = :53/);
  assert.match(rendered, /DOMAIN-SUFFIX,chatgpt\.com,PROXY/);
  assert.match(rendered, /DOMAIN-SUFFIX,oaiusercontent\.com,PROXY/);
  assert.match(rendered, /DOMAIN,cdn\.workos\.com,PROXY/);
  assert.match(rendered, /DOMAIN,challenges\.cloudflare\.com,PROXY/);
  assert.match(rendered, /DOMAIN,remote\.hkust-gz\.edu\.cn,DIRECT/);
  assert.match(rendered, /DOMAIN-SUFFIX,hkust-gz\.edu\.cn,HKUSTGZ/);
  assert.match(rendered, /IP-CIDR,198\.51\.100\.0\/24,HKUSTGZ,no-resolve/);
  assert.doesNotMatch(rendered, new RegExp(ROUTE_RULES_MARKER));
});

test('module rendering rejects missing or duplicated route markers', () => {
  assert.throws(() => renderShadowrocketModule('[Rule]\n'), /one route marker/);
  assert.throws(
    () => renderShadowrocketModule(`${ROUTE_RULES_MARKER}\n${ROUTE_RULES_MARKER}`),
    /one route marker/,
  );
});
