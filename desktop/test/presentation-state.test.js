'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  connectionPresentation,
  deriveOperationalState,
} = require('../lib/presentation-state');

test('a listener is not called healthy until a campus probe succeeds', () => {
  assert.equal(deriveOperationalState({ connected: true }), 'checking');
  assert.equal(deriveOperationalState({
    connected: true,
    lastHealthyAt: Date.now(),
  }), 'healthy');
});

test('recovery and data-plane failures have distinct operational states', () => {
  assert.equal(deriveOperationalState({ connecting: true, attempts: 1 }), 'reconnecting');
  assert.equal(deriveOperationalState({ connected: true, probeFailures: 1 }), 'degraded');
  assert.equal(deriveOperationalState({ lastError: 'bad credentials' }), 'blocked');
});

test('every operational state has a primary action and visible label', () => {
  for (const kind of [
    'disconnected', 'connecting', 'checking', 'healthy',
    'degraded', 'reconnecting', 'blocked',
  ]) {
    const presentation = connectionPresentation(kind);
    assert.ok(presentation.label);
    assert.ok(presentation.title);
    assert.ok(presentation.action);
  }
});
