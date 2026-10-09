# Optional campus-aware relay on macOS

The local relay can select direct campus access while the desktop app and VPN
engine are stopped. Off campus it forwards the same SOCKS hostname or approved
private address to the campus engine. Shadowrocket keeps one campus-only module
and remains responsible for all ordinary Internet traffic.

This is opt-in through an owner-only `relay.json` beside the existing
`~/.config/hkustgz-connect/policy.json` (or under `XDG_CONFIG_HOME`). The relay
continues its previous behavior when this file is absent. Its fields are:

| Field | Meaning |
| --- | --- |
| `policy_file` | Absolute path to the existing local campus policy |
| `app_path` | Absolute path to the built HKUST(GZ) Connect app |
| `probe_host` | Approved campus SSH hostname for physical-path validation |
| `probe_port` | SSH port for that hostname |
| `gateway_address` | Last verified public gateway IPv4, used only as bootstrap fallback |
| `auto_launch` | Explicit opt-in for the relay to launch and stop that app; defaults to `false` |

The policy and configuration must be regular files owned by the current user,
without group or other access. No account secrets belong in this configuration.
GitHub downloads keep app lifecycle automation disabled when this field is
omitted or when `relay.json` is absent. Installing the compatibility relay alone
does not opt in.

## Routing

1. Identify the active physical `enN` interface and its DHCP DNS servers.
2. Require a DHCP DNS match with the locally supplied campus DNS list before
   attempting a private campus probe.
3. Resolve the probe hostname through the explicit campus DNS servers using a
   socket bound to the physical interface. Connect through that interface and
   read an SSH protocol banner. A TUN accepting TCP is insufficient evidence.
4. For an approved campus request, use physically bound campus DNS/TCP while
   campus access is confirmed. Otherwise forward the unresolved hostname to
   the campus engine, so VPN-side DNS remains inside the authenticated tunnel.
5. Reject private literal addresses outside the local route policy. Unrelated
   requests, if received, retain the existing general-upstream behavior.

Resolver instances are replaced on each detection cycle, preventing stale DNS
answers from persisting across interface changes. Published route state expires
after 25 seconds if detection stops. The relay changes no system routes, DNS,
proxy settings, SSH keys, or primary-proxy configuration.

The detector currently uses DHCP DNS as the campus-network marker. A network
with only manually configured DNS needs an extension to the detector; do not
claim it is covered by the DHCP validation.

## Automatic app lifecycle

The relay checks the network about every 8 seconds. Two successful campus
observations allow it to request graceful app shutdown. Three unsuccessful
observations on an active physical network, plus public gateway reachability,
allow an off-campus launch. Short failures on the same campus network retain
the direct route during this confirmation window. Network changes immediately
invalidate the previous network's direct-route evidence.

The public gateway is resolved using the current physical network's DHCP DNS;
the recorded address is only a fallback. The relay uses `open -g -a` with the
configured app path. The app handles Activity Monitor's SIGTERM through its
manual quit handler, which also stops its engine. Planned campus shutdown uses
SIGUSR2 together with a session-matched request so it cannot be confused with
an Activity Monitor Quit.

A manual **Quit**, Activity Monitor **Quit** or **Force Quit**, or an app crash
suppresses automatic reopening until the user deliberately opens the app again.
Suppression persists across Wi-Fi changes, campus detection, offline/sleep gaps,
and relay restarts. A manual **Disconnect** leaves the app running and is not
undone by the relay.

The app records an owner-only `app-session.json` before startup and marks a
normal manual exit as `manual-stopped`. If the process disappears while the
session is still `running`, the relay applies the same pause. A shutdown
requested by the relay after confirmed campus detection writes a
`campus-shutdown.json` request matching the session ID and PID; the app records
`campus-stopped` only for that tagged shutdown. Only this automatic shutdown
preserves permission to reopen off campus. Deliberately reopening the app
starts a new `running` session.

The app-owned engine monitors its parent and exits after a force-quit. Engines
started by the CLI or another owner are not affected.

On an admitted app startup, the app refreshes an existing managed relay binary
from its bundled version. It preserves the original LaunchAgent configuration
and whether the service was loaded; a failed update restores the prior binary
and service state. It does not install a relay or enable automation for a user
who has not opted in.

For temporary manual control, create the owner-only file
`~/.config/hkustgz-connect/auto-paused`. This is a separate override: removing it
does not clear a recorded manual stop, and reopening the app does not remove
this file. Deliberately reopen the app to clear a manual stop, and remove
`auto-paused` if present to permit automatic actions.
Pausing lifecycle actions does not change campus routing. The relay writes
`relay-state.json` in the same directory with mode, interface, update time and
manual-stop state; this file is diagnostic output, not configuration.

## SSH and Shadowrocket

Host-specific OpenSSH entries can use the standard macOS netcat client:

```sshconfig
ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1081 %h %p
ConnectTimeout 15
```

Configure account names and hostnames separately. Do not combine this command
with a mandatory ProxyJump for the same host. Preserve strict host-key checking;
different campus/VPN host keys require independent verification and explicit
authorization for any new hostname trust association.

Keep one Shadowrocket module containing the gateway DIRECT exception, campus
domain rules, reviewed private `/32` routes and the matching TUN inclusions.
The relay exposes TCP CONNECT only: disable UDP on its SOCKS node and reject
campus UDP before selecting it. It cannot supply campus UDP applications.
The module should not override general DNS, IPv6, public-service rules or the
default Internet node. Remove old campus URL-test groups and duplicated rules
from the base profile.

## Verification

Run the DNS library and relay tests, then verify SSH authentication with strict
known-host checks through both the physical campus path and the engine. Compare
public HTTPS through normal system routing and the primary SOCKS port with the
app on and off. Verify the app and engine actually disappear after confirmed
campus detection while the relay remains loaded.

With lifecycle automation explicitly enabled, verify normal **Quit** and
Activity Monitor **Force Quit** keep the app stopped after network changes,
sleep, and a relay restart. Reopen the app deliberately to resume, then confirm
a relay-requested campus shutdown can still reopen off campus. Repeat with a
CLI-owned engine and confirm only the app-owned engine exits on force-quit.

An isolated relay configuration with an unmatched DHCP DNS marker and
`auto_launch: false` can exercise the off-campus forwarding branch without
changing the real network. It does not prove a real Wi-Fi/hotspot transition,
which must still be validated separately. Existing SSH connections are not
migrated when the underlying network changes.
