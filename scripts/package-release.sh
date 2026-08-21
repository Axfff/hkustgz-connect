#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
mkdir -p "$ROOT/dist"

cli_archive="$ROOT/dist/hkustgz-connect-cli-$VERSION-macos-arm64.tar.gz"
[ -f "$cli_archive" ] || "$ROOT/scripts/build-cli.sh" >/dev/null
cli_stage="$ROOT/dist/hkustgz-connect-cli-$VERSION-macos-arm64"

"$ROOT/scripts/check-release.sh" \
  "$ROOT/desktop/release/mac-arm64/HKUST(GZ) Connect.app/Contents/Resources/app.asar" \
  "$ROOT/desktop/release/mac-arm64/HKUST(GZ) Connect.app/Contents/Resources/engine" \
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
