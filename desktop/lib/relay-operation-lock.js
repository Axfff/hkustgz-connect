'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const LOCK_FILE_NAME = 'compatibility-relay.lock';
const LOCKF = '/usr/bin/lockf';

class RelayOperationBusyError extends Error {
  constructor() {
    super('Compatibility relay is busy: another install, update, or remove operation is running');
    this.name = 'RelayOperationBusyError';
    this.code = 'RELAY_OPERATION_BUSY';
  }
}

function relayOperationLockPath(homeDirectory) {
  return path.join(homeDirectory, '.hkustgzconnect', LOCK_FILE_NAME);
}

function prepareOwnerOnlyLockFile(lockFile) {
  const parent = path.dirname(lockFile);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`Compatibility relay state path is not a private directory: ${parent}`);
  }
  if (typeof process.getuid === 'function' && parentStat.uid !== process.getuid()) {
    throw new Error(`Compatibility relay state directory is not owned by this user: ${parent}`);
  }
  fs.chmodSync(parent, 0o700);

  let lockStat;
  try {
    lockStat = fs.lstatSync(lockFile);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
    let descriptor;
    try {
      descriptor = fs.openSync(lockFile, 'ax', 0o600);
    } catch (createError) {
      if (!createError || createError.code !== 'EEXIST') throw createError;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    lockStat = fs.lstatSync(lockFile);
  }
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
    throw new Error(`Compatibility relay lock path is not a regular file: ${lockFile}`);
  }
  if (typeof process.getuid === 'function' && lockStat.uid !== process.getuid()) {
    throw new Error(`Compatibility relay lock file is not owned by this user: ${lockFile}`);
  }
  const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(lockFile, flags);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(lockFile);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()
      || descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      throw new Error(`Compatibility relay lock path changed while opening it: ${lockFile}`);
    }
    fs.fchmodSync(descriptor, 0o600);
  } finally {
    fs.closeSync(descriptor);
  }
}

function acquireRelayOperationLock({ lockFile, runLockf = spawnSync } = {}) {
  if (!lockFile) throw new Error('Compatibility relay lock path is required');
  prepareOwnerOnlyLockFile(lockFile);

  const flags = fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(lockFile, flags);
  try {
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(lockFile);
    if (!pathStat.isFile() || pathStat.isSymbolicLink()
      || descriptorStat.dev !== pathStat.dev || descriptorStat.ino !== pathStat.ino) {
      throw new Error(`Compatibility relay lock path changed while opening it: ${lockFile}`);
    }
    if (typeof process.getuid === 'function' && descriptorStat.uid !== process.getuid()) {
      throw new Error(`Compatibility relay lock file is not owned by this user: ${lockFile}`);
    }
    fs.fchmodSync(descriptor, 0o600);

    const result = runLockf(
      LOCKF,
      ['-s', '-t', '0', '3'],
      { stdio: ['ignore', 'ignore', 'pipe', descriptor] },
    );
    if (result.error) throw result.error;
    if (result.status === 75) throw new RelayOperationBusyError();
    if (result.status !== 0) {
      const detail = result.stderr ? result.stderr.toString('utf8').trim() : result.signal;
      throw new Error(`Could not acquire the compatibility relay lock (${detail || result.status})`);
    }
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }

  let released = false;
  return {
    lockFile,
    release() {
      if (released) return false;
      fs.closeSync(descriptor);
      released = true;
      return true;
    },
  };
}

module.exports = {
  LOCK_FILE_NAME,
  RelayOperationBusyError,
  acquireRelayOperationLock,
  prepareOwnerOnlyLockFile,
  relayOperationLockPath,
};
