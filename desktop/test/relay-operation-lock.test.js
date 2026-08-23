'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  RelayOperationBusyError,
  acquireRelayOperationLock,
  prepareOwnerOnlyLockFile,
  relayOperationLockPath,
} = require('../lib/relay-operation-lock');

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-relay-lock-'));
}

test('desktop relay lock is owner-only and mutually exclusive', async () => {
  const home = temporaryHome();
  const lockFile = relayOperationLockPath(home);
  const scriptedStatuses = [0, 75, 0];
  const runLockf = process.platform === 'darwin'
    ? undefined
    : (command, args, options) => {
      assert.equal(command, '/usr/bin/lockf');
      assert.deepEqual(args, ['-s', '-t', '0', '3']);
      assert.equal(Number.isInteger(options.stdio[3]), true);
      return { status: scriptedStatuses.shift(), stderr: Buffer.alloc(0) };
    };
  const acquire = () => acquireRelayOperationLock({ lockFile, runLockf });
  const lease = await acquire();

  assert.equal(fs.statSync(path.dirname(lockFile)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(lockFile).mode & 0o777, 0o600);
  assert.throws(
    () => acquire(),
    (error) => error instanceof RelayOperationBusyError
      && error.code === 'RELAY_OPERATION_BUSY',
  );

  assert.equal(await lease.release(), true);
  assert.equal(await lease.release(), false);
  assert.equal(fs.existsSync(lockFile), true, 'persistent lock files avoid unlink races');

  const nextLease = await acquire();
  assert.equal(await nextLease.release(), true);
  assert.equal(scriptedStatuses.length, process.platform === 'darwin' ? 3 : 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test('owner-only preparation rejects a symlinked lock path', () => {
  const home = temporaryHome();
  const lockFile = relayOperationLockPath(home);
  const target = path.join(home, 'target');
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(target, 'unchanged', { mode: 0o644 });
  fs.symlinkSync(target, lockFile);

  assert.throws(
    () => prepareOwnerOnlyLockFile(lockFile),
    /not a regular file/,
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  assert.equal(fs.statSync(target).mode & 0o777, 0o644);
  fs.rmSync(home, { recursive: true, force: true });
});
