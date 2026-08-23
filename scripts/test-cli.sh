#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'CLI integration tests skipped (macOS plutil required)\n'
  exit 0
fi

temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT
mkdir -p "$temporary/home/.config/hkustgz-connect"

policy="$temporary/home/.config/hkustgz-connect/policy.json"
cat > "$policy" <<'EOF'
{
  "version": 1,
  "vpn_dns_servers": ["192.0.2.53"],
  "route_ipv4_cidrs": ["198.51.100.9/32", "203.0.113.0/24"]
}
EOF

HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" shadowrocket-module >/dev/null
module="$temporary/home/.hkustgzconnect/hkustgz-connect.module"
grep -Fq 'IP-CIDR,198.51.100.9/32,HKUSTGZ,no-resolve' "$module"
grep -Fq 'tun-included-routes = 198.51.100.9/32, 203.0.113.0/24' "$module"

printf 'CLI integration tests passed\n'
