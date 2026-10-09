'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  FALLBACK_LABEL,
  fallbackServiceState,
  installFallbackService,
  parseDefaultInterface,
  parseLaunchAgentConfiguration,
  physicalInterfaceIsActive,
  refreshFallbackServiceBinary,
  removeFallbackService,
  renderLaunchAgent,
  validatePorts,
} = require('../lib/fallback-service');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hkustgz-relay-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'packaged-relay');
  const executable = path.join(directory, 'runtime', 'ec-fallback');
  const launchAgent = path.join(directory, 'LaunchAgents', `${FALLBACK_LABEL}.plist`);
  fs.writeFileSync(source, 'relay', { mode: 0o755 });
  return { source, executable, launchAgent };
}

function unloadedServiceError() {
  const error = new Error('Could not find service');
  error.code = 113;
  return error;
}

function managedFixture(t) {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'previous relay', { mode: 0o750 });
  const plist = renderLaunchAgent({
    executable: paths.executable,
    upstreamPort: 2080,
    primaryProxyPort: 3080,
    directInterface: 'en9',
  }).replace('  </dict>', [
    '    <key>StandardOutPath</key><string>/tmp/custom-relay.log</string>',
    '    <key>EnvironmentVariables</key><dict><key>CUSTOM</key><string>kept</string></dict>',
    '  </dict>',
  ].join('\n'));
  fs.writeFileSync(paths.launchAgent, plist, { mode: 0o640 });
  return { paths, plist };
}

function runner(calls, {
  loaded = false,
  defaultInterface = 'en7',
  activeInterfaces = ['en7'],
  failBootstrapAt = null,
  failKickstartAt = null,
  unloadOnKickstartAt = null,
  bootoutError = null,
} = {}) {
  let serviceLoaded = loaded;
  let bootstrapCalls = 0;
  let kickstartCalls = 0;
  const run = (command, args, _options, callback) => {
    calls.push([command, ...args]);
    if (command === '/sbin/route') return callback(null, `   interface: ${defaultInterface}\n`);
    if (command === '/sbin/ifconfig') {
      const status = activeInterfaces.includes(args[0]) ? 'active' : 'inactive';
      return callback(null, `status: ${status}\n`);
    }
    if (command === '/bin/launchctl' && args[0] === 'print') {
      return serviceLoaded
        ? callback(null, 'state = running\n')
        : callback(unloadedServiceError(), '', 'Could not find service');
    }
    if (command === '/bin/launchctl' && args[0] === 'bootout') {
      if (bootoutError) return callback(bootoutError);
      serviceLoaded = false;
      return callback(null, '');
    }
    if (command === '/bin/launchctl' && args[0] === 'bootstrap') {
      bootstrapCalls += 1;
      if (bootstrapCalls === failBootstrapAt) return callback(new Error('service rejected'));
      serviceLoaded = true;
      return callback(null, '');
    }
    if (command === '/bin/launchctl' && args[0] === 'kickstart') {
      kickstartCalls += 1;
      if (kickstartCalls === failKickstartAt) return callback(new Error('kickstart rejected'));
      if (kickstartCalls === unloadOnKickstartAt) serviceLoaded = false;
      return callback(null, '');
    }
    return callback(null, '');
  };
  run.isLoaded = () => serviceLoaded;
  run.bootstrapCalls = () => bootstrapCalls;
  run.kickstartCalls = () => kickstartCalls;
  return run;
}

test('relay launch agent is loopback-only and escapes paths', () => {
  const plist = renderLaunchAgent({
    executable: '/home/example/A & B/ec-fallback',
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    directInterface: 'en7',
  });
  assert.match(plist, /\/home\/example\/A &amp; B\/ec-fallback/);
  assert.match(plist, /127\.0\.0\.1:1081/);
  assert.match(plist, /127\.0\.0\.1:1080/);
  assert.match(plist, /127\.0\.0\.1:1082/);
  assert.match(plist, /<string>en7<\/string>/);
  assert.deepEqual(parseLaunchAgentConfiguration(plist), {
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    directInterface: 'en7',
  });
});

