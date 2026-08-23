'use strict';

const GUIDE_ANCHORS = Object.freeze({
  browser: 'browser-pac-and-native-socks',
  shadowrocket: 'shadowrocket',
  mihomo: 'clash--mihomo',
  tailscale: 'tailscale',
});
const GUIDE_ROOT = 'https://github.com/Axfff/hkustgz-connect/blob';

function guideUrl(topic, version = '') {
  const anchor = GUIDE_ANCHORS[String(topic || '')];
  if (!anchor) throw new Error('Unknown network guide');
  const release = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(String(version || ''))
    ? `v${version}`
    : 'main';
  return `${GUIDE_ROOT}/${release}/docs/NETWORK_COEXISTENCE.md#${anchor}`;
}

async function openNetworkGuide(topic, version, openExternal) {
  if (typeof openExternal !== 'function') throw new Error('Default browser is unavailable');
  const url = guideUrl(topic, version);
  await openExternal(url);
  return url;
}

module.exports = { GUIDE_ANCHORS, GUIDE_ROOT, guideUrl, openNetworkGuide };
