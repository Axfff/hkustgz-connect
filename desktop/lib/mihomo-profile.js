'use strict';

const { normalizeRouteIpv4Cidrs } = require('./network-policy');
const { normalizeRouteDomains } = require('./pac');

const PORT_MARKER = '__SOCKS_PORT__';
const DOMAIN_RULES_MARKER = '__ROUTE_DOMAIN_RULES__';
const UDP_REJECT_RULES_MARKER = '__UDP_REJECT_RULES__';
const IPV4_RULES_MARKER = '__ROUTE_IPV4_RULES__';

function assertSingleMarker(source, marker, label) {
  if (source.split(marker).length - 1 !== 1) {
    throw new Error(`Mihomo template must contain one ${label} marker`);
  }
}

function renderMihomoProfile(template, {
  port = 1080,
  routeDomains,
  routeIpv4Cidrs = [],
} = {}) {
  const source = String(template || '');
  assertSingleMarker(source, PORT_MARKER, 'SOCKS-port');
  assertSingleMarker(source, DOMAIN_RULES_MARKER, 'domain-rules');
  assertSingleMarker(source, UDP_REJECT_RULES_MARKER, 'UDP-reject-rules');
  assertSingleMarker(source, IPV4_RULES_MARKER, 'IPv4-rules');
  const proxyPort = Number(port);
  if (!Number.isInteger(proxyPort) || proxyPort < 1025 || proxyPort > 65535) {
    throw new Error('Mihomo SOCKS port must be within 1025..65535');
  }
  const domains = normalizeRouteDomains(routeDomains);
  const routes = normalizeRouteIpv4Cidrs(routeIpv4Cidrs);
  const udpRejectRules = [
    ...domains.map((domain) =>
      `  - AND,((DOMAIN-SUFFIX,${domain}),(NETWORK,udp)),REJECT`),
    ...routes.map((cidr) =>
      `  - AND,((IP-CIDR,${cidr},no-resolve),(NETWORK,udp)),REJECT`),
  ].join('\n');
  const domainRules = domains
    .map((domain) => `  - DOMAIN-SUFFIX,${domain},HKUSTGZ`)
    .join('\n');
  const ipv4Rules = routes
    .map((cidr) => `  - IP-CIDR,${cidr},HKUSTGZ,no-resolve`)
    .join('\n');
  return source
    .replace(PORT_MARKER, String(proxyPort))
    .replace(UDP_REJECT_RULES_MARKER, udpRejectRules)
    .replace(DOMAIN_RULES_MARKER, domainRules)
    .replace(IPV4_RULES_MARKER, ipv4Rules)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

module.exports = {
  DOMAIN_RULES_MARKER,
  IPV4_RULES_MARKER,
  PORT_MARKER,
  UDP_REJECT_RULES_MARKER,
  renderMihomoProfile,
};