test('relay installation detects the physical interface and is removable', async (t) => {
  const paths = fixture(t);
  const calls = [];
  const run = runner(calls);
  const installed = await installFallbackService({
    ...paths,
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    uid: 501,
    platform: 'darwin',
    run,
  });
  assert.equal(installed.installed, true);
  assert.equal(installed.directInterface, 'en7');
  assert.equal(fs.statSync(paths.executable).mode & 0o777, 0o755);
  assert.ok(calls.some((call) => call[0] === '/bin/launchctl' && call[1] === 'bootstrap'));

  const removed = await removeFallbackService({
    ...paths, uid: 501, platform: 'darwin', run,
  });
  assert.equal(removed.installed, false);
  assert.equal(run.isLoaded(), false);
});

test('relay state reports when installed ports no longer match settings', (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'relay', { mode: 0o755 });
  fs.writeFileSync(paths.launchAgent, renderLaunchAgent({
    executable: paths.executable,
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    directInterface: 'en7',
  }));
  assert.equal(fallbackServiceState({
    ...paths, upstreamPort: 2080, primaryProxyPort: 1082, platform: 'darwin',
  }).needsUpdate, true);
});

test('failed relay update restores and restarts the previous service', async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'previous relay', { mode: 0o755 });
  fs.writeFileSync(paths.launchAgent, 'previous plist', { mode: 0o600 });
  const calls = [];
  const run = runner(calls, { loaded: true, failBootstrapAt: 1 });

  await assert.rejects(
    installFallbackService({
      ...paths,
      upstreamPort: 1080,
      primaryProxyPort: 1082,
      uid: 501,
      platform: 'darwin',
      run,
    }),
    /Could not start/,
  );
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), 'previous plist');
  assert.equal(run.bootstrapCalls(), 2);
  assert.equal(run.isLoaded(), true);
  const lifecycle = calls
    .filter((call) => call[0] === '/bin/launchctl' && call[1] !== 'print')
    .map((call) => call[1]);
  assert.deepEqual(lifecycle, ['bootout', 'bootstrap', 'bootstrap']);
});

test('failed relay update preserves a previously unloaded service', async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'previous relay', { mode: 0o755 });
  fs.writeFileSync(paths.launchAgent, 'previous plist', { mode: 0o600 });
  const calls = [];
  const run = runner(calls, { loaded: false, failBootstrapAt: 1 });

  await assert.rejects(
    installFallbackService({
      ...paths,
      upstreamPort: 1080,
      primaryProxyPort: 1082,
      uid: 501,
      platform: 'darwin',
      run,
    }),
    /Could not start/,
  );
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), 'previous plist');
  assert.equal(run.bootstrapCalls(), 1);
  assert.equal(run.isLoaded(), false);
  assert.equal(calls.some((call) => call[0] === '/bin/launchctl' && call[1] === 'bootout'), false);
});

test('a loaded service that never owns the listener is rolled back', async (t) => {
  const paths = fixture(t);
  const calls = [];
  await assert.rejects(
    installFallbackService({
      ...paths,
      upstreamPort: 1080,
      primaryProxyPort: 1082,
      uid: 501,
      platform: 'darwin',
      run: runner(calls),
      verify: async () => false,
    }),
    /did not claim/,
  );
  assert.equal(fs.existsSync(paths.executable), false);
  assert.equal(fs.existsSync(paths.launchAgent), false);
  const lifecycle = calls
    .filter((call) => call[0] === '/bin/launchctl' && call[1] !== 'print')
    .map((call) => call[1]);
  assert.deepEqual(lifecycle, ['bootstrap', 'bootout']);
});

test('relay refuses loops, virtual default interfaces, and symlinked state', (t) => {
  assert.throws(() => validatePorts(1081, 1082), /different/);
  assert.equal(parseDefaultInterface('interface: utun4\n'), null);
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.symlinkSync(paths.source, paths.executable);
  assert.equal(fallbackServiceState({ ...paths, platform: 'darwin' }).installed, false);
});

