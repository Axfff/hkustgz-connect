'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FALLBACK_LABEL = 'com.hkustgz.connect-fallback';
const FALLBACK_PORT = 1081;

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1025 || port > 65535) {
    throw new Error('Relay ports must be within 1025..65535');
  }
  return port;
}

function validatePorts(upstreamPort, primaryProxyPort) {
  const upstream = validPort(upstreamPort);
  const primary = validPort(primaryProxyPort);
  if (new Set([FALLBACK_PORT, upstream, primary]).size !== 3) {
    throw new Error('Campus, relay, and primary proxy ports must be different');
  }
  return { upstream, primary };
}

function assertRegularFile(file, label, { required = false } = {}) {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`${label} is missing: ${file}`);
    return;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
}

function xml(value) {
  const text = String(value || '');
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) throw new Error('LaunchAgent value is invalid');
  return text.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]);
}

function renderLaunchAgent({ executable, upstreamPort, primaryProxyPort, directInterface }) {
  if (!path.isAbsolute(executable)) throw new Error('Relay executable path must be absolute');
  if (!/^en\d+$/.test(String(directInterface || ''))) {
    throw new Error('A physical macOS network interface is required');
  }
  const { upstream, primary } = validatePorts(upstreamPort, primaryProxyPort);
  const args = [
    executable,
    '--listen', `127.0.0.1:${FALLBACK_PORT}`,
    '--upstream', `127.0.0.1:${upstream}`,
    '--general-upstream', `127.0.0.1:${primary}`,
    '--direct-interface', directInterface,
  ];
  const argumentsXml = args.map((argument) => `      <string>${xml(argument)}</string>`).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '  <dict>',
    `    <key>Label</key><string>${FALLBACK_LABEL}</string>`,
    '    <key>ProgramArguments</key>',
    '    <array>',
    argumentsXml,
    '    </array>',
    '    <key>RunAtLoad</key><true/>',
    '    <key>KeepAlive</key><true/>',
    '    <key>ThrottleInterval</key><integer>10</integer>',
    '  </dict>',
    '</plist>',
    '',
  ].join('\n');
}

function runCommand(run, command, args) {
  return new Promise((resolve, reject) => {
    run(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 },
      (error, stdout = '') => {
        if (error) reject(error);
        else resolve(String(stdout || ''));
      });
  });
}

function launchAgentIsLoaded(run, service) {
  return new Promise((resolve, reject) => {
    run('/bin/launchctl', ['print', service], {
      encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024,
    }, (error, _stdout = '', stderr = '') => {
      if (!error) return resolve(true);
      const detail = `${String(stderr || '')}\n${error.message || ''}`;
      if (Number(error.code) === 113 || /Could not find service\b/i.test(detail)) {
        return resolve(false);
      }
      reject(error);
    });
  });
}

async function stopLaunchAgent(run, service) {
  await runCommand(run, '/bin/launchctl', ['bootout', service]);
  if (await launchAgentIsLoaded(run, service)) {
    throw new Error('launchctl reported the compatibility relay still loaded after bootout');
  }
}

function parseDefaultInterface(output) {
  const value = String(output || '').match(/^\s*interface:\s*(\S+)\s*$/m)?.[1] || null;
  return value && /^en\d+$/.test(value) ? value : null;
}

async function detectPhysicalInterface(run = execFile) {
  const output = await runCommand(run, '/sbin/route', ['-n', 'get', 'default']);
  const networkInterface = parseDefaultInterface(output);
  if (!networkInterface) {
    throw new Error('Could not identify the active physical interface; disable the primary TUN briefly and retry');
  }
  return networkInterface;
}

