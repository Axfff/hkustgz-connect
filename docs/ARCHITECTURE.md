# Architecture

## Components

```text
macOS app ----+
              +---- 127.0.0.1:1080 ---- Rust engine ---- campus gateway
CLI ----------+             |
                            +---- destination allowlist and VPN DNS

Shadowrocket ---- 127.0.0.1:1081 ---- optional fallback relay ---- 1080
OpenSSH ---- direct-first ec-ssh-route ---- direct campus TCP or 1080
```

`engine/` is the only implementation of authentication, tunnel framing, VPN
DNS, destination policy, and SOCKS5. The desktop app and CLI are lifecycle and
presentation layers; neither implements gateway protocol logic.

## Shared-engine contract

The local SOCKS listener is the coordination boundary. A frontend may attach
only when all of these checks pass:

1. exactly one process listens on the configured loopback port;
2. the process executable is an `ec-engine` build;
3. an approved campus hostname succeeds through SOCKS5 within a bounded time.

An unrelated listener or an unhealthy external engine is never killed. The
frontend reports the conflict and leaves ownership resolution to the user.

Ownership is process-local:

- the app keeps its child-process handle and stops only that child;
- the CLI records the PID it spawned, verifies the PID still resolves to its
  selected engine executable, and stops only that PID;
- an attached frontend clears only its own UI/control state on disconnect.

This deliberately avoids a privileged daemon or global system networking.
A future structured control socket could expose richer health events, but must
retain the same authentication and ownership boundary.

## State and credentials

| Data | Location | Owner |
| --- | --- | --- |
| CLI username/port | `~/.config/hkustgz-connect/config.toml` | user, mode 0600 |
| Shared private network policy | `~/.config/hkustgz-connect/policy.json` | user, mode 0600 |
| CLI password | macOS Keychain service `hkustgzconnect` | macOS |
| CLI log/PID/PAC | `~/.hkustgzconnect/` | user, mode 0600/0700 |
| App settings/credentials/logs | Electron user-data directory | user + OS secure storage |

The two frontends do not copy secrets between stores. They can attach to an
already authenticated engine without reading its credentials. If the owner
exits, an attached frontend can start a replacement only if that frontend has
its own saved credentials.

The tracked gateway profile contains public endpoints and domain suffixes
only. An optional local policy may replace only `vpn_dns_servers` and
`route_ipv4_cidrs`; the engine rejects other overlay keys. This keeps
campus-private topology out of source control while giving both frontends the
same network boundary.

## Failure behavior

- Listener existence alone is never reported as healthy.
- The engine performs an internal VPN-DNS keepalive and bounded reconnect.
- The app parses engine lifecycle messages and clears stale healthy status
  during internal recovery.
- The app and CLI both use active SOCKS probes for user-facing status.
- Private campus IPs fail closed when the engine is unavailable.

Detailed protocol boundaries are in [the engine architecture](../engine/ARCHITECTURE.md).
