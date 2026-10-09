'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { AppLifecycle } = require('../lib/app-lifecycle');

async function runStartup(t, { automatic = false, login = false, priorStop = true, pendingReady = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-startup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configHome = path.join(directory, 'config');
  const lifecycle = new AppLifecycle({ directory: path.join(configHome, 'hkustgz-connect') });
  if (priorStop) { lifecycle.beginSession(); lifecycle.finishSession(); }
  const calls = { credentials: 0, locks: 0, quit: 0, exit: 0 };
  const appEvents = new Map();
  const signals = new Map();
  const userData = path.join(directory, 'userData');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ autoConnect: false }), { mode: 0o600 });
  const electron = {
    app: {
      getPath: (name) => name === 'home' ? directory : userData,
      requestSingleInstanceLock: () => { calls.locks++; return true; },
      quit: () => { calls.quit++; appEvents.get('before-quit')?.(); },
      exit: () => { calls.exit++; },
      setName() {}, on: (name, callback) => appEvents.set(name, callback),
      whenReady: () => pendingReady ? new Promise(() => {}) : Promise.resolve(),
      getLoginItemSettings: () => ({ wasOpenedAtLogin: login }),
    },
    ipcMain: { handle() {} },
    safeStorage: {
      isEncryptionAvailable() { calls.credentials++; throw new Error('Unexpected Keychain access'); },
      decryptString() { calls.credentials++; throw new Error('Unexpected Keychain access'); },
    },
    Menu: { setApplicationMenu() {}, buildFromTemplate: (value) => value },
    // Simulate an abrupt failure at the first UI operation. The durable session
    // must already exist, without accessing credentials or the network.
    nativeImage: { createFromPath() { throw new Error('Simulated UI startup failure'); } },
    dialog: { showErrorBox() {} },
  };
  const filename = path.join(__dirname, '..', 'main.js');
  const localRequire = createRequire(filename);
  const mockProcess = {
    platform: 'darwin', arch: process.arch, pid: process.pid,
    argv: automatic ? ['app', '--campus-auto'] : ['app'],
    env: { XDG_CONFIG_HOME: configHome }, on: (name, callback) => signals.set(name, callback),
  };
  const source = fs.readFileSync(filename, 'utf8');
  const wrapper = vm.runInNewContext(
    `(function(require, module, __dirname, process) { ${source}\n })`,
    { console, setTimeout, clearTimeout, setInterval, clearInterval, Buffer },
    { filename },
  );
  wrapper((name) => name === 'electron' ? electron : localRequire(name), {}, path.dirname(filename), mockProcess);
  await new Promise((resolve) => setImmediate(resolve));
  return { lifecycle, calls, signals };
}

test('relay-triggered startup exits before instance lock and any Keychain access after manual stop', async (t) => {
  const { lifecycle, calls } = await runStartup(t, { automatic: true });
  assert.equal(calls.quit, 1);
  assert.equal(calls.locks, 0);
  assert.equal(calls.credentials, 0);
  assert.equal(lifecycle.readSession().status, 'manual-stopped');
});

test('login startup also preserves launch inhibition without Keychain access', async (t) => {
  const { lifecycle, calls } = await runStartup(t, { login: true });
  assert.equal(calls.quit, 1);
  assert.equal(calls.exit, 0);
  assert.equal(calls.credentials, 0);
  // The new startup session remains inhibited, including if Quit is abrupt.
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});

test('Force Quit before Electron readiness still leaves a durable inhibited session', async (t) => {
  const { lifecycle, calls } = await runStartup(t, { priorStop: false, pendingReady: true });
  assert.equal(calls.quit, 0);
  assert.equal(calls.credentials, 0);
  assert.equal(lifecycle.readSession().status, 'running');
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});

test('a relay signal during pending login admission cannot undo a prior manual stop', async (t) => {
  const { lifecycle, signals } = await runStartup(t, { login: true, pendingReady: true });
  const session = lifecycle.readSession();
  fs.writeFileSync(lifecycle.requestFile, JSON.stringify({
    version: 1, session_id: session.session_id, pid: session.pid,
  }), { mode: 0o600 });
  signals.get('SIGUSR2')();
  assert.equal(lifecycle.readSession().status, 'manual-stopped');
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});

test('a fresh desktop startup records its session before the first UI operation', async (t) => {
  const { lifecycle, calls } = await runStartup(t, { priorStop: false });
  assert.equal(calls.exit, 1);
  assert.equal(calls.credentials, 0);
  assert.equal(lifecycle.readSession().status, 'running');
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});
