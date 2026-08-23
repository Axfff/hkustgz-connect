'use strict';

const { normalizeRouteIpv4Cidrs } = require('./network-policy');

const ROUTE_RULES_MARKER = '__ROUTE_IPV4_RULES__';
const TUN_ROUTES_MARKER = '__TUN_INCLUDED_ROUTES__';

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
  const routes = normalizeRouteIpv4Cidrs(routeIpv4Cidrs);
  const rules = routes
    .map((cidr) => `IP-CIDR,${cidr},HKUSTGZ,no-resolve`)
    .join('\n');
  const tunRoutes = routes.length ? `tun-included-routes = ${routes.join(', ')}` : '';
  return source
    .replace(TUN_ROUTES_MARKER, tunRoutes)
    .replace(ROUTE_RULES_MARKER, rules)
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n';
}

module.exports = { ROUTE_RULES_MARKER, TUN_ROUTES_MARKER, renderShadowrocketModule };
