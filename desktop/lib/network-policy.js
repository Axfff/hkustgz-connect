'use strict';

const fs = require('fs');
const path = require('path');
const { ensureOwnerOnly } = require('./private-file');

const EMPTY_POLICY = Object.freeze({
  version: 1,
  vpnDnsServers: Object.freeze([]),
  routeIpv4Cidrs: Object.freeze([]),
});

function splitValues(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') return input.split(/[\s,;]+/);
  if (input == null) return [];
  throw new Error('Network policy entries must be text or an array');
}

function parseIpv4(value, label) {
  const text = String(value).trim();
  const octets = text.split('.');
  if (octets.length !== 4 || octets.some((octet) =>
    !/^(0|[1-9][0-9]{0,2})$/.test(octet)
    || Number(octet) > 255)) {
    throw new Error(`${label} contains an invalid IPv4 address`);
  }
  return {
    text,
    number: octets.reduce((result, octet) => ((result * 256) + Number(octet)) >>> 0, 0),
    octets: octets.map(Number),
  };
}

function normalizeVpnDnsServers(input) {
  const result = [];
  for (const value of splitValues(input)) {
    if (String(value).trim() === '') continue;
    const address = parseIpv4(value, 'VPN DNS servers');
    const first = address.octets[0];
    if (address.number === 0 || address.number === 0xffffffff || (first >= 224 && first <= 239)) {
      throw new Error('VPN DNS servers contain an unusable IPv4 address');
    }
    if (!result.includes(address.text)) result.push(address.text);
    if (result.length > 4) throw new Error('VPN DNS servers are limited to 4 entries');
  }
  return result;
}

function normalizeRouteIpv4Cidrs(input) {
  const result = [];
  for (const value of splitValues(input)) {
    const text = String(value).trim();
    if (!text) continue;
    const parts = text.split('/');
    if (parts.length !== 2 || !/^[0-9]{1,2}$/.test(parts[1])) {
      throw new Error('IPv4 routes must use CIDR notation');
    }
    const address = parseIpv4(parts[0], 'IPv4 routes');
    const prefix = Number(parts[1]);
    if (prefix < 1 || prefix > 32) throw new Error('IPv4 route prefixes must be from 1 to 32');
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    if ((address.number & mask) >>> 0 !== address.number) {
      throw new Error('IPv4 routes must use canonical network addresses');
    }
    const cidr = `${address.text}/${prefix}`;
    if (!result.includes(cidr)) result.push(cidr);
    if (result.length > 128) throw new Error('IPv4 routes are limited to 128 entries');
  }
  return result;
}

function normalizeNetworkPolicy(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Network policy must be a JSON object');
  }
  const allowed = new Set([
    'version', 'vpn_dns_servers', 'route_ipv4_cidrs', 'vpnDnsServers', 'routeIpv4Cidrs',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error(`Unsupported network policy key: ${key}`);
  }
  if (input.version != null && input.version !== 1) {
    throw new Error('Network policy version must be 1');
  }
  return {
    version: 1,
    vpnDnsServers: normalizeVpnDnsServers(input.vpnDnsServers ?? input.vpn_dns_servers),
    routeIpv4Cidrs: normalizeRouteIpv4Cidrs(input.routeIpv4Cidrs ?? input.route_ipv4_cidrs),
  };
}

function loadNetworkPolicy(file) {
  if (!fs.existsSync(file)) return { ...EMPTY_POLICY, vpnDnsServers: [], routeIpv4Cidrs: [] };
  return normalizeNetworkPolicy(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function saveNetworkPolicy(file, policy) {
  const normalized = normalizeNetworkPolicy(policy);
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, JSON.stringify({
      version: 1,
      vpn_dns_servers: normalized.vpnDnsServers,
      route_ipv4_cidrs: normalized.routeIpv4Cidrs,
    }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
    ensureOwnerOnly(file);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {}
  }
  return normalized;
}

function networkPoliciesEqual(left, right) {
  const a = normalizeNetworkPolicy(left);
  const b = normalizeNetworkPolicy(right);
  return JSON.stringify(a) === JSON.stringify(b);
}

module.exports = {
  EMPTY_POLICY,
  loadNetworkPolicy,
  networkPoliciesEqual,
  normalizeNetworkPolicy,
  normalizeRouteIpv4Cidrs,
  normalizeVpnDnsServers,
  saveNetworkPolicy,
};
