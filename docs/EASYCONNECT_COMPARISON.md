# HKUST(GZ) Connect and EasyConnect

HKUST(GZ) Connect is not a drop-in reimplementation of every EasyConnect
feature. It is a focused, open-source client for the currently reviewed
HKUST(GZ) username/password and campus-access path. Its main product difference
is network ownership: the default endpoint is an application-scoped loopback
SOCKS proxy rather than a second system-wide networking layer.

The comparison below refers to the reviewed EasyConnect 7.6.7 macOS package
and the current gateway profile. The vendor client and gateway can expose more
features at other institutions or after an upgrade.

| Area | EasyConnect reference client | HKUST(GZ) Connect | Practical consequence |
| --- | --- | --- | --- |
| Primary purpose | General Sangfor SSL VPN client with institution-selected features | Focused HKUST(GZ) campus-access client | Smaller supported scope and simpler daily workflow |
| Network ownership | Reviewed package includes system-tunnel, DNS, monitoring, and integration components; active behavior is profile-dependent | Loopback-only SOCKS by default; PAC and proxy-rule exports are explicit | Lower collision surface with a primary proxy or overlay, but applications must opt into the campus path |
| Coexistence controls | System integration is managed inside the vendor client and institution profile | Generated campus-only Shadowrocket module, Mihomo merge snippet, PAC, native SOCKS, and Tailscale guidance | Existing proxy or overlay can remain the general policy owner; overlapping TUN routes can still conflict |
| Privilege footprint | Reviewed package contains privileged/system networking components | Core engine, SSH helper, and optional Shadowrocket relay run in the user session | No admin requirement for normal runtime; default system-tunnel use cases are intentionally absent |
| Routing scope | An active L3 policy may install system routes | Reviewed campus domains plus user-supplied, authorized private CIDRs | Non-campus traffic stays on its prior route unless an external tool captures it |
| DNS | L3 integration can manage VPN DNS | The engine uses VPN-side DNS for proxied names when supplied; system DNS is unchanged by default | Fewer MagicDNS/global resolver conflicts; internal names must reach the engine unresolved through SOCKS5 hostname resolution, compatible PAC proxying, or the HPC helper |
| Browser access | Resource and browser integration is present in the reviewed package | Reviewed Quick Access links open in the default browser; PAC/proxy setup is separate | Minimal UI, but opening a link alone does not create an off-campus route |
| SSH/HPC | Ordinary SSH follows the installed L3 route when the institution profile enables it | Managed direct-on-campus/SOCKS-off-campus HPC helper and explicit `ProxyCommand` support | Predictable per-host routing without changing all SSH traffic |
| TCP application traffic | System-routed TCP under the active L3 policy | Repeated campus TCP-through-SOCKS coverage | Good fit for Web, SSH, and TCP tools that support PAC/SOCKS |
| UDP application traffic | Official client advertises TCP and UDP application access | Engine has bounded SOCKS UDP support, but live campus service coverage is incomplete; exported proxy integrations reject campus UDP | Not yet equivalent for UDP-dependent applications |
| Authentication | Package exposes password plus optional CAPTCHA, SMS/token, certificate, HID, SSO, QR, and other flows | Username/password production path; other auth states are recognized but not interactively implemented | Use the official client when the gateway requires an unsupported challenge |
| Resource catalogue | Groups and multiple resource/application types | Reviewed links plus manual application configuration | Deliberately narrower; no full institution resource portal yet |
| CLI and automation | No equivalent supported end-user shared-engine CLI was established in this review | First-class CLI, LaunchAgent option, active health probes, and shared-engine attachment | Works for scripts and headless workflows; one session can serve both project interfaces |
| Diagnostics | Vendor environment and service checks | Active SOCKS campus probe, relay/path checks, private-route visibility, and sanitized logs | Results distinguish listener, campus path, and separate system/TUN and explicit primary SOCKS HTTPS reachability; HTTPS response is not proof of a persistent stream |
| Source and auditability | Proprietary distribution | Public source with documented inherited provenance and license boundaries | Behavior and release contents can be independently reviewed |
| Update compatibility | Maintained by the vendor for supported gateways | Community maintenance against a proprietary protocol | Gateway or authentication changes may require a project update |

## Where HKUST(GZ) Connect is stronger

- **Coexistence by default:** it does not claim the default route or system DNS,
  so Shadowrocket, Clash/Mihomo, Tailscale, and ordinary on-campus routing can
  retain their existing roles.
- **Explicit policy boundaries:** campus destinations are visible in generated
  PAC, module, or profile output. Private CIDRs remain in the user's local
  owner-only policy rather than the public repository.
- **Multiple frontends, one engine:** the macOS app and CLI attach only after an
  active campus-path probe and do not terminate a process they do not own.
- **Minimal desktop surface:** campus links use the default browser; specialized
  applications receive auditable SOCKS, PAC, or SSH configuration instead of
  an embedded browser or opaque global interception.

“Stronger” here means easier coexistence and inspection for the supported
workflow. It does not mean broader protocol, authentication, UDP, or resource
coverage than the official client.

Locally exported private TUN routes and the opt-in Shadowrocket Realtime/DNS
repair preset can still change third-party route or DNS behavior. The current
engine destination layer is IPv4-focused, live UDP parity is incomplete, and
Quick Access does not configure the default browser's route merely by opening a
link.

## When to use EasyConnect instead

Use the institution-supported EasyConnect client when the gateway requires an
interactive authentication method HKUST(GZ) Connect does not implement, when a
resource depends on unverified UDP or proprietary application/remote-desktop
features, when campus support requires the official client, or when a gateway
upgrade has not yet passed this project's compatibility checks.

For the supported username/password and TCP campus workflow, choose the client
whose ownership model matches the computer: EasyConnect for a vendor-managed
system VPN, or HKUST(GZ) Connect when a scoped campus path must coexist with
other network services.

See [Network coexistence](NETWORK_COEXISTENCE.md) for setup instructions and
[feature parity](../engine/spec/FEATURE_PARITY.md) for the maintainer-level
protocol inventory.
