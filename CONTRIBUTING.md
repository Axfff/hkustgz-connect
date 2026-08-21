# Contributing

## Before a change

Open an issue describing the user-visible problem, affected gateway version,
and whether the evidence came from synthetic fixtures, public metadata, or an
authorized test account. Do not attach raw proprietary binaries, packet
captures, credentials, cookies, tokens, or unsanitized logs.

## Development checks

```bash
cargo +1.97.1 fmt --manifest-path engine/Cargo.toml --all -- --check
cargo +1.97.1 clippy --locked --manifest-path engine/Cargo.toml --all-targets -- -D warnings
cargo +1.97.1 test --locked --manifest-path engine/Cargo.toml
npm --prefix desktop ci
npm --prefix desktop test
bash -n cli/hkustgzconnect
bash scripts/check-public.sh
```

Changes to packet framing, authentication, cryptography, allowlists, credential
storage, process ownership, or release signing require focused regression tests
and a security review.

## Design rules

- Keep gateway protocol code in `engine/`, interface code in `cli/` or
  `desktop/`, and only the public gateway profile in `config/`.
- The engine remains loopback-only and must fail closed outside its allowlist.
- Frontends may attach to a verified shared engine but may stop only an engine
  they own.
- Never claim a listener is connected without a bounded campus data-path probe.
- Keep credentials out of arguments, logs, fixtures, and repository files.
- Keep private campus CIDRs, DNS addresses, and internal hostnames in the
  ignored local policy, never in source, tests, issues, or documentation.

By contributing, you agree that your contribution is licensed under
GPL-3.0-only.
