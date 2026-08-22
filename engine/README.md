# Rust engine

`ec-engine` is an EasyConnect-compatible Rust runtime for the configured
HKUST(GZ) gateway. It authenticates with credentials supplied on standard
input, maintains the campus data plane, resolves internal names through VPN
DNS, and exposes a loopback-only SOCKS5 TCP/UDP listener.

The engine retains GPL-3.0-only code ancestry from
`heeh02/HKUST-GZ-Connect`. Its active modern protocol was also developed after
review of the AGPL-3.0-only `zju-connect` v1.1.1 source. It does not build,
download, link, embed, or invoke `zju-connect` or the official Sangfor client,
but no clean-room or expression-level separation is claimed. The engine is
therefore distributed under `GPL-3.0-only AND AGPL-3.0-only`. See the root
`LICENSE`, `PROVENANCE.md`, and `NOTICE.md`.

Authorized black-box validation of the official client and live gateway was
also used for compatibility testing. No official client binary is distributed.

## Runtime properties

- mandatory TLS certificate and hostname verification;
- credentials accepted through standard input, not command arguments;
- zeroized password, session, and token material where practical;
- bounded packet, DNS, HTTP, and tunnel framing;
- loopback-only SOCKS5 listener;
- destination admission enforced inside the engine;
- VPN-DNS liveness probe and in-process reconnect with bounded backoff;
- no global route, DNS, proxy, shell, or network-interface changes.

The gateway's active transport requires isolated legacy TLS 1.1 and RC4-SHA
compatibility. It is implemented only for the verified gateway channel and is
not exposed as a general TLS API. See [ARCHITECTURE.md](ARCHITECTURE.md) and
[spec/PROTOCOL.md](spec/PROTOCOL.md).

## Build and test

```bash
cd engine
cargo fmt --all -- --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
LZMA_API_STATIC=1 cargo build --locked --release --bin ec-engine --bin ec-fallback
```

The toolchain and dependency graph are pinned in `rust-toolchain.toml` and
`Cargo.lock`. The netstack dependency is pinned to a maintained release that
generation-checks blocked UDP operations before reusing socket handles.

## Binaries

| Binary | Purpose |
| --- | --- |
| `ec-engine` | Production tunnel and SOCKS5 runtime |
| `ec-fallback` | Optional Shadowrocket coexistence relay |
| `ec-watch` | Sanitized public gateway metadata observer |
| `ec-probe` | Authorized, redacted authentication/transport probe |
| `ec-binary-watch` | Bounded official-package capability observer |
| `ec-protocol-map` | Marker and text-relative protocol mapper |
| `ec-adapter-check` | Legacy preface compatibility validator |

Only `ec-engine` and `ec-fallback` are shipped in normal user releases. The
remaining binaries are maintenance laboratory tools and must be used only with
authorized inputs.

## Evidence boundary

Never commit credentials, cookies, TWFID values, tokens, assigned VPN
addresses, proprietary binaries, decompiler projects, packet captures, or raw
live responses. Offline tests use synthetic fixtures under `tests/fixtures/`.

Public release profiles belong in the repository-level `config/` directory.
Local snapshots, diffs, captures, artifacts, and build output are ignored.
