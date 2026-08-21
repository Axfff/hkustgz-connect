'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadTrayImage, TRAY_SIZE } = require('../lib/tray-icon');

test('macOS tray image is explicitly constrained to menu-bar size', () => {
  let requested = null;
  let template = false;
  const resized = {
    kind: 'resized',
    setTemplateImage: (value) => { template = value; },
  };
  const source = {
    isEmpty: () => false,
    resize: (options) => {
      requested = options;
      return resized;
    },
  };
  const nativeImage = { createFromPath: () => source };
  assert.equal(loadTrayImage(nativeImage, '/icon.png', 'darwin'), resized);
  assert.deepEqual(requested, { height: 18, quality: 'best' });
  assert.equal(template, true);
});

test('tray sizes stay bounded on every supported desktop platform', () => {
  assert.deepEqual(TRAY_SIZE, { darwin: 18, win32: 20, linux: 22 });
  assert.ok(Object.values(TRAY_SIZE).every((size) => size <= 22));
});
