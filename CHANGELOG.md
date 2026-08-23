# Changelog

## 1.1.8 - 2026-08-23

- Added Shadowrocket `tun-included-routes` for locally configured private CIDRs,
  preventing more-specific Wi-Fi routes from bypassing campus rules.
- Extended the CLI-installed campus relay handshake deadline to cover
  tunnel-side DNS and TCP setup instead of rejecting valid internal hostnames
  after 750 milliseconds.
- Added private-route diagnostics and module-generation regression coverage.

## 1.1.7 - 2026-08-23

- Constrained the desktop grid and flex layout so the content pane scrolls at
  compact window sizes while the header and sidebar remain fixed.
- Preserved an independent scroll position for each application page.
- Added renderer regression coverage for the window scrolling contract.

## 1.1.6 - 2026-08-23

- Added an optional ChatGPT/Codex HTTPS-WebSocket route check to desktop
  diagnostics and a matching `doctor-public` CLI command.
- Added a generated Shadowrocket module that keeps OpenAI realtime traffic on
  the normal proxy, covers the current OpenAI desktop/authentication dependency
  list, uses proxied encrypted DNS, disables the failing IPv6 fallback, and
  routes only approved campus destinations to `HKUSTGZ`.
- Hardened `ec-fallback` so non-campus destinations use Shadowrocket's general
  SOCKS upstream instead of the campus engine or direct public DNS.
- Added CLI-managed installation for the hardened Shadowrocket relay and kept
  private campus CIDRs confined to the locally generated module.

## 1.1.5 - 2026-08-23

- Coalesced concurrent startup credential reads into one asynchronous macOS
  Keychain request and retained the result only for the app process lifetime.
- Prevented a canceled Keychain request from immediately prompting again in
  the same app session.
- Avoided reading Keychain merely to render the UI, including when auto-connect
  is disabled or a CLI-owned engine can be reused.

## 1.1.4 - 2026-08-22

- Disabled electron-builder's implicit tag publishing so release artifacts are
  published only after the repository's package and legal-material audits.

## 1.1.3 - 2026-08-22

- Made release builds prepare the pinned Electron distribution before staging
  its Electron and Chromium notices, including on clean CI installs.

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
