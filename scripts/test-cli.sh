#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"

assert_before() {
  local file="$1" first="$2" second="$3" first_match second_match first_line second_line
  first_match="$(grep -nF "$first" "$file")"
  second_match="$(grep -nF "$second" "$file")"
  first_line="${first_match%%:*}"
  second_line="${second_match%%:*}"
  if [ -z "$first_line" ] || [ -z "$second_line" ] || [ "$first_line" -ge "$second_line" ]; then
    printf 'expected rule before another rule in %s: %s < %s\n' "$file" "$first" "$second" >&2
    exit 1
  fi
}

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
! grep -Fq 'hijack-dns = :53' "$module"
grep -Fq 'AND,((PROTOCOL,UDP),(IP-CIDR,198.51.100.9/32,no-resolve)),REJECT-NO-DROP' "$module"
assert_before "$module" \
  'AND,((PROTOCOL,UDP),(DOMAIN-SUFFIX,hkust-gz.edu.cn)),REJECT-NO-DROP' \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT'
assert_before "$module" \
  'AND,((PROTOCOL,UDP),(IP-CIDR,198.51.100.9/32,no-resolve)),REJECT-NO-DROP' \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT'
assert_before "$module" \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT' \
  'IP-CIDR,198.51.100.9/32,HKUSTGZ,no-resolve'

HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" shadowrocket-repair-module >/dev/null
repair_module="$temporary/home/.hkustgzconnect/hkustgz-connect-repair.module"
grep -Fq 'hijack-dns = :53' "$repair_module"
assert_before "$repair_module" \
  'AND,((PROTOCOL,UDP),(DOMAIN-SUFFIX,hkust-gz.edu.cn)),REJECT-NO-DROP' \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT'

HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" mihomo-profile >/dev/null
mihomo="$temporary/home/.hkustgzconnect/hkustgz-connect-mihomo.yaml"
grep -Fq 'port: 1080' "$mihomo"
grep -Fq 'udp: false' "$mihomo"
grep -Fq 'AND,((IP-CIDR,198.51.100.9/32,no-resolve),(NETWORK,udp)),REJECT' "$mihomo"
grep -Fq 'IP-CIDR,203.0.113.0/24,HKUSTGZ,no-resolve' "$mihomo"
assert_before "$mihomo" \
  'AND,((DOMAIN-SUFFIX,hkust-gz.edu.cn),(NETWORK,udp)),REJECT' \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT'
assert_before "$mihomo" \
  'AND,((IP-CIDR,198.51.100.9/32,no-resolve),(NETWORK,udp)),REJECT' \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT'
assert_before "$mihomo" \
  'DOMAIN,remote.hkust-gz.edu.cn,DIRECT' \
  'IP-CIDR,203.0.113.0/24,HKUSTGZ,no-resolve'

cat > "$policy" <<'EOF'
{
  "version": 1,
  "vpn_dns_servers": [],
  "route_ipv4_cidrs": []
}
EOF
HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" shadowrocket-module >/dev/null
HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" mihomo-profile >/dev/null
! grep -Fq '__ROUTE_IPV4_RULES__' "$module"
! grep -Fq '__UDP_REJECT_RULES__' "$module"
! grep -Fq 'IP-CIDR,' "$module"
! grep -Fq '__ROUTE_IPV4_RULES__' "$mihomo"
! grep -Fq '__UDP_REJECT_RULES__' "$mihomo"

invalid_policy="$temporary/invalid-policy.json"
cat > "$invalid_policy" <<'EOF'
{
  "version": 1,
  "vpn_dns_servers": [],
  "route_ipv4_cidrs": ["999.1.1.0/24"]
}
EOF
if HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" set-policy "$invalid_policy" >/dev/null 2>&1; then
  printf 'invalid IPv4 octets were accepted\n' >&2
  exit 1
fi
sed 's/999.1.1.0\/24/198.51.100.9\/24/' "$invalid_policy" > "$policy"
if HOME="$temporary/home" "$ROOT/cli/hkustgzconnect" mihomo-profile >/dev/null 2>&1; then
  printf 'noncanonical IPv4 route was accepted\n' >&2
  exit 1
fi

unexpected_policy="$temporary/unexpected-policy.json"
cat > "$unexpected_policy" <<'EOF'
{
  "version": 1,
  "vpn_dns_servers": [],
  "route_ipv4_cidrs": [],
  "description": "unsupported"
}
EOF
if HOME="$temporary/policy-home" "$ROOT/cli/hkustgzconnect" set-policy "$unexpected_policy" >/dev/null 2>&1; then
  printf 'an unknown network-policy key was accepted\n' >&2
  exit 1
