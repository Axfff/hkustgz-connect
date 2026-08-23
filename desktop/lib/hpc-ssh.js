'use strict';

const fs = require('fs');
const path = require('path');

const MANAGED_BEGIN = '# BEGIN HKUST(GZ) Connect managed SSH route';
const MANAGED_END = '# END HKUST(GZ) Connect managed SSH route';
const HPC_ALIAS = 'hkustgz-hpc';
const HPC_HOST = 'hpc2login.hpc.hkust-gz.edu.cn';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function managedPattern() {
  return new RegExp(`${escapeRegExp(MANAGED_BEGIN)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}\\n*`, 'g');
}

function assertPlainFile(file, label) {
  if (!fs.existsSync(file)) return;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file`);
  }
}

function quoteSshArgument(value) {
  const text = String(value);
  if (!text || /[\r\n\0]/.test(text)) throw new Error('SSH helper path is invalid');
  return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function renderManagedBlock({ helperPath, proxyPort }) {
  const port = Number(proxyPort);
  if (!Number.isInteger(port) || port < 1025 || port > 65535) {
    throw new Error('SOCKS port must be within 1025..65535');
  }
  return [
    MANAGED_BEGIN,
    `Host ${HPC_ALIAS} ${HPC_HOST}`,
    `  HostName ${HPC_HOST}`,
    `  ProxyCommand ${quoteSshArgument(helperPath)} --proxy 127.0.0.1:${port} %h %p`,
    '  ConnectTimeout 20',
    MANAGED_END,
    '',
  ].join('\n');
}

function managedBlockCount(content) {
  return Array.from(content.matchAll(managedPattern())).length;
}

function writeAtomic(file, content, mode) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode });
    fs.renameSync(temporary, file);
    fs.chmodSync(file, mode);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function copyExecutableAtomic(source, target) {
  assertPlainFile(source, 'Packaged SSH helper');
  if (!fs.existsSync(source)) throw new Error(`Packaged SSH helper is missing: ${source}`);
  assertPlainFile(target, 'Installed SSH helper');
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary, 0o755);
    fs.renameSync(temporary, target);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function managedSshState({ configFile, helperTarget, platform = process.platform }) {
  if (platform !== 'darwin') {
    return { supported: false, installed: false, alias: HPC_ALIAS, host: HPC_HOST };
  }
  let installed = false;
  try {
    assertPlainFile(configFile, 'SSH config');
    assertPlainFile(helperTarget, 'Installed SSH helper');
    const content = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
    installed = managedBlockCount(content) === 1 && fs.existsSync(helperTarget);
  } catch {}
  return { supported: true, installed, alias: HPC_ALIAS, host: HPC_HOST };
}

function installManagedSsh({ configFile, helperSource, helperTarget, proxyPort }) {
  const sshDirectory = path.dirname(configFile);
  const helperDirectory = path.dirname(helperTarget);
  fs.mkdirSync(sshDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(helperDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(sshDirectory, 0o700);
  fs.chmodSync(helperDirectory, 0o700);
  assertPlainFile(configFile, 'SSH config');

  const previous = fs.existsSync(configFile) ? fs.readFileSync(configFile, 'utf8') : '';
  const count = managedBlockCount(previous);
  if (count > 1 || previous.includes(MANAGED_BEGIN) !== previous.includes(MANAGED_END)) {
    throw new Error('SSH config contains an inconsistent managed block');
  }
  if (previous && !fs.existsSync(`${configFile}.hkustgz-connect.backup`)) {
    fs.copyFileSync(configFile, `${configFile}.hkustgz-connect.backup`, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(`${configFile}.hkustgz-connect.backup`, 0o600);
  }

  copyExecutableAtomic(helperSource, helperTarget);
  const block = renderManagedBlock({ helperPath: helperTarget, proxyPort });
  const next = count === 1
    ? previous.replace(managedPattern(), block)
    : `${block}${previous}`;
  writeAtomic(configFile, next, 0o600);
  return managedSshState({ configFile, helperTarget, platform: 'darwin' });
}

function removeManagedSsh({ configFile, helperTarget }) {
  assertPlainFile(configFile, 'SSH config');
  if (fs.existsSync(configFile)) {
    const previous = fs.readFileSync(configFile, 'utf8');
    const count = managedBlockCount(previous);
    if (count > 1 || previous.includes(MANAGED_BEGIN) !== previous.includes(MANAGED_END)) {
      throw new Error('SSH config contains an inconsistent managed block');
    }
    if (count === 1) writeAtomic(configFile, previous.replace(managedPattern(), ''), 0o600);
  }
  assertPlainFile(helperTarget, 'Installed SSH helper');
  if (fs.existsSync(helperTarget)) fs.unlinkSync(helperTarget);
  return managedSshState({ configFile, helperTarget, platform: 'darwin' });
}

module.exports = {
  HPC_ALIAS,
  HPC_HOST,
  MANAGED_BEGIN,
  MANAGED_END,
  installManagedSsh,
  managedSshState,
  removeManagedSsh,
  renderManagedBlock,
};