test('relay prefers a new physical default over an active saved interface', async (t) => {
  const paths = fixture(t);
  const calls = [];
  const run = runner(calls, {
    defaultInterface: 'en8',
    activeInterfaces: ['en7', 'en8'],
  });
  const installed = await installFallbackService({
    ...paths,
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    directInterface: 'en7',
    uid: 501,
    platform: 'darwin',
    run,
  });
  assert.equal(installed.directInterface, 'en8');
  assert.equal(await physicalInterfaceIsActive('en7', run), true);
  assert.ok(calls.some((call) => call[0] === '/sbin/route'));
});

test('relay reuses an active saved interface when a TUN hides the default', async (t) => {
  const paths = fixture(t);
  const calls = [];
  const run = runner(calls, {
    defaultInterface: 'utun4',
    activeInterfaces: ['en7'],
  });
  const installed = await installFallbackService({
    ...paths,
    upstreamPort: 1080,
    primaryProxyPort: 1082,
    directInterface: 'en7',
    uid: 501,
    platform: 'darwin',
    run,
  });
  assert.equal(installed.directInterface, 'en7');
});

test('relay removal preserves files when a loaded service cannot be stopped', async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'installed relay', { mode: 0o755 });
  fs.writeFileSync(paths.launchAgent, 'installed plist', { mode: 0o600 });
  const calls = [];
  const run = runner(calls, {
    loaded: true,
    bootoutError: new Error('bootout denied'),
  });

  await assert.rejects(
    removeFallbackService({
      ...paths, uid: 501, platform: 'darwin', run,
    }),
    /bootout denied/,
  );
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'installed relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), 'installed plist');
  assert.equal(run.isLoaded(), true);
});

test('relay removal skips bootout only when launchd reports the service absent', async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.executable), { recursive: true });
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.writeFileSync(paths.executable, 'installed relay', { mode: 0o755 });
  fs.writeFileSync(paths.launchAgent, 'installed plist', { mode: 0o600 });
  const calls = [];

  const removed = await removeFallbackService({
    ...paths, uid: 501, platform: 'darwin', run: runner(calls),
  });

  assert.equal(removed.installed, false);
  assert.equal(fs.existsSync(paths.executable), false);
  assert.equal(fs.existsSync(paths.launchAgent), false);
  assert.equal(calls.some((call) => call[0] === '/bin/launchctl' && call[1] === 'bootout'), false);
});

test('relay removal validates managed files before stopping the service', async (t) => {
  const paths = fixture(t);
  fs.mkdirSync(path.dirname(paths.launchAgent), { recursive: true });
  fs.symlinkSync(paths.source, paths.launchAgent);
  const calls = [];
  await assert.rejects(
    removeFallbackService({
      ...paths, uid: 501, platform: 'darwin', run: runner(calls),
    }),
    /regular file/,
  );
  assert.equal(calls.some((call) => call[0] === '/bin/launchctl'), false);
});

test('relay binary refresh does not install or load an uninstalled service', async (t) => {
  const paths = fixture(t);
  const calls = [];
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run: runner(calls),
  }), { updated: false });
  assert.equal(fs.existsSync(paths.executable), false);
  assert.equal(fs.existsSync(paths.launchAgent), false);
  assert.deepEqual(calls, []);
});

test('relay binary refresh restarts a loaded helper and preserves the complete plist', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  const run = runner(calls, { loaded: true });
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), { updated: true });
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'relay');
  assert.equal(fs.statSync(paths.executable).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.equal(fs.statSync(paths.launchAgent).mode & 0o777, 0o640);
  assert.equal(run.isLoaded(), true);
  assert.deepEqual(calls.filter((call) => call[1] !== 'print'), [
    ['/bin/launchctl', 'kickstart', '-k', `gui/${process.getuid()}/${FALLBACK_LABEL}`],
  ]);
});

test('relay binary refresh keeps a previously unloaded helper unloaded', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  const run = runner(calls);
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), { updated: true });
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.equal(fs.statSync(paths.launchAgent).mode & 0o777, 0o640);
  assert.equal(run.isLoaded(), false);
  assert.deepEqual(calls.map((call) => call[1]), ['print']);
});

