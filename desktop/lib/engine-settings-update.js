'use strict';

function planEngineSettingsUpdate({ engineOwner, portChanged, policyChanged }) {
  if (engineOwner === 'shared' && portChanged) {
    return {
      allowed: false,
      reconnect: false,
      warning: null,
      error: 'The campus SOCKS port cannot be changed while this app is attached to a tunnel owned by the CLI or another interface. Stop that tunnel from its owning interface, then save the port again. The shared tunnel was not stopped and no settings were changed.',
    };
  }

  if (engineOwner === 'app' && (portChanged || policyChanged)) {
    return {
      allowed: true,
      reconnect: true,
      warning: null,
      error: null,
    };
  }

  if (engineOwner === 'shared' && policyChanged) {
    return {
      allowed: true,
      reconnect: false,
      warning: 'Network policy saved. Restart the tunnel from the interface that owns it to apply engine routes.',
      error: null,
    };
  }

  return {
    allowed: true,
    reconnect: false,
    warning: null,
    error: null,
  };
}

module.exports = { planEngineSettingsUpdate };
