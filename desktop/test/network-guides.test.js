'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { guideUrl, openNetworkGuide } = require('../lib/network-guides');

test('network guides use the matching release tag and fixed anchors', async () => {
  assert.equal(
    guideUrl('mihomo', '1.4.0'),
    'https://github.com/Axfff/hkustgz-connect/blob/v1.4.0/docs/NETWORK_COEXISTENCE.md#clash--mihomo',
  );
  const opened = [];
  const url = await openNetworkGuide('tailscale', '1.4.0', async (value) => opened.push(value));
  assert.deepEqual(opened, [url]);
  assert.throws(() => guideUrl('arbitrary', '1.4.0'), /Unknown/);
});