test('relay binary refresh leaves matching bytes and unsupported platforms alone', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  fs.copyFileSync(paths.source, paths.executable);
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run: runner(calls, { loaded: true }),
  }), { updated: false });
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'linux', run: runner(calls),
  }), { updated: false });
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.deepEqual(calls, []);
});

test('failed relay binary refresh restores the previous bytes, modes and loaded service', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  const run = runner(calls, { loaded: true, failKickstartAt: 1 });
  await assert.rejects(refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), /Could not refresh.*kickstart rejected/);
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.equal(fs.statSync(paths.executable).mode & 0o777, 0o750);
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.equal(fs.statSync(paths.launchAgent).mode & 0o777, 0o640);
  assert.equal(run.isLoaded(), true);
  assert.deepEqual(calls.filter((call) => call[1] !== 'print').map((call) => call[1]), [
    'kickstart', 'kickstart',
  ]);
});

test('relay binary refresh restores the old helper if kickstart unexpectedly loses the job', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  const run = runner(calls, { loaded: true, unloadOnKickstartAt: 1 });
  await assert.rejects(refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), /did not report.*loaded/);
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.equal(run.isLoaded(), true);
  assert.deepEqual(calls.filter((call) => call[1] !== 'print').map((call) => call[1]), [
    'kickstart', 'bootstrap',
  ]);
});

test('a caller interrupted while awaiting kickstart cannot strand the relay unloaded', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  const delegate = runner(calls, { loaded: true });
  let finishKickstart;
  let reachedKickstart;
  const kickstartPending = new Promise((resolve) => { reachedKickstart = resolve; });
  const run = (command, args, options, callback) => {
    if (args[0] === 'kickstart') {
      calls.push([command, ...args]);
      finishKickstart = callback;
      reachedKickstart();
      return;
    }
    delegate(command, args, options, callback);
  };
  const updating = refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  });
  await kickstartPending;
  // The GUI may disappear here, so launchd must already retain the loaded job.
  assert.equal(delegate.isLoaded(), true);
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'relay');
  assert.equal(fs.readFileSync(paths.launchAgent, 'utf8'), plist);
  assert.equal(calls.some((call) => ['bootout', 'bootstrap'].includes(call[1])), false);
  finishKickstart(null, '');
  assert.deepEqual(await updating, { updated: true });
});

test('relay binary refresh requires an exact managed label and program path', async (t) => {
  const { paths, plist } = managedFixture(t);
  const calls = [];
  // The expected path exists in a comment but is not the executable launchd runs.
  fs.writeFileSync(paths.launchAgent, plist.replace(
    `<string>${paths.executable}</string>`, '<string>/tmp/another-helper</string>',
  ).replace('  <dict>', `  <!-- ${paths.executable} -->\n  <dict>`));
  assert.equal(fallbackServiceState({ ...paths, platform: 'darwin' }).installed, true);
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run: runner(calls),
  }), { updated: false });
  fs.writeFileSync(paths.launchAgent, plist.replace(FALLBACK_LABEL, 'com.example.other'));
  assert.deepEqual(await refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run: runner(calls),
  }), { updated: false });
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.deepEqual(calls, []);
});

test('relay binary refresh rejects symlinked sources and files writable by other users', async (t) => {
  const { paths } = managedFixture(t);
  const calls = [];
  const run = runner(calls);
  const packagedLink = `${paths.source}-link`;
  fs.symlinkSync(paths.source, packagedLink);
  await assert.rejects(refreshFallbackServiceBinary({
    ...paths, source: packagedLink, uid: process.getuid(), platform: 'darwin', run,
  }), /regular file/);
  fs.chmodSync(paths.executable, 0o777);
  await assert.rejects(refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), /writable by other users/);
  fs.chmodSync(paths.executable, 0o755);
  fs.chmodSync(paths.launchAgent, 0o666);
  await assert.rejects(refreshFallbackServiceBinary({
    ...paths, uid: process.getuid(), platform: 'darwin', run,
  }), /writable by other users/);
  assert.equal(fs.readFileSync(paths.executable, 'utf8'), 'previous relay');
  assert.deepEqual(calls, []);
});