fi

helper_home="$temporary/helper home & data"
helper_launch_agents="$helper_home/Library/LaunchAgents"
helper_desktop="$helper_home/Library/Application Support/hkustgzconnect"
mkdir -p "$helper_launch_agents" "$helper_desktop"
[ "$(HOME="$helper_home" "$ROOT/cli/hkustgzconnect" __test-primary-proxy)" = '1082|default' ]
cat > "$helper_desktop/settings.json" <<'EOF'
{"primaryProxyPort": 5082}
EOF
chmod 600 "$helper_desktop/settings.json"
[ "$(HOME="$helper_home" "$ROOT/cli/hkustgzconnect" __test-primary-proxy)" = '5082|desktop settings' ]
helper_plist="$helper_launch_agents/com.hkustgz.connect-fallback.plist"
HKUSTGZ_PRIMARY_PROXY_PORT=4082 HOME="$helper_home" \
  "$ROOT/cli/hkustgzconnect" __test-render-fallback-plist "$helper_plist" en0
plutil -lint "$helper_plist" >/dev/null
grep -Fq '&amp;' "$helper_plist"
[ "$(HOME="$helper_home" "$ROOT/cli/hkustgzconnect" __test-primary-proxy)" = '4082|installed relay' ]
[ "$(HKUSTGZ_PRIMARY_PROXY_PORT=6082 HOME="$helper_home" \
  "$ROOT/cli/hkustgzconnect" __test-primary-proxy)" = '6082|HKUSTGZ_PRIMARY_PROXY_PORT' ]
if HKUSTGZ_PRIMARY_PROXY_PORT=01081 HOME="$helper_home" \
  "$ROOT/cli/hkustgzconnect" __test-primary-proxy >/dev/null 2>&1; then
  printf 'a zero-padded primary proxy port was accepted\n' >&2
  exit 1
fi

doctor_home="$temporary/doctor-home"
doctor_bin="$temporary/doctor-bin"
doctor_log="$temporary/doctor-curl.log"
mkdir -p "$doctor_home" "$doctor_bin"
cat > "$doctor_bin/curl" <<'EOF'
#!/bin/bash
printf 'CALL' >> "$FAKE_CURL_LOG"
for argument in "$@"; do printf '<%s>' "$argument" >> "$FAKE_CURL_LOG"; done
printf '\n' >> "$FAKE_CURL_LOG"
printf '403'
EOF
chmod 755 "$doctor_bin/curl"
ALL_PROXY='http://127.0.0.1:9' HTTPS_PROXY='http://127.0.0.1:9' NO_PROXY='*' \
  FAKE_CURL_LOG="$doctor_log" HOME="$doctor_home" PATH="$doctor_bin:$PATH" \
  "$ROOT/cli/hkustgzconnect" doctor-public >/dev/null
[ "$(grep -Fc '<--noproxy><*>' "$doctor_log")" -eq 2 ]
[ "$(grep -Fc '<--noproxy><><--proxy><socks5h://127.0.0.1:1082>' "$doctor_log")" -eq 2 ]
[ "$(wc -l < "$doctor_log" | tr -d ' ')" -eq 4 ]
NO_PROXY='*' FAKE_CURL_LOG="$doctor_log" HOME="$doctor_home" PATH="$doctor_bin:$PATH" \
  "$ROOT/cli/hkustgzconnect" __test-campus-probe >/dev/null
[ "$(grep -Fc '<--noproxy><><--proxy><socks5h://127.0.0.1:1080>' "$doctor_log")" -eq 1 ]
[ "$(wc -l < "$doctor_log" | tr -d ' ')" -eq 5 ]

[ "$(HOME="$helper_home" "$ROOT/cli/hkustgzconnect" \
  __test-select-physical-interface en8 en7 1 1)" = 'en8' ]
[ "$(HOME="$helper_home" "$ROOT/cli/hkustgzconnect" \
  __test-select-physical-interface utun4 en7 0 1)" = 'en7' ]
if HOME="$helper_home" "$ROOT/cli/hkustgzconnect" \
  __test-select-physical-interface en8 en7 0 1 >/dev/null 2>&1; then
  printf 'an inactive physical default incorrectly fell back to the saved interface\n' >&2
  exit 1
