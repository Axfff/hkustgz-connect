# Development and releases

## Repository layout

| Path | Purpose |
| --- | --- |
| `engine/` | Rust gateway protocol, network stack, SOCKS5, relay, fixtures |
| `cli/` | macOS lifecycle client and local templates |
| `desktop/` | Electron menu-bar app, isolated browser, tests, packaging |
| `config/` | Public gateway profile and empty local-policy schema |
| `scripts/` | Public-tree audit and release assembly |
| `.github/workflows/` | CI and tag release automation |
| `LICENSE`, `LICENSES/`, `PROVENANCE.md` | License boundaries, complete terms, and upstream record |

Generated binaries are never source-of-truth. The desktop build stages the
engine from `engine/target/release/` and the CLI release script assembles the
same binary into its archive.

## Local checks

```bash
rustup show
npm --prefix desktop ci
cargo +1.97.1 fmt --manifest-path engine/Cargo.toml --all -- --check
cargo +1.97.1 clippy --locked --manifest-path engine/Cargo.toml --all-targets -- -D warnings
cargo +1.97.1 test --locked --manifest-path engine/Cargo.toml
npm --prefix desktop test
bash -n cli/hkustgzconnect
bash scripts/check-public.sh
```

Live tests are separate from offline CI. They require the user's authorized
account and should target the smallest approved campus service needed to prove
the data path. Never add their raw output to Git.

Private network values belong only in the ignored user file
`~/.config/hkustgz-connect/policy.json`. Test fixtures use IETF documentation
address ranges. `scripts/check-public.sh` rejects RFC 1918 address literals in
the tracked tree.

## Build macOS artifacts

```bash
bash desktop/scripts/build-engine.sh
npm --prefix desktop run dist:mac:app
bash scripts/build-cli.sh
bash scripts/package-release.sh
```

Verify the app bundle with:

```bash
node desktop/build/verify-package.js \
  "desktop/release/mac-arm64/HKUST(GZ) Connect.app/Contents/Resources" \
  darwin arm64
codesign --verify --deep --strict \
  "desktop/release/mac-arm64/HKUST(GZ) Connect.app"
```

Release artifacts are ad-hoc signed unless a Developer ID identity is supplied
through electron-builder's standard signing environment. Do not describe an
ad-hoc signature as notarization.

## Release checklist

1. Update versions in root and desktop manifests and add the changelog entry.
2. Pass format, lint, Rust tests, Node tests, shell syntax, and public audit.
3. Build the engine once from the committed lockfile.
4. Package and verify the app and CLI archive. Confirm both contain `LICENSE`,
   `LICENSES/`, `NOTICE.md`, `PROVENANCE.md`, and `THIRD_PARTY_NOTICES.md`; the
   desktop must also contain Electron and Chromium notices.
5. Run approved coexistence canaries in both start orders.
6. Generate `SHA256SUMS.txt` from the exact upload artifacts.
7. Review `git ls-files` and `git diff --cached` for private material; run the
   RFC 1918 and identity audit immediately before tagging.
8. Tag `vX.Y.Z`; the release workflow rebuilds and publishes the artifacts.

Changes to source ancestry, copied code, source-reviewed implementations, or
dependencies must update `PROVENANCE.md` and the applicable license files in
the same commit. Do not use a permissive project license or describe the
engine as a clean-room implementation without documented permission and
qualified provenance review.

## Recovery

The client does not modify system routes or DNS, so recovery is scoped:

```bash
./cli/hkustgzconnect down
./cli/hkustgzconnect uninstall
```

Quit the menu-bar app separately if it owns the engine. Shadowrocket and the
optional fallback relay are independent and should be changed only when their
own configuration is the failure source.
