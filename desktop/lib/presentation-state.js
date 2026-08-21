'use strict';

(function expose(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.ConnectionPresentation = api;
})(() => {
  function deriveOperationalState({
    connected = false,
    connecting = false,
    recovering = false,
    attempts = 0,
    probeFailures = 0,
    lastHealthyAt = null,
    lastError = null,
  } = {}) {
    if (recovering || (connecting && attempts > 0)) return 'reconnecting';
    if (connecting) return 'connecting';
    if (connected) {
      if (probeFailures > 0) return 'degraded';
      return lastHealthyAt ? 'healthy' : 'checking';
    }
    return lastError ? 'blocked' : 'disconnected';
  }

  function connectionPresentation(kind) {
    const values = {
      disconnected: {
        label: 'Disconnected',
        title: 'Campus access is disconnected',
        action: 'Connect',
        tone: 'neutral',
      },
      connecting: {
        label: 'Connecting',
        title: 'Connecting to campus access',
        action: 'Cancel',
        tone: 'pending',
      },
      checking: {
        label: 'Checking',
        title: 'Verifying the campus data path',
        action: 'Disconnect',
        tone: 'pending',
      },
      healthy: {
        label: 'Connected',
        title: 'Campus access is healthy',
        action: 'Disconnect',
        tone: 'healthy',
      },
      degraded: {
        label: 'Needs attention',
        title: 'Campus access needs attention',
        action: 'Disconnect',
        tone: 'warning',
      },
      reconnecting: {
        label: 'Reconnecting',
        title: 'Reconnecting campus access',
        action: 'Cancel',
        tone: 'pending',
      },
      blocked: {
        label: 'Blocked',
        title: 'Campus access could not start',
        action: 'Try again',
        tone: 'danger',
      },
    };
    return values[kind] || values.disconnected;
  }

  return { connectionPresentation, deriveOperationalState };
});