fi
if HOME="$helper_home" "$ROOT/cli/hkustgzconnect" \
  __test-select-physical-interface utun4 en7 0 0 >/dev/null 2>&1; then
  printf 'an inactive saved interface was reused behind a TUN default\n' >&2
  exit 1
fi

active_interface=''
for candidate in $(/sbin/ifconfig -l); do
  case "$candidate" in
    en[0-9]*)
      if /sbin/ifconfig "$candidate" 2>/dev/null \
        | grep -Eq '^[[:space:]]*status:[[:space:]]*active[[:space:]]*$'; then
        active_interface="$candidate"
        break
      fi
      ;;
  esac
done
[ -n "$active_interface" ] || { printf 'no active enN interface is available for relay tests\n' >&2; exit 1; }

relay_home="$temporary/relay-home"
relay_rundir="$relay_home/.hkustgzconnect"
relay_plist="$relay_home/Library/LaunchAgents/com.hkustgz.connect-fallback.plist"
relay_install="$relay_rundir/bin/ec-fallback"
relay_source="$temporary/ec-fallback-new"
fake_bin="$temporary/fake-bin"
fake_state="$temporary/fake-launchctl-state"
mkdir -p "$relay_rundir/bin" "$(dirname "$relay_plist")" "$fake_bin"
printf '#!/bin/sh\nprintf "new relay\\n"\n' > "$relay_source"
chmod 755 "$relay_source"
printf '#!/bin/sh\nprintf "old relay\\n"\n' > "$relay_install"
chmod 755 "$relay_install"
HKUSTGZ_PRIMARY_PROXY_PORT=4082 HOME="$relay_home" \
  "$ROOT/cli/hkustgzconnect" __test-render-fallback-plist "$relay_plist" "$active_interface"
cp -p "$relay_install" "$temporary/old-relay"
cp -p "$relay_plist" "$temporary/old-relay.plist"

cat > "$fake_bin/launchctl" <<'EOF'
#!/bin/bash
case "${1:-}" in
  print)
    [ -f "$FAKE_LAUNCHCTL_STATE" ] || exit 3
    printf 'service = {\n\tpid = %s\n}\n' "$(cat "$FAKE_LAUNCHCTL_STATE")"
    ;;
  bootstrap)
    if [ -n "${FAKE_BREAK_RESTORE_DIR:-}" ]; then chmod 500 "$FAKE_BREAK_RESTORE_DIR"; fi
    [ "${FAKE_BOOTSTRAP_FAIL:-0}" -ne 1 ] || exit 5
    printf '%s\n' "${FAKE_JOB_PID:-4242}" > "$FAKE_LAUNCHCTL_STATE"
    ;;
  bootout)
    rm -f "$FAKE_LAUNCHCTL_STATE"
    ;;
  *) exit 2 ;;
esac
EOF
cat > "$fake_bin/lsof" <<'EOF'
#!/bin/bash
case " $* " in
  *' -d txt '*)
    [ -f "$FAKE_LAUNCHCTL_STATE" ] || exit 1
    printf 'p%s\nn%s\n' "${FAKE_LISTENER_PID:-4242}" "$FAKE_RELAY_EXECUTABLE"
    exit 0
    ;;
esac
[ -f "$FAKE_LAUNCHCTL_STATE" ] || exit 1
case " $* " in *' -t '*) printf '%s\n' "${FAKE_LISTENER_PID:-4242}" ;; esac
EOF
cat > "$fake_bin/install" <<'EOF'
#!/bin/bash
last=''
for argument in "$@"; do last="$argument"; done
if [ "${FAKE_FAIL_PLIST_INSTALL:-0}" -eq 1 ]; then
  case "$last" in *.plist.replace.*) exit 9 ;; esac
fi
exec /usr/bin/install "$@"
EOF
chmod 755 "$fake_bin/launchctl" "$fake_bin/lsof" "$fake_bin/install"

relay_test_path="$fake_bin:$PATH"
relay_output="$temporary/relay-output"
relay_lock="$relay_rundir/compatibility-relay.lock"
(umask 077; : > "$relay_lock")
chmod 600 "$relay_lock"
exec 8<>"$relay_lock"
/usr/bin/lockf -s -t 0 8
if FAKE_LAUNCHCTL_STATE="$fake_state" FAKE_RELAY_EXECUTABLE="$relay_install" \
  HKUSTGZ_FALLBACK_BIN="$relay_source" HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" install-fallback 8>&- >"$relay_output" 2>&1; then
  printf 'relay install ignored a live desktop-compatible kernel lock\n' >&2
  exit 1
