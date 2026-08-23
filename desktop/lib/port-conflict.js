'use strict';

const path = require('node:path');

function isCampusEngineExecutable(executable) {
  const processName = executable ? path.basename(executable) : '';
  return /^ec-engine(?:-|$)/i.test(processName);
}

function isFallbackRelayExecutable(executable) {
  const processName = executable ? path.basename(executable) : '';
  return /^ec-fallback(?:-|$)/i.test(processName);
}

function describePortConflict({ port, pid, executable, campusHealthy = false }) {
  const processName = executable ? path.basename(executable) : '';
  const owner = Number.isInteger(pid) && pid > 0 ? `process ${pid}` : 'another process';
  const isCampusEngine = isCampusEngineExecutable(executable);

  if (isCampusEngine && campusHealthy) {
    return `Port ${port} already has a working shared campus tunnel (${owner}).`;
  }
  if (isCampusEngine) {
    return `Port ${port} is owned by another HKUST(GZ) engine (${owner}), but its campus data path is not healthy. Stop that engine before connecting with this app.`;
  }
  const namedOwner = processName ? `${processName} (${owner})` : owner;
  return `Port ${port} is already in use by ${namedOwner}. Choose a free SOCKS port in Settings or stop the owning application.`;
}

module.exports = { describePortConflict, isCampusEngineExecutable, isFallbackRelayExecutable };
