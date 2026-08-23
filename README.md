# HKUST(GZ) Connect

An unofficial, open-source, application-scoped client for authorized access to
the HKUST(GZ) campus network through its Sangfor EasyConnect-compatible
gateway. It is designed to add a campus path while a primary proxy, Tailscale,
or ordinary network connection keeps control of everything else.

The project provides two interfaces over one Rust network engine:

- **macOS app:** menu-bar status, connect/disconnect controls, diagnostics,
  common campus links, and guided Shadowrocket, Mihomo, PAC, and SSH setup.
- **CLI:** scriptable lifecycle, status, health checks, PAC generation, and
  optional launch-at-login service.

You may install either interface or both. When one interface already owns a
healthy engine on `127.0.0.1:1080`, the other attaches to that engine instead
of starting a second session. Disconnecting or quitting an attached interface
does not terminate an engine it did not start.

The engine binds to loopback and does not replace the default route, system
DNS, or system proxy by default. This reduces collisions with other network
services, but it cannot guarantee compatibility when two TUNs claim the same
route or DNS policy. See [Network coexistence](docs/NETWORK_COEXISTENCE.md).

> This is a community project, not an official HKUST or HKUST(GZ) product.
> Use it only with an account and resources you are authorized to access.

## Install

The [release page](https://github.com/Axfff/hkustgz-connect/releases/latest)
contains:

- `hkustgzconnect-1.4.0-mac-arm64.dmg` for the menu-bar app;
- `hkustgz-connect-cli-1.4.0-macos-arm64.tar.gz` for the CLI;
- `SHA256SUMS.txt` for verification.

The current binary release supports Apple silicon Macs. Intel and other
platforms can build the engine from source, but are not release-tested yet.

### macOS app

1. Download the DMG and verify its SHA-256 checksum.
2. Drag **HKUST(GZ) Connect** to Applications.
3. Open it, enter your campus account, and select **Connect**.

The community build is ad-hoc signed, not Apple-notarized. On first launch,
right-click the app and choose **Open** if Gatekeeper asks for confirmation.
The app lives in the menu bar after its window closes.

Quick Access links open in the macOS default browser. The app does not embed a
second browser or change the system proxy. When off campus, configure that
browser with the generated PAC URL or an existing Shadowrocket campus route.

macOS may separately request permission to use the Keychain when the saved VPN
password is first needed. The app requests that saved VPN password at most once
per launch and reuses the result only in memory until it quits. Launching with
auto-connect disabled, or attaching to a CLI-owned engine, does not read it.
Select **Always Allow** if macOS offers it. Because community releases do not
yet have a stable Developer ID signature, macOS can request permission again
after an app update.

### CLI

Extract the CLI archive, then run:

```bash
cd hkustgz-connect-cli-1.4.0-macos-arm64
./cli/hkustgzconnect configure YOUR_CAMPUS_USERNAME
./cli/hkustgzconnect set-password
./cli/hkustgzconnect up
./cli/hkustgzconnect status
```

The password is stored in macOS Keychain. The username and port are stored in
`~/.config/hkustgz-connect/config.toml` with owner-only permissions.

The public release does not embed private campus address ranges or DNS server
addresses. If private-IP access is required, obtain a policy file through an
approved campus source and install it before connecting:

```bash
./cli/hkustgzconnect set-policy /path/to/policy.json
```

The desktop app can configure the same values under **Settings > Advanced
route policy**. Both interfaces use the owner-only file
`~/.config/hkustgz-connect/policy.json`; the empty public schema is shown in
`config/policy.json.example`.

## Using both interfaces

Both interfaces discover the listener owner and verify a real campus path
before attaching:

| First owner | Second interface | Result |
| --- | --- | --- |
| CLI | App | App shows **Using the verified shared engine** |
| App | CLI | `up` reports **attached** and `status` reports another owner |
| Either | Same interface | Reuses the existing healthy session |
| Unrelated process on port 1080 | Either | Fails with the owning process and port |
| Unhealthy engine owned elsewhere | Either | Fails closed; it is not killed automatically |

`down` stops only the PID recorded by this CLI. Quitting the app stops only its
own child process. This prevents one interface from terminating the other.
The app also refuses to change the campus SOCKS port while attached to an
engine owned by another interface; stop that engine from its owner before
changing the shared endpoint.

For predictable launch-at-login behavior, enable it in one interface. If CLI
autostart starts first, the app will attach when it opens.

## Connect other applications

The local SOCKS5 endpoint is `127.0.0.1:1080`. It admits only the public campus
domains plus any network ranges in the user's local policy.

On macOS, the common HPC login has a managed setup under **Access > Application
access > HPC SSH**. Choose **Install** once, then use either:

```bash
ssh YOUR_HPC_USERNAME@hkustgz-hpc
ssh YOUR_HPC_USERNAME@hpc2login.hpc.hkust-gz.edu.cn
```

The installed helper first reuses a direct connection when the HPC service is
reachable on campus. Otherwise it passes the unresolved hostname to the campus
SOCKS engine, so private campus DNS does not depend on the system or
Shadowrocket resolver. The installation updates automatically with the app's
SOCKS port and can be removed from the same control.

For private IP servers and other manually approved SSH targets, add a
host-specific block to `~/.ssh/config`:

```sshconfig
Host campus-server
    HostName CAMPUS_SERVER_IP
    User YOUR_SERVER_USERNAME
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1080 %h %p
```

Then connect with `ssh campus-server`. Normal SSH does not use the macOS web
proxy settings, so the `ProxyCommand` is required for private campus addresses.

For browsers and tools that support PAC files:

```bash
./cli/hkustgzconnect pac
```

The generated PAC replaces another browser-level PAC or explicit proxy; it does
not compose those policies automatically. Prefer the primary client's TUN mode
or merge PAC rules manually when the browser itself already owns proxy policy.

See [Network coexistence](docs/NETWORK_COEXISTENCE.md) for browser, Shadowrocket,
Clash/Mihomo, and Tailscale setup, and [Traffic and
proxying](docs/TRAFFIC_AND_PROXYING.md) for the underlying route boundaries.

### Coexistence with a primary proxy

The app exposes integrations under **Access > Network compatibility**. Keep
Shadowrocket or Clash/Mihomo in charge of normal Internet traffic and route
only reviewed campus destinations to HKUST(GZ) Connect.

For Shadowrocket, select **Prepare**, create a local SOCKS5 node named
`HKUSTGZ` at `127.0.0.1:1081`, and copy the default **Campus only** module into
**Config > Modules > New Module**. Leave the normal Internet-capable node or
policy group selected as the default. The campus-only preset preserves the
existing DNS and IPv6 policy and rejects unsupported campus UDP before it can
fall through to another route.

The **Realtime/DNS repair** preset is opt-in and replaces the campus-only
module; keep exactly one `HKUST(GZ) Connect` module enabled. It changes
Shadowrocket DNS/IPv6 behavior and pins reviewed OpenAI domains to the primary
proxy. Consider it only when diagnostics report failed system/TUN HTTPS
reachability and successful explicit primary SOCKS HTTPS reachability. After
installing it, verify the persistent connection in the affected application;
the diagnostic requests to `chatgpt.com` and `ws.chatgpt.com` do not prove a
working WebSocket or stream.
CLI users have matching commands:

```bash
./cli/hkustgzconnect install-fallback
./cli/hkustgzconnect shadowrocket-module
./cli/hkustgzconnect doctor-public
./cli/hkustgzconnect shadowrocket-repair-module
```

CLI relay and diagnostic commands reuse the installed relay port or desktop
setting when present. Set `HKUSTGZ_PRIMARY_PROXY_PORT=PORT` for an explicit
one-command override; each command prints the endpoint and its source.

For Clash/Mihomo, use **Copy snippet** or
`./cli/hkustgzconnect mihomo-profile`, merge the local node, and place the
generated ordered rules before broad `DIRECT`, `GEOIP`, or `MATCH` rules. The
generator does not rewrite subscriptions, proxy groups, DNS, or the final
policy. HKUST(GZ) Connect also leaves Tailscale routes, MagicDNS, and exit-node
settings untouched; overlapping subnet or TUN routes still require review.

## Build and test

Prerequisites: Rust 1.97.1 through `rustup`, Node.js 22+, and npm.

```bash
npm --prefix desktop ci
cargo +1.97.1 test --locked --manifest-path engine/Cargo.toml
npm test
npm run check
bash desktop/scripts/build-engine.sh
npm --prefix desktop run dist:mac:app
```

The engine is staged into `desktop/engine/` only during a build and is ignored
by Git. Release archives are generated under `dist/`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Network coexistence](docs/NETWORK_COEXISTENCE.md)
- [Comparison with EasyConnect](docs/EASYCONNECT_COMPARISON.md)
- [Traffic and proxying](docs/TRAFFIC_AND_PROXYING.md)
- [Development and releases](docs/DEVELOPMENT.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Engine internals](engine/ARCHITECTURE.md)
- [Protocol specification](engine/spec/PROTOCOL.md)

## License

This is a mixed-provenance GPLv3/AGPLv3 combined distribution, not a
permissively licensed rewrite:

- inherited desktop, CLI, documentation, and tooling material remains
  `GPL-3.0-only`;
- `engine/` is handled conservatively as
  `GPL-3.0-only AND AGPL-3.0-only`;
- third-party components, including the BSD-3-Clause userspace netstack,
  retain their own licenses.

See [LICENSE](LICENSE), [source provenance](PROVENANCE.md),
[notices](NOTICE.md), [third-party notices](THIRD_PARTY_NOTICES.md), and the
complete texts under [LICENSES](LICENSES/). These files are included in both
CLI and desktop release packages.
