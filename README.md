# HKUST(GZ) Connect

An unofficial, open-source client for authorized access to the HKUST(GZ)
campus network through its Sangfor EasyConnect-compatible gateway.

The project provides two interfaces over one Rust network engine:

- **macOS app:** menu-bar status, connect/disconnect controls, diagnostics,
  common campus links, and an isolated campus browser.
- **CLI:** scriptable lifecycle, status, health checks, PAC generation, and
  optional launch-at-login service.

You may install either interface or both. When one interface already owns a
healthy engine on `127.0.0.1:1080`, the other attaches to that engine instead
of starting a second session. Disconnecting or quitting an attached interface
does not terminate an engine it did not start.

> This is a community project, not an official HKUST or HKUST(GZ) product.
> Use it only with an account and resources you are authorized to access.

## Install

The [release page](https://github.com/Axfff/hkustgz-connect/releases/latest)
contains:

- `hkustgzconnect-1.1.6-mac-arm64.dmg` for the menu-bar app;
- `hkustgz-connect-cli-1.1.6-macos-arm64.tar.gz` for the CLI;
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
cd hkustgz-connect-cli-1.1.6-macos-arm64
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

For predictable launch-at-login behavior, enable it in one interface. If CLI
autostart starts first, the app will attach when it opens.

## Connect other applications

The local SOCKS5 endpoint is `127.0.0.1:1080`. It admits only the public campus
domains plus any network ranges in the user's local policy.

For SSH, add a host-specific block to `~/.ssh/config`:

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

See [Traffic and proxying](docs/TRAFFIC_AND_PROXYING.md) for Shadowrocket and
literal private-IP routing.

### Shadowrocket coexistence

Install the loopback relay and generate the compatibility module:

```bash
./cli/hkustgzconnect install-fallback
./cli/hkustgzconnect shadowrocket-module
./cli/hkustgzconnect doctor-public
```

Create a Shadowrocket SOCKS5 node named `HKUSTGZ` at `127.0.0.1:1081`. Then
open **Config > Modules > New Module**, paste the generated file's contents,
save it, and enable `HKUST(GZ) Connect`. Leave a normal Internet-capable node
selected as the default. The module gives campus rules higher priority without
making the campus node the global proxy. It also uses encrypted DNS through the
normal proxy for ChatGPT and Codex realtime connections.

The app exposes the same generated module under **Access > External
applications** and checks the public realtime route under **Diagnostics**.

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