async function preferredPhysicalInterface(savedInterface, run = execFile) {
  const output = await runCommand(run, '/sbin/route', ['-n', 'get', 'default']);
  const currentInterface = String(output || '')
    .match(/^\s*interface:\s*(\S+)\s*$/m)?.[1] || null;
  const physicalDefault = parseDefaultInterface(output);
  if (physicalDefault) return physicalDefault;
  if (/^utun\d+$/.test(String(currentInterface || ''))
    && await physicalInterfaceIsActive(savedInterface, run)) {
    return savedInterface;
  }
  throw new Error('Could not identify the active physical interface; disable the primary TUN briefly and retry');
}

async function physicalInterfaceIsActive(networkInterface, run = execFile) {
  if (!/^en\d+$/.test(String(networkInterface || ''))) return false;
  try {
    const output = await runCommand(run, '/sbin/ifconfig', [networkInterface]);
    return /^\s*status:\s*active\s*$/m.test(output);
  } catch {
    return false;
  }
}

function copyExecutableAtomic(source, target) {
  assertRegularFile(source, 'Packaged relay', { required: true });
  assertRegularFile(target, 'Installed relay');
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(target), 0o700);
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, target);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function writeAtomic(file, content, mode = 0o600) {
  assertRegularFile(file, 'Relay LaunchAgent');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { flag: 'wx', mode });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, mode);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function snapshotFile(file, label) {
  assertRegularFile(file, label);
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  return { content: fs.readFileSync(file), mode: stat.mode & 0o777 };
}

function restoreSnapshot(file, snapshot, label) {
  assertRegularFile(file, label);
  if (snapshot) writeAtomic(file, snapshot.content, snapshot.mode);
  else if (fs.existsSync(file)) fs.unlinkSync(file);
}

function parseLaunchAgentConfiguration(plist) {
  const source = String(plist || '');
  const portAfter = (argument) => {
    const escaped = argument.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(
      `<string>${escaped}</string>\\s*<string>127\\.0\\.0\\.1:(\\d+)</string>`,
    ));
    const port = Number(match?.[1]);
    return Number.isInteger(port) ? port : null;
  };
  const directInterface = source.match(
    /<string>--direct-interface<\/string>\s*<string>(en\d+)<\/string>/,
  )?.[1] || null;
  return {
    upstreamPort: portAfter('--upstream'),
    primaryProxyPort: portAfter('--general-upstream'),
    directInterface,
  };
}

function fallbackServiceState({
  executable,
  launchAgent,
  upstreamPort,
  primaryProxyPort,
  platform = process.platform,
}) {
  if (platform !== 'darwin') return { supported: false, installed: false, port: FALLBACK_PORT };
  let installed = false;
  let configuration = {
    upstreamPort: null, primaryProxyPort: null, directInterface: null,
  };
  try {
    assertRegularFile(executable, 'Installed relay');
    assertRegularFile(launchAgent, 'Relay LaunchAgent');
    const plist = fs.existsSync(launchAgent) ? fs.readFileSync(launchAgent, 'utf8') : '';
    configuration = parseLaunchAgentConfiguration(plist);
    installed = fs.existsSync(executable)
      && plist.includes(`<key>Label</key><string>${FALLBACK_LABEL}</string>`)
      && plist.includes(xml(executable));
  } catch {}
  const expectedUpstream = Number(upstreamPort);
  const expectedPrimary = Number(primaryProxyPort);
  const needsUpdate = installed && (
    (Number.isInteger(expectedUpstream) && configuration.upstreamPort !== expectedUpstream)
    || (Number.isInteger(expectedPrimary) && configuration.primaryProxyPort !== expectedPrimary)
  );
  return {
    supported: true, installed, needsUpdate, port: FALLBACK_PORT, ...configuration,
  };
}

function assertRefreshFilePermissions(file, label, uid, { packaged = false } = {}) {
  assertRegularFile(file, label, { required: true });
  const stat = fs.statSync(file);
  if (stat.uid !== uid && (!packaged || stat.uid !== 0)) {
    throw new Error(`${label} must be owned by the current user${packaged ? ' or root' : ''}`);
  }
  if (stat.mode & 0o022) throw new Error(`${label} must not be writable by other users`);
}

