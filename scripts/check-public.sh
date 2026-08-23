#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"

fail() {
  printf 'public-tree check failed: %s\n' "$*" >&2
  printf '::error title=Public tree audit::%s\n' "$*" >&2
  exit 1
}

audit_error() {
  local line="$1" status="$2"
  printf '::error title=Public tree audit::unexpected failure at line %s (status %s)\n' \
    "$line" "$status" >&2
  exit "$status"
}
trap 'audit_error "$LINENO" "$?"' ERR

command -v rg >/dev/null 2>&1 || fail "the 'rg' command is required"
command -v file >/dev/null 2>&1 || fail "the 'file' command is required"

for forbidden in \
  config.toml cred.bin settings.json campus-credentials.json \
  '*.pcap' '*.pcapng' '*.har' '*.key' '*.pem'
do
  match="$(find . \
    \( -path './.git' \
      -o -path './desktop/node_modules' \
      -o -path './desktop/release' \
      -o -path './desktop/engine' \
      -o -path './engine/target' \
      -o -path './dist' \) -prune \
    -o -type f -name "$forbidden" -print -quit)"
  [ -z "$match" ] || fail "forbidden local/evidence file: $match"
done

if rg -n --hidden \
  -g '!scripts/check-public.sh' \
  -g '!scripts/check-release.sh' \
  -g '!.git/**' \
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
done < <(find . \
  \( -path './.git' \
    -o -path './desktop/node_modules' \
    -o -path './desktop/release' \
    -o -path './desktop/engine' \
    -o -path './engine/target' \
    -o -path './dist' \) -prune \
  -o -type f -print)

cmp -s package.json desktop/package.json \
  && fail 'root and desktop manifests must remain distinct' \
  || true

root_version="$(node -p "require('./package.json').version")"
desktop_version="$(node -p "require('./desktop/package.json').version")"
[ "$root_version" = "$desktop_version" ] \
  || fail "version mismatch: root=$root_version desktop=$desktop_version"

expected_license='GPL-3.0-only AND AGPL-3.0-only'
root_license="$(node -p "require('./package.json').license")"
desktop_license="$(node -p "require('./desktop/package.json').license")"
[ "$root_license" = "$expected_license" ] \
  || fail "unexpected root license expression: $root_license"
[ "$desktop_license" = "$expected_license" ] \
  || fail "unexpected desktop license expression: $desktop_license"
rg -q '^license = "GPL-3.0-only AND AGPL-3.0-only"$' engine/Cargo.toml \
  || fail 'engine manifest is missing the combined GPL/AGPL expression'

for legal_file in \
  LICENSE NOTICE.md PROVENANCE.md THIRD_PARTY_NOTICES.md \
  LICENSES/GPL-3.0-only.txt LICENSES/AGPL-3.0-only.txt \
  LICENSES/BSD-3-Clause-GeiserX-tailscale-rs.txt
do
  [ -s "$legal_file" ] || fail "missing legal material: $legal_file"
done

printf 'public-tree check passed for v%s\n' "$root_version"
