'use strict';
// Ad-hoc re-sign the whole .app AFTER electron-builder copies extraResources
// (the bundled native Rust engine). Without this the bundle seal is invalid once
// the engine is added, and Gatekeeper shows the harsh "is damaged" block with no
// override. A VALID ad-hoc signature downgrades that to "cannot be verified",
// which the user can bypass with right-click -> Open (no Terminal needed).
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // If a real Developer ID cert is provided, let electron-builder sign+notarize
  // instead — don't clobber it with an ad-hoc signature.
  if (process.env.CSC_LINK || process.env.CSC_IDENTITY_AUTO_DISCOVERY === 'true') {
    console.log('[afterPack] real cert present; skipping ad-hoc signing');
    return;
  }
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
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
  console.log('[afterPack] ad-hoc signed + verified:', appPath);
};
