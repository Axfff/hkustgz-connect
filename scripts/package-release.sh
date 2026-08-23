#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$ROOT/dist"

[ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] \
  || { printf 'macOS arm64 release packaging must run on an Apple Silicon Mac\n' >&2; exit 1; }

cli_stage="$ROOT/dist/hkustgz-connect-cli-$VERSION-macos-arm64"
cli_archive="$cli_stage.tar.gz"
"$ROOT/scripts/build-cli.sh" >/dev/null
[ -d "$cli_stage" ] && [ -f "$cli_archive" ] \
  || { printf 'CLI release build did not produce the expected stage and archive\n' >&2; exit 1; }
tar -tzf "$cli_archive" >/dev/null
app_resources="$ROOT/desktop/release/mac-arm64/HKUST(GZ) Connect.app/Contents/Resources"

node "$ROOT/desktop/build/verify-package.js" "$app_resources" darwin arm64

for legal_file in \
  LICENSE NOTICE.md PROVENANCE.md THIRD_PARTY_NOTICES.md \
  LICENSES/GPL-3.0-only.txt LICENSES/AGPL-3.0-only.txt \
  LICENSES/BSD-3-Clause-GeiserX-tailscale-rs.txt
do
  [ -f "$cli_stage/$legal_file" ] \
    || { printf 'missing CLI legal material: %s\n' "$legal_file" >&2; exit 1; }
done

for runtime_file in \
  cli/hkustgzconnect \
  cli/campus-only.pac.template \
  cli/shadowrocket-hkustgz.module.template \
  cli/shadowrocket-hkustgz-repair.module.template \
  cli/mihomo-hkustgz.yaml.template \
  SECURITY.md \
  CONTRIBUTING.md \
  docs/NETWORK_COEXISTENCE.md \
  docs/TRAFFIC_AND_PROXYING.md \
  engine/bin/ec-engine-darwin-arm64 \
  engine/bin/ec-fallback-darwin-arm64 \
  engine/bin/ec-ssh-route-darwin-arm64
do
  [ -f "$cli_stage/$runtime_file" ] \
    || { printf 'missing CLI runtime material: %s\n' "$runtime_file" >&2; exit 1; }
done

"$ROOT/scripts/check-release.sh" \
  "$app_resources/app.asar" \
  "$app_resources/engine" \
  "$app_resources/legal" \
  "$cli_stage"

for artifact in \
  "$ROOT/desktop/release/hkustgzconnect-$VERSION-mac-arm64.dmg" \
  "$ROOT/desktop/release/hkustgzconnect-$VERSION-mac-arm64.zip"
do
  [ -f "$artifact" ] || { printf 'missing desktop artifact: %s\n' "$artifact" >&2; exit 1; }
  cp "$artifact" "$ROOT/dist/"
done

cd "$ROOT/dist"
shasum -a 256 \
  "hkustgzconnect-$VERSION-mac-arm64.dmg" \
  "hkustgzconnect-$VERSION-mac-arm64.zip" \
  "hkustgz-connect-cli-$VERSION-macos-arm64.tar.gz" \
  > SHA256SUMS.txt
cat SHA256SUMS.txt
