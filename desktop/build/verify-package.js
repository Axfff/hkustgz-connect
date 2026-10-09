'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const [resourcesArgument, platform = process.platform, architecture = process.arch] =
  process.argv.slice(2);

if (!resourcesArgument) {
  throw new Error('usage: node build/verify-package.js <resources-dir> [platform] [arch]');
}

const resources = path.resolve(resourcesArgument);
const archive = path.join(resources, 'app.asar');
if (!fs.existsSync(archive)) throw new Error(`missing packaged application: ${archive}`);

const entries = new Set(
  asar.listPackage(archive).map((entry) => entry.replaceAll('\\', '/')),
);
const requiredEntries = [
  '/main.js',
  '/preload.js',
  '/build/trayTemplate.png',
  '/lib/app-lifecycle.js',
  '/lib/diagnostics.js',
  '/lib/fallback-service.js',
  '/lib/hpc-ssh.js',
  '/lib/shadowrocket-module.js',
  '/lib/mihomo-profile.js',
  '/lib/network-guides.js',
  '/lib/network-policy.js',
  '/lib/presentation-state.js',
  '/lib/settings-update.js',
  '/lib/tunnel-health.js',
  '/renderer/app.js',
  '/renderer/index.html',
  '/renderer/styles.css',
  '/assets/campus-resources.json',
  '/assets/shadowrocket-hkustgz.module.template',
  '/assets/shadowrocket-hkustgz-repair.module.template',
  '/assets/mihomo-hkustgz.yaml.template',
];
for (const entry of requiredEntries) {
  if (!entries.has(entry)) throw new Error(`missing required packaged file: ${entry}`);
}

const removedBrowserEntries = [
  '/campus-preload.js',
  '/lib/campus-browser.js',
  '/lib/campus-credential-vault.js',
  '/renderer/campus-browser.html',
  '/renderer/campus-browser.js',
  '/renderer/campus-browser.css',
];
for (const entry of removedBrowserEntries) {
  if (entries.has(entry)) throw new Error(`obsolete embedded browser file is packaged: ${entry}`);
}

const platformName = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'darwin' : 'linux';
const architectureName = architecture === 'arm64' ? 'arm64' : 'amd64';
const extension = platformName === 'windows' ? '.exe' : '';
const engineName = `ec-engine-${platformName}-${architectureName}${extension}`;
const engine = path.join(resources, 'engine', engineName);
if (!fs.existsSync(engine) || fs.statSync(engine).size === 0) {
  throw new Error(`missing packaged engine: ${engine}`);
}

const helperName = `ec-ssh-route-${platformName}-${architectureName}${extension}`;
const helper = path.join(resources, 'engine', helperName);
if (!fs.existsSync(helper) || fs.statSync(helper).size === 0) {
  throw new Error(`missing packaged HPC SSH helper: ${helper}`);
}

const relayName = `ec-fallback-${platformName}-${architectureName}${extension}`;
const relay = path.join(resources, 'engine', relayName);
if (!fs.existsSync(relay) || fs.statSync(relay).size === 0) {
  throw new Error(`missing packaged compatibility relay: ${relay}`);
}

if (platformName === 'darwin') {
  const expectedCpu = architectureName === 'arm64' ? 0x0100000c : 0x01000007;
  for (const executable of [engine, helper, relay]) {
    const header = fs.readFileSync(executable).subarray(0, 8);
    const magic = header.length >= 8 ? header.readUInt32LE(0) : -1;
    const cpuType = header.length >= 8 ? header.readUInt32LE(4) : -1;
    if (magic !== 0xfeedfacf || cpuType !== expectedCpu) {
      throw new Error(
        `packaged executable is not a ${architectureName} 64-bit Mach-O file: ${executable}`,
      );
    }
  }
} else if (platformName === 'windows') {
  const expectedMachine = architectureName === 'arm64' ? 0xaa64 : 0x8664;
  for (const executable of [engine, helper, relay]) {
    const header = fs.readFileSync(executable);
    const peOffset = header.length >= 0x40 ? header.readUInt32LE(0x3c) : -1;
    const signature = peOffset >= 0 && peOffset + 6 <= header.length
      ? header.subarray(peOffset, peOffset + 4).toString('binary')
      : '';
    const machine = signature === 'PE\u0000\u0000' ? header.readUInt16LE(peOffset + 4) : -1;
    if (machine !== expectedMachine) {
      throw new Error(
        `packaged executable is not a ${architectureName} Windows PE file: ${executable}`,
      );
    }
  }
}

const requiredLegalFiles = [
  'LICENSE',
  'NOTICE.md',
  'PROVENANCE.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/GPL-3.0-only.txt',
  'LICENSES/AGPL-3.0-only.txt',
  'LICENSES/BSD-3-Clause-GeiserX-tailscale-rs.txt',
  'electron/LICENSE',
  'electron/LICENSES.chromium.html',
];
for (const file of requiredLegalFiles) {
  const legalFile = path.join(resources, 'legal', file);
  if (!fs.existsSync(legalFile) || fs.statSync(legalFile).size === 0) {
    throw new Error(`missing packaged legal material: ${legalFile}`);
  }
}

const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
const sourceManifest = require(path.join(__dirname, '..', 'package.json'));
if (packagedManifest.version !== sourceManifest.version) {
  throw new Error(
    `packaged version ${packagedManifest.version} does not match source ${sourceManifest.version}`,
  );
}
if (packagedManifest.license !== sourceManifest.license) {
  throw new Error(
    `packaged license ${packagedManifest.license} does not match source ${sourceManifest.license}`,
  );
}

process.stdout.write(
  `verified ${platformName}/${architectureName}: app, engine, legal materials, v${packagedManifest.version}\n`,
);
