'use strict';

const { normalizeRouteIpv4Cidrs } = require('./network-policy');

const ROUTE_RULES_MARKER = '__ROUTE_IPV4_RULES__';
const TUN_ROUTES_MARKER = '__TUN_INCLUDED_ROUTES__';
const UDP_REJECT_RULES_MARKER = '__UDP_REJECT_RULES__';

function assertSingleMarker(source, marker, label) {
  const markerCount = source.split(marker).length - 1;
  if (markerCount !== 1) {
    throw new Error(`Shadowrocket module template must contain one ${label} marker`);
  }
}

function renderShadowrocketModule(template, routeIpv4Cidrs = []) {
  const source = String(template || '');
  assertSingleMarker(source, ROUTE_RULES_MARKER, 'route-rule');
  assertSingleMarker(source, TUN_ROUTES_MARKER, 'TUN-route');
  assertSingleMarker(source, UDP_REJECT_RULES_MARKER, 'UDP-reject-rule');
  const routes = normalizeRouteIpv4Cidrs(routeIpv4Cidrs);
  const udpRejectRules = routes
    .map((cidr) =>
      `AND,((PROTOCOL,UDP),(IP-CIDR,${cidr},no-resolve)),REJECT-NO-DROP`)
    .join('\n');
  const routeRules = routes
    .map((cidr) => `IP-CIDR,${cidr},HKUSTGZ,no-resolve`)
    .join('\n');
  const tunRoutes = routes.length ? `tun-included-routes = ${routes.join(', ')}` : '';
  return source
    .replace(TUN_ROUTES_MARKER, tunRoutes)
    .replace(UDP_REJECT_RULES_MARKER, udpRejectRules)
    .replace(ROUTE_RULES_MARKER, routeRules)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

module.exports = {
  ROUTE_RULES_MARKER,
  TUN_ROUTES_MARKER,
  UDP_REJECT_RULES_MARKER,
  renderShadowrocketModule,
};
