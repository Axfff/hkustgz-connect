'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  describePortConflict, isCampusEngineExecutable, isFallbackRelayExecutable,
} = require('../lib/port-conflict');

test('a healthy CLI engine is recognized as a shared tunnel', () => {
  const message = describePortConflict({
    port: 1080,
    pid: 22535,
    executable: '/another/install/engine/target/release/ec-engine',
    campusHealthy: true,
  });
  assert.match(message, /working shared campus tunnel/);
  assert.match(message, /22535/);
});

test('packaged and source engine names are recognized', () => {
  assert.equal(isCampusEngineExecutable('/tmp/ec-engine'), true);
  assert.equal(isCampusEngineExecutable('/tmp/ec-engine-darwin-arm64'), true);
  assert.equal(isCampusEngineExecutable('/tmp/not-the-engine'), false);
});

test('only the compatibility relay executable is recognized on its listener', () => {
  assert.equal(isFallbackRelayExecutable('/home/example/bin/ec-fallback'), true);
  assert.equal(isFallbackRelayExecutable('/tmp/ec-fallback-darwin-arm64'), true);
  assert.equal(isFallbackRelayExecutable('/Applications/Other Proxy.app/proxy'), false);
});

test('an unrelated listener is not described as a campus engine', () => {
  const message = describePortConflict({
    port: 2080,
    pid: 42,
    executable: '/Applications/Other Proxy.app/Contents/MacOS/proxy',
  });
  assert.match(message, /proxy/);
  assert.doesNotMatch(message, /CLI engine/);
});
