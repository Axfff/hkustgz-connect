#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"

fail() {
  printf 'public-tree check failed: %s\n' "$*" >&2
  exit 1
}

for forbidden in \
  config.toml cred.bin settings.json campus-credentials.json \
  '*.pcap' '*.pcapng' '*.har' '*.key' '*.pem'
do
  match="$(find . -type f -name "$forbidden" \
    -not -path './desktop/node_modules/*' \
    -not -path './desktop/release/*' \
    -not -path './desktop/engine/*' \
    -not -path './engine/target/*' \
    -not -path './dist/*' -print -quit)"
  [ -z "$match" ] || fail "forbidden local/evidence file: $match"
done

if rg -n --hidden \
  -g '!scripts/check-public.sh' \
  -g '!scripts/check-release.sh' \
  -g '!desktop/node_modules/**' \
  -g '!desktop/release/**' \
  -g '!desktop/engine/**' \
  -g '!engine/target/**' \
  -g '!dist/**' \
  '(/Users/|BEGIN [A-Z ]*PRIVATE KEY|(^|[^0-9])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)|(^|[^0-9])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)|(^|[^0-9])192\.168\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$))' .
then
  fail 'machine path, private-key marker, RFC 1918 address, or local identity found'
fi

while IFS= read -r candidate; do
  kind="$(file -b "$candidate")"
  case "$kind" in
    *Mach-O*|*ELF*executable*|*PE32*executable*)
      fail "compiled executable is present: $candidate"
      ;;
  esac
done < <(find . -type f \
  -not -path './desktop/node_modules/*' \
  -not -path './desktop/release/*' \
  -not -path './desktop/engine/*' \
  -not -path './engine/target/*' \
  -not -path './dist/*')

cmp -s package.json desktop/package.json \
  && fail 'root and desktop manifests must remain distinct' \
  || true

root_version="$(node -p "require('./package.json').version")"
desktop_version="$(node -p "require('./desktop/package.json').version")"
[ "$root_version" = "$desktop_version" ] \
  || fail "version mismatch: root=$root_version desktop=$desktop_version"

printf 'public-tree check passed for v%s\n' "$root_version"
