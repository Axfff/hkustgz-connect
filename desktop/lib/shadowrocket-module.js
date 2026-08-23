'use strict';

const { normalizeRouteIpv4Cidrs } = require('./network-policy');

const ROUTE_RULES_MARKER = '__ROUTE_IPV4_RULES__';

function renderShadowrocketModule(template, routeIpv4Cidrs = []) {
  const source = String(template || '');
  const markerCount = source.split(ROUTE_RULES_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new Error('Shadowrocket module template must contain one route marker');
  }
  const rules = normalizeRouteIpv4Cidrs(routeIpv4Cidrs)
    .map((cidr) => `IP-CIDR,${cidr},HKUSTGZ,no-resolve`)
    .join('\n');
  return source.replace(ROUTE_RULES_MARKER, rules).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = { ROUTE_RULES_MARKER, renderShadowrocketModule };
