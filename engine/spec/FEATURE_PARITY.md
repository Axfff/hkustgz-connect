# EasyConnect feature parity and forward-compatibility plan

This inventory is a behavior-level record for maintainers. It was produced
from the authorized, read-only inspection of:

- EasyConnect for macOS 7.6.7;
- EasyConnect for Linux 7.6.7.3;
- the current gateway's public metadata and redacted compatibility probes.

No vendor source, binary, credential, token, cookie, internal address, or raw
capture belongs in this repository. A feature visible in an official package
is only a capability signal; it does not prove that the HKUST(GZ) gateway has
enabled that feature.

## Product and protocol inventory

| Area | Capability present in official client | HKUST(GZ) Connect status | Maintenance decision |
| --- | --- | --- | --- |
| Primary authentication | Username/password and remembered login | Supported | Keep as the current production path |
| Interactive authentication | Image challenge, SMS passcode, token passcode and security question | Auth states recognized; interactive exchange not implemented | Add through the versioned auth-challenge control API; never encode it in the desktop UI |
| Certificate authentication | Imported certificate, certificate password and USB key | Capability recognized only | Separate credential-provider adapter; require an approved test profile |
| Federated authentication | SSO, QR code and WeChat flows | Capability recognized only | Browser-based auth provider using an isolated session |
| Endpoint authorization | Hardware-ID registration and approval states | Not implemented | Device-identity provider; do not invent or spoof attestations |
| Password lifecycle | Initial/expired password change and password policy display | Not implemented | Structured `password_change_required` challenge |
| Anonymous/Web-only login | Anonymous and security-check-degraded Web access | Not implemented | Separate profile capability, disabled by default |
| Session configuration | L3/TCP configuration and VPN DNS discovery | Supported for the active L3 profile | Preserve strict parser and version adapters |
| Resource catalogue | Groups, Web resources, public/private folders and application resources | Resource-list parser exists; catalogue is not exposed to the desktop | Add a sanitized resource provider and UI; never log raw resource data |
| Campus browsing | Resource page and external browser launch | Reviewed links open in the default browser | Keep the desktop minimal; off-campus browser routing remains an explicit PAC or proxy choice |
| Application access | TCP and UDP application traffic | TCP supported; UDP frontend exists, live service coverage incomplete | Keep UDP canary as a release gate |
| Remote application | Remote-app launch and notices | Not implemented | Separate launcher adapter only if the school enables it |
| Connection lifecycle | Auto login, reconnect, cancellation, timeout and passive kick | Auto-connect/reconnect supported; passive reasons are not structured | Move engine output to versioned structured events |
| User information | Login history, server messages and announcements | Not implemented | Read-only optional providers |
| Client lifecycle | Version mismatch, module update and client update | Public package watcher exists; no end-user updater | Signed update manifest with staged rollout and rollback |
| Diagnostics | Environment checks, service status and logs | Safe local logs and basic telemetry | Add one-click redacted diagnostic bundle |
| Network integration | L3 system tunnel, DNS service control, proxy checks and browser integration | Explicit SOCKS/PAC with no embedded browser; campus-only Shadowrocket and Mihomo exports | Preserve application scope; keep global DNS/route mutation opt-in and reversible |
| Other network services | Reviewed active L3 profile owns the institution VPN path while enabled | Existing primary proxy and Tailscale policy remain untouched by default | Test route overlap; never promise conflict-free operation or rewrite third-party state |
| Multi-server profiles | Server history and server switching | Gateway is fixed by reviewed configuration | Institution-managed profiles may be added without changing protocol modules |
| Accessibility/i18n | Chinese/English UI and ordinary-user resource pages | App and current public guide are English; strings are not yet localized | Move strings to locale files before adding more challenge screens |

## What is deliberately different from EasyConnect

The official package contains privileged DNS, L3, monitoring, environment
check and browser-control components. HKUST(GZ) Connect must not copy that
deployment model merely to claim parity.

The default frontend is application-scoped:

1. the Rust engine obtains an address and runs the userspace network stack;
2. the desktop starts a loopback proxy;
3. Quick Access validates reviewed campus HTTPS links, then asks the operating
   system to open them in the default browser;
4. the operating-system DNS, global proxy and default route remain unchanged;
5. off-campus browser routing is enabled only when the user explicitly applies
   the generated PAC URL or a compatible proxy rule.

For students who already use Shadowrocket or Clash/Mihomo, the project emits
campus-scoped configuration rather than replacing their complete policy. The
default Shadowrocket preset preserves existing DNS and IPv6 settings; a
separate Realtime/DNS repair preset may change those settings only after the
system/TUN HTTPS check fails and the explicit primary SOCKS HTTPS check succeeds.
These checks accept any HTTP response to a WebSocket-shaped request and do not
prove a persistent WebSocket or application stream. Tailscale routes, MagicDNS
and exit-node state are never rewritten. This smaller ownership surface
improves coexistence for the supported workflow, but overlapping TUN routes
remain an operating-system and policy decision.

An optional system-wide mode is acceptable only if it snapshots the exact
pre-connection state, writes changes transactionally, restores them on normal
exit and crash, and verifies restoration on the next launch. It must never be
the default for students who only need Web resources.

## Stable extension contracts

Future gateway features should plug into these contracts:

```text
Desktop
  -> versioned engine control protocol
       -> AuthProvider
          password | captcha | sms | token | certificate | browser_sso | device
       -> SessionProvider
       -> ResourceProvider
          web | tcp | udp | ssh | remote_app
       -> TransportAdapter
          legacy | modern | future-version
       -> Frontend
          external_links | socks | pac | optional_managed_system
```

The control protocol must represent, without UI-specific fields:

- `state_changed`;
- `auth_required` with a challenge ID, method and safe display metadata;
- `auth_response` and `cancel`;
- `resource_catalogue_changed`;
- `session_notice`, `password_change_required`, `upgrade_required`;
- `listener_ready`, `network_unhealthy` and `fatal_error`.

Unknown methods fail closed and remain visible as `unsupported_capability`.
They must never be treated as a bad password.

## Upgrade review checklist

For every official-client or gateway upgrade:

1. verify publisher signature and archive the package in restricted storage;
2. run public metadata and binary-capability watchers;
3. compare this inventory and the compatibility matrix;
4. exercise discovery, every enabled auth step, configuration, resource list,
   tunnel establishment, DNS, TCP, UDP, reconnect, passive logout and logout;
5. create sanitized fixtures for each changed contract;
6. update only the affected provider/adapter;
7. canary on staff devices before the student release.

No design can promise compatibility with every future proprietary protocol
without maintenance. This separation makes that maintenance bounded and
detectable instead of forcing a desktop rewrite.
