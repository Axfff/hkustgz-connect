'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { AppLifecycle } = require('../lib/app-lifecycle');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new AppLifecycle({ directory });
}

function requestShutdown(lifecycle, patch = {}) {
  fs.writeFileSync(lifecycle.requestFile, JSON.stringify({
    version: 1, session_id: lifecycle.session.session_id, pid: lifecycle.session.pid, ...patch,
  }), { mode: 0o600 });
}

test('manual quit remains stopped after a new supervisor and rejects unattended startup', (t) => {
  const lifecycle = fixture(t);
  assert.equal(lifecycle.automaticLaunchAllowed(), true);
  lifecycle.beginSession();
  lifecycle.finishSession();
  const restarted = new AppLifecycle({ directory: lifecycle.directory });
  assert.equal(restarted.automaticLaunchAllowed(), false);
  assert.equal(restarted.beginSession({ automatic: true }), false);
  assert.equal(restarted.beginSession({ login: true }), false);
  assert.equal(restarted.readSession().status, 'manual-stopped');
  assert.equal(restarted.beginSession(), true);
  assert.equal(restarted.readSession().status, 'running');
});

test('immediate SIGKILL before supervisor polling leaves a durable inhibited session', (t) => {
  const lifecycle = fixture(t);
  const source = require.resolve('../lib/app-lifecycle');
  const result = spawnSync(process.execPath, ['-e', `
    const { AppLifecycle } = require(${JSON.stringify(source)});
    new AppLifecycle({ directory: process.argv[1] }).beginSession();
    process.kill(process.pid, 'SIGKILL');
  `, lifecycle.directory]);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(lifecycle.readSession().status, 'running');
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
  assert.equal(lifecycle.beginSession({ automatic: true }), false);
});

test('only a matching relay signal rearms a clean campus shutdown', (t) => {
  const lifecycle = fixture(t);
  lifecycle.beginSession();
  requestShutdown(lifecycle);
  lifecycle.acceptRelayShutdown();
  lifecycle.finishSession();
  assert.equal(lifecycle.readSession().status, 'campus-stopped');
  assert.equal(lifecycle.automaticLaunchAllowed(), true);
  assert.equal(lifecycle.beginSession({ automatic: true }), true);
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});

test('an untagged Activity Monitor Quit remains stopped', (t) => {
  const lifecycle = fixture(t);
  lifecycle.beginSession();
  lifecycle.acceptRelayShutdown();
  lifecycle.finishSession();
  assert.equal(lifecycle.readSession().status, 'manual-stopped');
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
});

test('manual Quit overrides a simultaneous relay shutdown request', (t) => {
  const lifecycle = fixture(t);
  lifecycle.beginSession();
  requestShutdown(lifecycle);
  lifecycle.acceptRelayShutdown();
  lifecycle.finishSession({ manual: true });
  assert.equal(lifecycle.readSession().status, 'manual-stopped');
});

test('stale, malformed or mismatched shutdown requests cannot rearm launch', (t) => {
  for (const patch of [{ pid: process.pid + 1 }, { session_id: 'not-a-session' }, { version: 2 }]) {
    const lifecycle = fixture(t);
    lifecycle.beginSession();
    requestShutdown(lifecycle, patch);
    lifecycle.acceptRelayShutdown();
    lifecycle.finishSession();
    assert.equal(lifecycle.automaticLaunchAllowed(), false);
  }
});

test('malformed session state and symlinks block unattended startup', (t) => {
  const lifecycle = fixture(t);
  for (const value of ['null', '{}', 'not json']) {
    fs.writeFileSync(lifecycle.sessionFile, value, { mode: 0o600 });
    assert.equal(lifecycle.automaticLaunchAllowed(), false);
  }
  fs.unlinkSync(lifecycle.sessionFile);
  const outside = path.join(lifecycle.directory, 'other.json');
  fs.writeFileSync(outside, '{}', { mode: 0o600 });
  fs.symlinkSync(outside, lifecycle.sessionFile);
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
  assert.throws(() => lifecycle.beginSession(), /owner-only regular file/);
});

test('the explicit pause override survives manual reopening and campus shutdown', (t) => {
  const lifecycle = fixture(t);
  fs.writeFileSync(lifecycle.pauseFile, '', { mode: 0o600 });
  assert.equal(lifecycle.beginSession({ automatic: true }), false);
  lifecycle.beginSession();
  requestShutdown(lifecycle);
  lifecycle.acceptRelayShutdown();
  lifecycle.finishSession();
  assert.equal(lifecycle.automaticLaunchAllowed(), false);
  fs.unlinkSync(lifecycle.pauseFile);
  assert.equal(lifecycle.automaticLaunchAllowed(), true);
});

test('state files have owner-only access and unrelated platforms remain unaffected', (t) => {
  const lifecycle = fixture(t);
  lifecycle.beginSession();
  assert.equal(fs.statSync(lifecycle.sessionFile).mode & 0o777, 0o600);
  const disabled = new AppLifecycle({ directory: lifecycle.directory, enabled: false });
  assert.equal(disabled.beginSession({ automatic: true }), true);
  disabled.finishSession();
  assert.equal(lifecycle.readSession().status, 'running');
});
