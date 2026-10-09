# Changelog

## 1.4.1 - 2026-10-09

- Made manual app exit persistent: **Quit**, Activity Monitor **Quit** or
  **Force Quit**, and an app crash prevent the relay from reopening the app
  across network changes, sleep, and relay restarts until a deliberate reopen.
- Recorded app sessions before startup so an abrupt exit remains detectable
  even when a quit handler cannot run. Only a tagged relay-requested campus
  shutdown preserves automatic reopening.
- Stopped the GUI-owned engine when its parent app disappears, preserving
  shared engines started by the CLI or another owner.
- Kept relay-driven app launch disabled by default. Campus-aware lifecycle
  automation requires explicit local opt-in and always honors manual stops.
- Updated an existing app-owned compatibility relay on startup while preserving
  its configuration and whether its service was running or stopped.
- Added optional campus-aware direct routing with physical-interface campus
  validation and documented its setup and verification limits.
- Updated Electron and compatible build dependencies; the existing
  high-severity dependency audit passes.

## 1.4.0 - 2026-08-24

- Added a dedicated **Network compatibility** surface for PAC, Shadowrocket,
  Clash/Mihomo, and Tailscale guidance while keeping the existing network
  service as the primary policy owner.
- Changed the default Shadowrocket export to a campus-only preset that
  preserves existing DNS and IPv6 policy, and moved global changes into a
  separate opt-in **Realtime/DNS repair** preset.
- Bundled user-level setup and removal of the TCP-only Shadowrocket
  compatibility relay in the macOS app, with a configurable primary-proxy SOCKS
  port and no administrator service.
- Added a Clash/Mihomo merge snippet with engine/gateway loop guards and ordered
  campus UDP rejection, without rewriting subscriptions, DNS, proxy groups, or
  the final policy.
- Added private-route visibility diagnostics and practical coexistence
  tutorials for multi-proxy and Tailscale setups, with explicit limits for
  overlapping TUN routes and incomplete live UDP coverage.
- Reported system/TUN and explicit primary SOCKS HTTPS reachability separately
  for both public application hosts, with hard deadlines and without treating
  an HTTP response as proof of a persistent WebSocket or application stream.
- Verified relay readiness by LaunchAgent ownership and a campus SOCKS request,
  serialized app/CLI relay changes with an owner-only interprocess lock, made
  updates transactional, and added renderer DOM/IPC contracts after fixing a
  removed-field startup crash.
- Documented the scoped-routing and compatibility tradeoffs against the
  reviewed EasyConnect client instead of claiming universal conflict-free or
  protocol parity.

## 1.3.0 - 2026-08-23

- Removed the embedded campus browser, its dedicated preload, renderer,
  persistent session, and website credential vault.
- Changed all reviewed campus Quick Access links to open in the operating
  system's default browser.
- Added Unikorn and Online Judge to Quick Access.
- Restricted externally opened resources to credential-free HTTPS URLs under
  reviewed HKUST domain suffixes and added package checks that reject obsolete
  embedded-browser files.

## 1.2.0 - 2026-08-23

- Added a one-action macOS HPC SSH route under **Access > External
  applications**, with reversible managed configuration and a friendly
  `hkustgz-hpc` alias.
- Added a restricted `ec-ssh-route` helper that reuses a bounded direct campus
  connection when available and otherwise sends the unresolved campus hostname
  through the local SOCKS engine.
- Preserved unrelated SSH configuration, created an owner-only one-time backup,
  and automatically updated the managed route when the SOCKS port changes.
- Added direct, SOCKS protocol, configuration lifecycle, symlink-safety, and
  package-content regression coverage.

## 1.1.9 - 2026-08-23

- Fixed CLI Shadowrocket module generation for CIDRs emitted with JSON-escaped
  slashes by macOS `plutil`.
- Added a macOS CLI integration test covering generated `/32` and `/24` route
  rules.

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

- Added an optional ChatGPT/Codex WebSocket-shaped HTTPS reachability check to
  desktop diagnostics and a matching `doctor-public` CLI command.
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
