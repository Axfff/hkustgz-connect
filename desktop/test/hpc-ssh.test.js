'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  HPC_ALIAS,
  HPC_HOST,
  MANAGED_BEGIN,
  installManagedSsh,
  managedSshState,
  removeManagedSsh,
  renderManagedBlock,
} = require('../lib/hpc-ssh');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-hpc-ssh-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configFile = path.join(directory, '.ssh', 'config');
  const helperSource = path.join(directory, 'packaged-helper');
  const helperTarget = path.join(directory, '.hkustgzconnect', 'bin', 'ec-ssh-route');
  fs.writeFileSync(helperSource, 'helper', { mode: 0o755 });
  return { configFile, helperSource, helperTarget };
}

test('managed block covers the friendly alias and real HPC hostname', () => {
  const block = renderManagedBlock({
    helperPath: '/home/example/.hkustgzconnect/bin/ec-ssh-route',
    proxyPort: 1080,
  });
  assert.match(block, new RegExp(`Host ${HPC_ALIAS} ${HPC_HOST}`));
  assert.match(block, /--proxy 127\.0\.0\.1:1080 %h %p/);
  assert.match(block, /ConnectTimeout 20/);
});

test('installation preserves user config, creates one backup, and upgrades idempotently', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  const userConfig = 'Host example\n  User alice\n';
  fs.writeFileSync(paths.configFile, userConfig, { mode: 0o644 });

  const first = installManagedSsh({ ...paths, proxyPort: 1080 });
  assert.equal(first.installed, true);
  assert.equal(fs.statSync(paths.configFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(paths.helperTarget).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(`${paths.configFile}.hkustgz-connect.backup`, 'utf8'), userConfig);
  assert.match(fs.readFileSync(paths.configFile, 'utf8'), /Host example/);

  installManagedSsh({ ...paths, proxyPort: 2080 });
  const updated = fs.readFileSync(paths.configFile, 'utf8');
  assert.equal(updated.split(MANAGED_BEGIN).length - 1, 1);
  assert.match(updated, /--proxy 127\.0\.0\.1:2080/);
  assert.equal(fs.readFileSync(`${paths.configFile}.hkustgz-connect.backup`, 'utf8'), userConfig);
});

test('removal deletes only managed material', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.writeFileSync(paths.configFile, 'Host example\n  User alice\n', { mode: 0o600 });
  installManagedSsh({ ...paths, proxyPort: 1080 });
  const state = removeManagedSsh(paths);
  assert.equal(state.installed, false);
  assert.equal(fs.existsSync(paths.helperTarget), false);
  assert.equal(fs.readFileSync(paths.configFile, 'utf8'), 'Host example\n  User alice\n');
});

test('installer refuses symlinked SSH config', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  const target = path.join(path.dirname(paths.configFile), 'real-config');
  fs.writeFileSync(target, 'Host example\n');
  fs.symlinkSync(target, paths.configFile);
  assert.throws(() => installManagedSsh({ ...paths, proxyPort: 1080 }), /regular file/);
  assert.equal(managedSshState({ ...paths, platform: 'darwin' }).installed, false);
});

test('managed state rejects a symlinked installed helper', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.configFile), { recursive: true });
  fs.mkdirSync(path.dirname(paths.helperTarget), { recursive: true });
  fs.writeFileSync(paths.configFile, renderManagedBlock({
    helperPath: paths.helperTarget,
    proxyPort: 1080,
  }));
  fs.symlinkSync(paths.helperSource, paths.helperTarget);
  assert.equal(managedSshState({ ...paths, platform: 'darwin' }).installed, false);
});
