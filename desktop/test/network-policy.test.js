'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  loadNetworkPolicy, normalizeNetworkPolicy, saveNetworkPolicy,
} = require('../lib/network-policy');

test('network policy normalizes only the two supported local fields', () => {
  assert.deepEqual(normalizeNetworkPolicy({
    version: 1,
    vpn_dns_servers: ['192.0.2.53', '192.0.2.53'],
    route_ipv4_cidrs: ['198.51.100.0/24', '203.0.113.9/32'],
  }), {
    version: 1,
    vpnDnsServers: ['192.0.2.53'],
    routeIpv4Cidrs: ['198.51.100.0/24', '203.0.113.9/32'],
  });
  assert.throws(() => normalizeNetworkPolicy({ base_url: 'https://example.com' }), /Unsupported/);
  assert.throws(() => normalizeNetworkPolicy({ routeIpv4Cidrs: ['198.51.100.1/24'] }), /canonical/);
});

test('network policy is stored owner-only using the public schema', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-policy-'));
  const file = path.join(directory, 'policy.json');
  saveNetworkPolicy(file, {
    vpnDnsServers: '192.0.2.53',
    routeIpv4Cidrs: '198.51.100.0/24',
  });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(loadNetworkPolicy(file), {
    version: 1,
    vpnDnsServers: ['192.0.2.53'],
    routeIpv4Cidrs: ['198.51.100.0/24'],
  });
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), ['route_ipv4_cidrs', 'version', 'vpn_dns_servers']);
  fs.rmSync(directory, { recursive: true, force: true });
});