function matchesManagedLaunchAgent(plist, executable) {
  const source = String(plist).replace(/<!--[\s\S]*?-->/g, '');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labels = source.match(/<key>\s*Label\s*<\/key>/g) || [];
  const argumentsKeys = source.match(/<key>\s*ProgramArguments\s*<\/key>/g) || [];
  return labels.length === 1 && argumentsKeys.length === 1
    && !/<key>\s*Program\s*<\/key>/.test(source)
    && new RegExp(`<key>\\s*Label\\s*</key>\\s*<string>${escape(FALLBACK_LABEL)}</string>`).test(source)
    && new RegExp(`<key>\\s*ProgramArguments\\s*</key>\\s*<array>\\s*<string>${escape(xml(executable))}</string>`).test(source);
}

async function refreshFallbackServiceBinary({
  source,
  executable,
  launchAgent,
  uid = process.getuid?.(),
  platform = process.platform,
  run = execFile,
}) {
  if (platform !== 'darwin' || !Number.isInteger(uid)
    || !fallbackServiceState({ executable, launchAgent, platform }).installed) {
    return { updated: false };
  }
  assertRefreshFilePermissions(executable, 'Installed relay', uid);
  assertRefreshFilePermissions(launchAgent, 'Relay LaunchAgent', uid);
  const previousLaunchAgent = snapshotFile(launchAgent, 'Relay LaunchAgent');
  if (!matchesManagedLaunchAgent(previousLaunchAgent.content, executable)) {
    return { updated: false };
  }
  assertRefreshFilePermissions(source, 'Packaged relay', uid, { packaged: true });
  const previousExecutable = snapshotFile(executable, 'Installed relay');
  if (previousExecutable.content.equals(fs.readFileSync(source))) return { updated: false };

  const service = `gui/${uid}/${FALLBACK_LABEL}`;
  let previousServiceLoaded;
  try {
    previousServiceLoaded = await launchAgentIsLoaded(run, service);
  } catch (error) {
    throw new Error(`Could not inspect the compatibility relay LaunchAgent: ${error.message}`);
  }
  let replaced = false;
  try {
    copyExecutableAtomic(source, executable);
    replaced = true;
    if (previousServiceLoaded) {
      // Keep the independent launchd job loaded even if the GUI is force-quit
      // during this upgrade; its next start uses the atomically replaced binary.
      await runCommand(run, '/bin/launchctl', ['kickstart', '-k', service]);
      if (!await launchAgentIsLoaded(run, service)) {
        throw new Error('launchctl did not report the compatibility relay as loaded');
      }
    }
  } catch (error) {
    let rollbackError = null;
    try {
      if (replaced) restoreSnapshot(executable, previousExecutable, 'Installed relay');
      if (previousServiceLoaded) {
        const loaded = await launchAgentIsLoaded(run, service);
        if (!loaded) {
          await runCommand(run, '/bin/launchctl', ['bootstrap', `gui/${uid}`, launchAgent]);
        } else if (replaced) {
          await runCommand(run, '/bin/launchctl', ['kickstart', '-k', service]);
        }
        if (!await launchAgentIsLoaded(run, service)) {
          throw new Error('launchctl did not restore the previous compatibility relay');
        }
      }
    } catch (rollback) {
      rollbackError = rollback;
    }
    const suffix = rollbackError ? `; previous relay restore also failed: ${rollbackError.message}` : '';
    throw new Error(`Could not refresh the compatibility relay: ${error.message}${suffix}`);
  }
  return { updated: true };
}

