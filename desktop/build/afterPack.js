'use strict';
// Ad-hoc re-sign the whole .app AFTER electron-builder copies extraResources
// (the bundled native Rust engine). Without this the bundle seal is invalid once
// the engine is added, and Gatekeeper shows the harsh "is damaged" block with no
// override. A VALID ad-hoc signature downgrades that to "cannot be verified",
// which the user can bypass with right-click -> Open (no Terminal needed).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function stageLegalMaterials(resourcesDir) {
  const root = path.resolve(__dirname, '..', '..');
  const legalDir = path.join(resourcesDir, 'legal');
  const electronDir = path.join(legalDir, 'electron');
  fs.rmSync(legalDir, { recursive: true, force: true });
  fs.mkdirSync(electronDir, { recursive: true });

  for (const file of ['LICENSE', 'NOTICE.md', 'PROVENANCE.md', 'THIRD_PARTY_NOTICES.md']) {
    fs.copyFileSync(path.join(root, file), path.join(legalDir, file));
  }
  fs.cpSync(path.join(root, 'LICENSES'), path.join(legalDir, 'LICENSES'), {
    recursive: true,
  });

  const electronDist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
  fs.copyFileSync(path.join(electronDist, 'LICENSE'), path.join(electronDir, 'LICENSE'));
  fs.copyFileSync(
    path.join(electronDist, 'LICENSES.chromium.html'),
    path.join(electronDir, 'LICENSES.chromium.html'),
  );
}

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename;
  const isMac = context.electronPlatformName === 'darwin';
  const appPath = isMac ? path.join(context.appOutDir, `${appName}.app`) : null;
  const resourcesDir = isMac
    ? path.join(appPath, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  stageLegalMaterials(resourcesDir);

  if (!isMac) {
    console.log('[afterPack] staged legal materials:', resourcesDir);
    return;
  }

  // If a real Developer ID cert is provided, let electron-builder sign+notarize
  // instead — don't clobber it with an ad-hoc signature.
  if (process.env.CSC_LINK || process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true') {
    console.log('[afterPack] staged legal materials; real cert present; skipping ad-hoc signing');
    return;
  }
  const engineDir = path.join(appPath, 'Contents', 'Resources', 'engine');
  const run = (...args) => execFileSync('codesign', args, { stdio: 'inherit' });

  // sign nested engine binaries first, then seal the whole bundle
  if (fs.existsSync(engineDir)) {
    for (const f of fs.readdirSync(engineDir)) {
      const p = path.join(engineDir, f);
      const mode = fs.statSync(p).mode;
      if ((mode & 0o111) !== 0) run('--force', '--timestamp=none', '-s', '-', p);
    }
  }
  run('--force', '--deep', '--timestamp=none', '-s', '-', appPath);
  run('--verify', '--deep', '--strict', appPath);
  console.log('[afterPack] staged legal materials; ad-hoc signed + verified:', appPath);
};
