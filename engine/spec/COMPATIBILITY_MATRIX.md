# Compatibility matrix

This matrix prevents detection work from being mistaken for a finished VPN
engine.

| Capability | Production observation | Offline fixture | Project engine | Official-client parity |
|---|---:|---:|---:|---:|
| Public discovery | yes | yes | observer only | not applicable |
| Package/version metadata | yes | yes | observer only | not applicable |
| Windows module policy | yes | yes | observer only | not applicable |
| Installer content identity | yes | hash check | observer only | not applicable |
| Username/password auth | live success | yes | probe only | one approved run |
| CAPTCHA | observed disabled | auth-state fixture | state classified; interaction pending | pending enabled profile |
| SMS/TOTP/certificate/HID/SSO | official package + capability discovery | auth-state fixtures | states classified; providers pending | pending enabled profiles |
| Password expiry/change | official package capability | pending | control contract planned | pending enabled profile |
| Session configuration parsing | live accepted | yes | Rust parser core | live parser pass |
| Resource-list parsing | live accepted | yes | Rust parser core | live parser pass |
| Resource catalogue UI | official resource page | parser fixture | provider/UI pending | pending |
| Legacy tunnel wire exchange | live 82/122/43/76/40 exchange | yes | Rust state machine | server magic/reset confirmed |
| Legacy command/data acceptance | server reset observed | command-open fixture | bounded probe only | rejected on this profile |
| Modern TLS send/receive tunnels | live empty channels accepted | synthetic codec/crypto vectors | isolated Rust transport | empty send/receive parity passed |
| Modern tunnel authentication | live 48/64-byte contract accepted | yes | memory-only Rust token/control codec | address control accepted |
| Modern IPv4 framing | live Rust data path | fragmented/coalesced fixtures | bounded Rust codec | live TCP packets passed |
| Legacy IPCP framing | static official map | yes | bounded diagnostic codec | not used by active profile |
| TCP via SOCKS5 | approved campus HTTPS 200 | parser and netstack tests | modular Rust runtime | repeated browser/curl pass |
| UDP via SOCKS5 | current target returned no response | header/DNS/fragment/lifecycle fixtures | UDP ASSOCIATE relay; close remains healthy | reachable live UDP service pending |
| Default-browser Quick Access | official external-browser flow | campus URL allowlist fixtures | OS browser launch; routing remains user-managed | reviewed links launch successfully |
| Domain-selective PAC | campus page loaded through PAC | exact/suffix/no-DNS fixtures | advanced integration endpoint | isolated Chrome pass |
| Application-scoped network ownership | default route and system DNS unchanged | settings and package assertions | loopback SOCKS/PAC default | not an official-client parity goal |
| Shadowrocket campus-only export | local relay and module route exercised | minimal-policy, private-CIDR and UDP-reject fixtures | desktop + CLI generator; user-level relay | not applicable |
| Shadowrocket Realtime/DNS repair | separate system/TUN and explicit primary SOCKS HTTPS reachability evidence required; persistent-app canary pending | repair-preset and guide fixtures | opt-in DNS/IPv6/OpenAI policy; never default | not applicable |
| Clash/Mihomo export | manual live profile canary pending | ordered process/gateway direct, UDP reject and campus-route fixtures | merge snippet; subscription and `MATCH` remain user-owned | not applicable |
| Tailscale coexistence | no automatic configuration mutation | documentation and diagnostic-label assertions | route capture is reported; MagicDNS/routes/exit node untouched | not applicable |
| VPN-side DNS | no DNS server in current profile | DNS codec fixtures | used when supplied | not applicable to current profile |
| Explicit system DNS fallback | enabled by reviewed current profile | domain validation fixtures | modular Rust resolver | live domain CONNECT passed |
| Logout | live HTTP 200 | state test | Rust probe | live pass |
| Reset/reconnect | live server reset | state test | bounded reset retry | reset path confirmed |
| Timeout/data-plane recovery | process-level restart contract | bounded timeout tests pending | unhealthy engine exits | sleep/resume canary pending |
| Passive logout / forced upgrade | official package capability | pending | text error only; structured event pending | pending |

The coexistence rows verify ownership boundaries and generated configuration,
not universal compatibility. A live matrix still needs representative
Shadowrocket/Mihomo TUN modes, Tailscale exit-node and subnet-route cases, and
non-overlapping as well as overlapping private CIDRs before those combinations
can be promoted beyond documented, user-managed integration.

The public-path checks accept any HTTP response to a WebSocket-shaped HTTPS
request. They establish path reachability only, not a successful protocol
upgrade, sustained WebSocket frames, or application streaming.

Use `yes` only for evidence that can be reproduced. A production feature is
supported only when the project-engine and official-client-parity columns
both pass for the gateway profile in scope.
