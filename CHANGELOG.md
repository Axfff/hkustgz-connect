# Changelog

## 1.1.0 - 2026-08-22

- Consolidated the Rust engine, macOS CLI, Electron menu-bar app, configuration,
  documentation, tests, and release scripts into one repository.
- Added shared-engine discovery so CLI and UI can coexist on the same SOCKS5
  listener without duplicate gateway sessions.
- Made shutdown ownership-aware: an attached interface never kills an engine
  started elsewhere.
- Added active data-path verification for shared-engine attachment and status.
- Added a shared owner-only local policy for private CIDRs and VPN DNS, with
  matching engine and PAC routing in both interfaces.
- Removed private campus network topology from the public profile, source,
  tests, documentation, and release artifacts.
- Removed local identities, compiled artifacts, live baselines, recovery data,
  one-off host routes, and official university artwork from the public tree.
- Added CI, reproducible release packaging, contribution guidance, security
  policy, public-tree audit, and optimized user documentation.
