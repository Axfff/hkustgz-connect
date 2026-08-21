'use strict';

const { domainToASCII } = require('url');
const { normalizeRouteIpv4Cidrs } = require('./network-policy');

const DEFAULT_ROUTE_DOMAINS = Object.freeze([
  'hkust-gz.edu.cn',
  'hkust.edu.hk',
]);
const MAX_ROUTE_DOMAINS = 64;

function normalizeRouteDomains(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[\s,;]+/)
      : DEFAULT_ROUTE_DOMAINS;
  const normalized = [];
  for (const value of values) {
    const candidate = String(value)
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/^\.+|\.+$/g, '');
    if (!candidate || /[\\/?#:@[\]%]/.test(candidate)) continue;
    const domain = domainToASCII(candidate);
    if (!domain
      || domain.length > 253
      || domain.split('.').some((label) =>
        !label
        || label.length > 63
        || !/^[a-z0-9-]+$/.test(label)
        || label.startsWith('-')
        || label.endsWith('-'))
      || normalized.includes(domain)) {
      continue;
    }
    normalized.push(domain);
    if (normalized.length >= MAX_ROUTE_DOMAINS) break;
  }
  return normalized.length ? normalized : [...DEFAULT_ROUTE_DOMAINS];
}

function buildPac(routeDomains, port, routeIpv4Cidrs = []) {
  const domains = normalizeRouteDomains(routeDomains);
  const cidrs = normalizeRouteIpv4Cidrs(routeIpv4Cidrs);
  const proxyPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 1080;
  return `'use strict';
var ROUTE_DOMAINS = ${JSON.stringify(domains)};
var ROUTE_IPV4_CIDRS = ${JSON.stringify(cidrs)};
var VPN_GATEWAY = "remote.hkust-gz.edu.cn";
function ipv4Number(host) {
  var octets = host.split(".");
  if (octets.length !== 4) return null;
  var result = 0;
  for (var i = 0; i < octets.length; i++) {
    var value = Number(octets[i]);
    if (octets[i] === "" ||
        octets[i].length > 3 ||
        !isFinite(value) ||
        Math.floor(value) !== value ||
        value < 0 ||
        value > 255 ||
        String(value) !== octets[i]) return null;
    result = (result * 256 + value) >>> 0;
  }
  return result;
}
function isRoutedIPv4(host) {
  var address = ipv4Number(host);
  if (address === null) return false;
  for (var i = 0; i < ROUTE_IPV4_CIDRS.length; i++) {
    var parts = ROUTE_IPV4_CIDRS[i].split("/");
    var network = ipv4Number(parts[0]);
    var prefix = Number(parts[1]);
    if (network === null || prefix < 1 || prefix > 32) continue;
    var mask = prefix === 32 ? 4294967295 : (4294967295 << (32 - prefix)) >>> 0;
    if (((address & mask) >>> 0) === ((network & mask) >>> 0)) return true;
  }
  return false;
}
function FindProxyForURL(url, host) {
  host = String(host || "").toLowerCase().replace(/\\.$/, "");
  // The outer VPN connection must never be sent back into its own SOCKS proxy.
  if (host === VPN_GATEWAY) return "DIRECT";
  if (isRoutedIPv4(host)) return "SOCKS5 127.0.0.1:${proxyPort}";
  for (var i = 0; i < ROUTE_DOMAINS.length; i++) {
    var domain = ROUTE_DOMAINS[i];
    if (host === domain ||
        (host.length > domain.length &&
         host.slice(-(domain.length + 1)) === "." + domain))
      return "SOCKS5 127.0.0.1:${proxyPort}";
  }
  return "DIRECT";
}
`;
}

module.exports = { DEFAULT_ROUTE_DOMAINS, buildPac, normalizeRouteDomains };
