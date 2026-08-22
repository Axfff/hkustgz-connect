# Changelog

## 1.1.2 - 2026-08-22

- Installed `ripgrep` explicitly in the macOS release job so the mandatory
  public-tree and license-boundary audit runs before packaging.

## 1.1.1 - 2026-08-22

- Corrected public provenance for `heeh02/HKUST-GZ-Connect` and
  `Mythologyli/zju-connect` instead of describing the engine as an unrelated
  independent implementation.
- Documented the distribution as a GPLv3/AGPLv3 combined work while preserving
  GPL-3.0-only on inherited interface material.
- Added the complete GPL and AGPL texts, the required GeiserX/Tailscale
  BSD-3-Clause notice, and a source-provenance record.
- Made desktop and CLI release packaging include and verify legal materials,
  including Electron and Chromium notices.

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
