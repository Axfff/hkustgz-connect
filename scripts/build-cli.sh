#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$HOME=/build/home"
VERSION="$(node -p "require('$ROOT/package.json').version")"
case "$(uname -s)" in Darwin) PLATFORM="macos" ;; *) echo 'macOS release build required' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64) ARCH="arm64" ;; x86_64) ARCH="amd64" ;; *) echo 'unsupported architecture' >&2; exit 1 ;; esac

cd "$ROOT/engine"
LZMA_API_STATIC=1 cargo build --locked --release --bin ec-engine --bin ec-fallback --bin ec-ssh-route

NAME="hkustgz-connect-cli-$VERSION-$PLATFORM-$ARCH"
STAGE="$ROOT/dist/$NAME"
ARCHIVE="$ROOT/dist/$NAME.tar.gz"
rm -rf "$STAGE"
mkdir -p "$STAGE/cli" "$STAGE/config" "$STAGE/engine/bin"
cp "$ROOT/cli/hkustgzconnect" "$ROOT/cli/campus-only.pac.template" \
  "$ROOT/desktop/assets/shadowrocket-hkustgz.module.template" "$STAGE/cli/"
cp "$ROOT/cli/config.toml.example" "$ROOT/cli/com.hkustgz.connect-fallback.plist.example" "$STAGE/cli/"
cp "$ROOT/config/hkustgz.json" "$ROOT/config/policy.json.example" "$STAGE/config/"
cp "$ROOT/engine/target/release/ec-engine" "$STAGE/engine/bin/ec-engine-darwin-$ARCH"
cp "$ROOT/engine/target/release/ec-fallback" "$STAGE/engine/bin/ec-fallback-darwin-$ARCH"
cp "$ROOT/engine/target/release/ec-ssh-route" "$STAGE/engine/bin/ec-ssh-route-darwin-$ARCH"
cp "$ROOT/README.md" "$ROOT/LICENSE" "$ROOT/NOTICE.md" \
  "$ROOT/PROVENANCE.md" "$ROOT/THIRD_PARTY_NOTICES.md" "$STAGE/"
cp -R "$ROOT/LICENSES" "$STAGE/"
chmod 755 "$STAGE/cli/hkustgzconnect" "$STAGE/engine/bin/"*
for binary in "$STAGE/engine/bin/"*; do
  codesign --force --timestamp=none -s - "$binary"
  codesign --verify --strict "$binary"
done
tar -C "$ROOT/dist" -czf "$ARCHIVE" "$NAME"
printf '%s\n' "$ARCHIVE"