async function installFallbackService({
  source,
  executable,
  launchAgent,
  upstreamPort,
  primaryProxyPort,
  uid = process.getuid?.(),
  directInterface,
  platform = process.platform,
  run = execFile,
  verify,
}) {
  if (platform !== 'darwin' || !Number.isInteger(uid)) {
    throw new Error('The compatibility relay is currently available on macOS');
  }
  validatePorts(upstreamPort, primaryProxyPort);
  const networkInterface = await preferredPhysicalInterface(directInterface, run);
  const plist = renderLaunchAgent({
    executable,
    upstreamPort,
    primaryProxyPort,
    directInterface: networkInterface,
  });
  const service = `gui/${uid}/${FALLBACK_LABEL}`;
  const previousExecutable = snapshotFile(executable, 'Installed relay');
  const previousLaunchAgent = snapshotFile(launchAgent, 'Relay LaunchAgent');
  let previousServiceLoaded;
  try {
    previousServiceLoaded = await launchAgentIsLoaded(run, service);
  } catch (error) {
    throw new Error(`Could not inspect the compatibility relay LaunchAgent: ${error.message}`);
  }
  if (previousServiceLoaded && (!previousExecutable || !previousLaunchAgent)) {
    throw new Error('The loaded compatibility relay is missing its managed files');
  }
  try {
    if (previousServiceLoaded) await stopLaunchAgent(run, service);
    copyExecutableAtomic(source, executable);
    writeAtomic(launchAgent, plist);
    await runCommand(run, '/bin/launchctl', ['bootstrap', `gui/${uid}`, launchAgent]);
    if (!await launchAgentIsLoaded(run, service)) {
      throw new Error('launchctl did not report the compatibility relay as loaded');
    }
    if (verify && !await verify()) {
      throw new Error('the relay did not claim its loopback listener');
    }
  } catch (error) {
    let rollbackError = null;
    try {
      if (await launchAgentIsLoaded(run, service)) await stopLaunchAgent(run, service);
      restoreSnapshot(executable, previousExecutable, 'Installed relay');
      restoreSnapshot(launchAgent, previousLaunchAgent, 'Relay LaunchAgent');
      if (previousServiceLoaded) {
        await runCommand(run, '/bin/launchctl', ['bootstrap', `gui/${uid}`, launchAgent]);
        if (!await launchAgentIsLoaded(run, service)) {
          throw new Error('launchctl did not restore the previous compatibility relay');
        }
      } else if (await launchAgentIsLoaded(run, service)) {
        throw new Error('the compatibility relay remained loaded after rollback');
      }
    } catch (rollback) {
      rollbackError = rollback;
    }
    const suffix = rollbackError ? `; previous relay restore also failed: ${rollbackError.message}` : '';
    throw new Error(`Could not start the compatibility relay: ${error.message}${suffix}`);
  }
  return {
    ...fallbackServiceState({
      executable, launchAgent, upstreamPort, primaryProxyPort, platform,
    }),
    directInterface: networkInterface,
  };
}

async function removeFallbackService({
  executable,
  launchAgent,
  uid = process.getuid?.(),
  platform = process.platform,
  run = execFile,
}) {
  if (platform !== 'darwin' || !Number.isInteger(uid)) {
    throw new Error('The compatibility relay is currently available on macOS');
  }
  assertRegularFile(launchAgent, 'Relay LaunchAgent');
  assertRegularFile(executable, 'Installed relay');
  const service = `gui/${uid}/${FALLBACK_LABEL}`;
  let loaded;
  try {
    loaded = await launchAgentIsLoaded(run, service);
  } catch (error) {
    throw new Error(`Could not inspect the compatibility relay LaunchAgent: ${error.message}`);
  }
  if (loaded) await stopLaunchAgent(run, service);
  if (fs.existsSync(launchAgent)) fs.unlinkSync(launchAgent);
  if (fs.existsSync(executable)) fs.unlinkSync(executable);
  return fallbackServiceState({ executable, launchAgent, platform });
}

module.exports = {
  FALLBACK_LABEL,
  FALLBACK_PORT,
  detectPhysicalInterface,
  fallbackServiceState,
  installFallbackService,
  parseDefaultInterface,
  parseLaunchAgentConfiguration,
  physicalInterfaceIsActive,
  refreshFallbackServiceBinary,
  removeFallbackService,
  renderLaunchAgent,
  validatePorts,
};