fi
grep -Fq 'compatibility relay is busy' "$relay_output"
cmp "$temporary/old-relay" "$relay_install"
cmp "$temporary/old-relay.plist" "$relay_plist"
exec 8>&-

if FAKE_FAIL_PLIST_INSTALL=1 FAKE_LAUNCHCTL_STATE="$fake_state" \
  FAKE_RELAY_EXECUTABLE="$relay_install" HKUSTGZ_FALLBACK_BIN="$relay_source" \
  HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" install-fallback >"$relay_output" 2>&1; then
  printf 'relay install unexpectedly survived an injected plist failure\n' >&2
  exit 1
fi
cmp "$temporary/old-relay" "$relay_install"
cmp "$temporary/old-relay.plist" "$relay_plist"
grep -Fq 'previous state restored' "$relay_output" \
  || { printf 'relay rollback output:\n' >&2; cat "$relay_output" >&2; exit 1; }
[ -f "$relay_lock" ] || { printf 'persistent relay lock file disappeared\n' >&2; exit 1; }
[ "$(stat -f '%Lp' "$relay_lock")" = "600" ]

if FAKE_JOB_PID=4242 FAKE_LISTENER_PID=9999 FAKE_LAUNCHCTL_STATE="$fake_state" \
  FAKE_RELAY_EXECUTABLE="$relay_install" HKUSTGZ_FALLBACK_BIN="$relay_source" \
  HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" install-fallback >"$relay_output" 2>&1; then
  printf 'relay install accepted a listener owned by the wrong PID\n' >&2
  exit 1
fi
cmp "$temporary/old-relay" "$relay_install"
cmp "$temporary/old-relay.plist" "$relay_plist"
grep -Fq 'previous state restored' "$relay_output"

if FAKE_BOOTSTRAP_FAIL=1 FAKE_BREAK_RESTORE_DIR="$relay_rundir/bin" \
  FAKE_LAUNCHCTL_STATE="$fake_state" FAKE_RELAY_EXECUTABLE="$relay_install" \
  HKUSTGZ_FALLBACK_BIN="$relay_source" HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" install-fallback >"$relay_output" 2>&1; then
  printf 'relay install unexpectedly survived an injected restore failure\n' >&2
  exit 1
fi
chmod 700 "$relay_rundir/bin"
rollback_dir="$(find "$relay_rundir" -maxdepth 1 -type d -name 'fallback-rollback.*' -print -quit)"
[ -n "$rollback_dir" ] || { printf 'failed relay restore did not retain its backup\n' >&2; exit 1; }
cmp "$temporary/old-relay" "$rollback_dir/ec-fallback"
grep -Fq 'backup retained at' "$relay_output"
cp -p "$rollback_dir/ec-fallback" "$relay_install"
cp -p "$rollback_dir/com.hkustgz.connect-fallback.plist" "$relay_plist"
rm -rf "$rollback_dir"

FAKE_JOB_PID=4242 FAKE_LISTENER_PID=4242 FAKE_LAUNCHCTL_STATE="$fake_state" \
  FAKE_RELAY_EXECUTABLE="$relay_install" HKUSTGZ_FALLBACK_BIN="$relay_source" \
  HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" install-fallback >"$relay_output"
cmp "$relay_source" "$relay_install"
grep -Fq 'socks5h://127.0.0.1:4082 (installed relay)' "$relay_output"
FAKE_JOB_PID=4242 FAKE_LISTENER_PID=4242 FAKE_LAUNCHCTL_STATE="$fake_state" \
  FAKE_RELAY_EXECUTABLE="$relay_install" HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" __test-fallback-owned >/dev/null

mv "$relay_plist" "$relay_plist.saved"
ln -s "$relay_plist.saved" "$relay_plist"
if FAKE_LAUNCHCTL_STATE="$fake_state" HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" uninstall-fallback >/dev/null 2>&1; then
  printf 'relay uninstall accepted a symbolic-link target\n' >&2
  exit 1
fi
[ -f "$fake_state" ] || { printf 'relay uninstall stopped the service before validation\n' >&2; exit 1; }
rm "$relay_plist"
mv "$relay_plist.saved" "$relay_plist"
FAKE_LAUNCHCTL_STATE="$fake_state" HOME="$relay_home" PATH="$relay_test_path" \
  "$ROOT/cli/hkustgzconnect" uninstall-fallback >/dev/null
[ ! -e "$relay_plist" ] && [ ! -e "$relay_install" ] && [ ! -e "$fake_state" ]

printf 'CLI integration tests passed\n'
