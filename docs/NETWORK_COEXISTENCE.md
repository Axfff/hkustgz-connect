# Network coexistence

HKUST(GZ) Connect is designed to add a campus-only path without becoming the
computer's global network owner. Its engine listens on loopback and does not
replace the default route, system DNS, or system proxy by default. That smaller
scope generally coexists better with a primary proxy, Tailscale, and ordinary
on-campus networking than a second system-wide tunnel.

This is a lower-collision design, not a promise of conflict-free operation.
Shadowrocket and Clash/Mihomo TUN modes, Tailscale subnet routes or exit nodes,
and locally added campus CIDRs can still compete for the same destination.
Keep one tool in charge of general Internet policy and give HKUST(GZ) Connect
only the reviewed campus destinations.

## Choose an integration

| Need | Recommended path | Global policy owner | Important limit |
| --- | --- | --- | --- |
| Campus websites in one browser | Generated PAC | Browser/system PAC configuration | Replaces, rather than composes with, another browser-level PAC |
| SSH or a SOCKS-aware tool | Native SOCKS5 at `127.0.0.1:1080` | The application | Use remote hostname resolution |
| Shadowrocket already controls Internet access | Campus-only module plus the compatibility relay | Shadowrocket | Exported campus route is TCP-only |
| Clash/Mihomo already controls Internet access | Generated merge snippet | Clash/Mihomo | Merge manually; rule order matters |
| Tailscale is also active | Direct application SOCKS/PAC when possible | Tailscale retains tailnet ownership | Overlapping subnet routes still require review |

Start HKUST(GZ) Connect before testing an integration. A listener alone is not
proof of connectivity; use **Diagnostics** in the app or
`./cli/hkustgzconnect test` to verify the campus data path.

## Browser, PAC, and native SOCKS

The least invasive options are application-scoped:

1. In the app, open **Access > Network compatibility**.
2. For a PAC-aware browser, select **Copy PAC** and apply the copied file URL in
   that browser or its supported proxy setting.
3. For a SOCKS-aware application, use `127.0.0.1:1080` and select SOCKS5
   hostname resolution, commonly written as `socks5h`.
4. Confirm one campus resource and one ordinary Internet site. The campus
   resource should use the local engine; the ordinary site stays outside this
   app and follows whatever lower-layer route remains.

The CLI equivalent is:

```bash
./cli/hkustgzconnect pac
```

Selecting this PAC replaces an existing browser-level PAC or explicit proxy; it
does not merge the two policies. If a primary proxy exists only in that browser,
manually compose its PAC rules or use the primary client's system/TUN mode
instead. PAC does not affect OpenSSH and is not honored by every Electron or
command-line application. Use the managed HPC SSH route or a host-specific
`ProxyCommand` for SSH. Never expose either local SOCKS port on a non-loopback
address.

## Shadowrocket

Shadowrocket remains the owner of normal Internet routing. HKUST(GZ) Connect
adds a local node used only by campus rules:

```text
campus TCP -> Shadowrocket rule -> 127.0.0.1:1081 relay -> 127.0.0.1:1080 engine
other traffic -> existing Shadowrocket policy
```

### Set up the campus-only preset

1. In HKUST(GZ) Connect, open **Settings > Network endpoint** and confirm the
   **Primary proxy SOCKS port**. Shadowrocket commonly uses `1082`; use the
   actual local SOCKS port from your configuration.
2. Open **Access > Network compatibility > Shadowrocket** and select
   **Prepare**. This installs a user-level relay and LaunchAgent; it does not
   require a system daemon or change the system proxy.
3. In Shadowrocket, create a local SOCKS5 node named `HKUSTGZ` with server
   `127.0.0.1` and port `1081`.
4. Leave your normal Internet-capable node or policy group as the default.
   `HKUSTGZ` is a campus rule target, not the global node.
5. Keep **Campus only** selected in HKUST(GZ) Connect, use the copy button, then
   create or replace the `HKUST(GZ) Connect` Shadowrocket module and paste the
   copied text. Disable or delete any older Campus only or Realtime/DNS repair
   copy so exactly one HKUST(GZ) Connect module is enabled, then reconnect
   Shadowrocket.
6. Run HKUST(GZ) Connect diagnostics and test one ordinary Internet site.

The campus-only preset preserves Shadowrocket's existing DNS and IPv6 policy.
It sends the campus gateway itself direct to avoid a tunnel loop, routes the
reviewed campus domains and locally configured CIDRs to `HKUSTGZ`, and rejects
campus UDP before the TCP-only relay can be selected. When local private CIDRs
exist, it also emits explicit `tun-included-routes`; regenerate the module after
changing those CIDRs.

CLI users can perform the same setup with:

```bash
./cli/hkustgzconnect install-fallback
./cli/hkustgzconnect shadowrocket-module
```

The second command prints the generated module path. To remove the CLI-managed
relay, run `./cli/hkustgzconnect uninstall-fallback`.

The CLI resolves the primary SOCKS port from `HKUSTGZ_PRIMARY_PROXY_PORT`, an
already installed relay, the desktop setting, and finally `1082`, in that
order. It prints the selected endpoint and source before installation or public
path diagnostics. Use an explicit one-command override when required:

```bash
HKUSTGZ_PRIMARY_PROXY_PORT=PORT ./cli/hkustgzconnect install-fallback
```

### Use Realtime/DNS repair only when needed

Select **Realtime/DNS repair** only after the campus-only preset is confirmed
and a public application such as ChatGPT or Codex repeatedly loses its
persistent connection while ordinary HTTPS still appears usable. First run
Diagnostics or `doctor-public`. The system/TUN HTTPS check and explicit primary
SOCKS HTTPS check are separate results. Consider repair only when the former
fails and the latter succeeds; if both fail, repair is not supported by that
differential result.

| System/TUN HTTPS | Explicit primary SOCKS HTTPS | Interpretation |
| --- | --- | --- |
| Pass | Pass | Both paths are reachable; neither result proves the affected app can sustain its connection |
| Fail | Pass | Differential supports considering Realtime/DNS repair |
| Pass | Fail | Review the primary SOCKS port or primary proxy; repair is not indicated |
| Fail | Fail | Check the primary proxy, DNS, and service reachability before changing the module |

Each path check probes both `chatgpt.com` and `ws.chatgpt.com` with
WebSocket-shaped HTTPS requests and accepts any HTTP response as reachability
evidence. Both hosts must answer for that path to pass. This does not prove a
`101` upgrade, continued WebSocket frames, or a stable application stream.
After installing the repair preset, verify the original failure inside the
affected application.

This preset deliberately changes more of Shadowrocket's global behavior: it
disables IPv6 preference, uses proxied encrypted DNS, hijacks port 53, and pins
reviewed OpenAI realtime and authentication domains to the primary `PROXY`
policy.

The selector changes only the text copied from this app; it cannot disable a
module already enabled in Shadowrocket. Replace the campus-only module with the
Realtime/DNS repair text and keep exactly one HKUST(GZ) Connect module enabled.

Those changes can affect other DNS-dependent software, including Tailscale
MagicDNS. Test tailnet names and ordinary sites after enabling it. Return to
**Campus only** if the repair does not address the measured failure. The CLI
equivalents are:

```bash
./cli/hkustgzconnect doctor-public
./cli/hkustgzconnect shadowrocket-repair-module
```

If **Prepare** cannot identify a physical `enN` interface while a TUN is active,
briefly disable that primary TUN, prepare the relay, and then enable it again.
The relay records the physical interface so the campus gateway connection does
not loop back through the primary tunnel.

## Clash / Mihomo

HKUST(GZ) Connect generates a merge snippet rather than rewriting a subscription
or complete profile. This preserves the user's proxy providers, DNS mode,
groups, scripting, and final `MATCH` policy.

1. Open **Access > Network compatibility > Clash / Mihomo** and select
   **Copy snippet**. CLI users can run `./cli/hkustgzconnect mihomo-profile`.
2. Merge the generated `HKUSTGZ` SOCKS5 entry into the profile's `proxies` list.
3. Insert the generated rules before broad private-network, `GEOIP`, `DIRECT`,
   or `MATCH` rules. Preserve the order within the generated block.
4. Keep the profile's existing DNS section, proxy groups, providers, and final
   policy unchanged.
5. Reload the profile and test the campus path, the primary proxy, and any
   existing overlay routes.

The generated block sends the engine process and campus gateway direct, rejects
campus UDP first, and then applies campus domain and CIDR routes. The node has
`udp: false`; the reject rules are intentional because Mihomo can continue
matching later rules when a selected proxy does not support UDP. This prevents
campus UDP from silently falling through to a broad direct or primary-proxy
rule.

The snippet targets current Mihomo rule syntax. A Clash-compatible client that
does not support `AND` and `NETWORK` rules needs an equivalent ordered UDP
rejection written in that client's supported syntax; do not delete the guard
without understanding the resulting route.

## Tailscale

HKUST(GZ) Connect does not edit Tailscale preferences, MagicDNS, exit-node
selection, accepted routes, or tailnet ACLs. Direct SOCKS/PAC integration is
therefore the preferred combination: Tailscale continues to own tailnet
destinations while individual applications explicitly select the campus path.

Review these cases before enabling multiple TUN-based tools:

- A Tailscale subnet route and a locally configured campus CIDR overlap. The
  operating system or primary TUN may capture the route before the intended
  tool sees it.
- A Tailscale exit node carries the outer campus-gateway connection. This may
  work, fail, or violate the intended network boundary depending on the exit
  path; HKUST(GZ) Connect does not override it automatically.
- Shadowrocket or Clash/Mihomo TUN mode captures tailnet ranges or DNS. A
  `DIRECT` rule bypasses that proxy's campus node, but macOS may still select a
  Tailscale route. Treat `DIRECT` as “do not use the campus proxy,” not “ignore
  every other VPN.”
- The Shadowrocket Realtime/DNS repair preset intercepts DNS and can change
  MagicDNS results. The campus-only preset does not add that global DNS policy.

Before and after changing the setup, check `tailscale status`, test a known
tailnet hostname or `tailscale ping`, run HKUST(GZ) Connect diagnostics, and
open one ordinary Internet destination. If only a private CIDR fails, inspect
route ownership rather than changing global DNS.

## A practical multi-tool setup

For Shadowrocket, Tailscale, and HKUST(GZ) Connect together:

1. Let Shadowrocket keep the primary Internet policy and Tailscale keep tailnet
   routes and MagicDNS.
2. Use the Shadowrocket **Campus only** module for campus domains. Add only the
   private campus CIDRs you are authorized to use.
3. Keep tailnet ranges out of the campus CIDR policy. If address spaces truly
   overlap, no generic rule can infer intent; use narrower routes or an
   application-specific SOCKS/SSH configuration.
4. Consider **Realtime/DNS repair** only after the system/TUN HTTPS check fails
   and the separate explicit primary SOCKS HTTPS check succeeds.
5. Verify the affected application's persistent connection, then retest campus,
   tailnet, and public destinations after every module or route change.

## Troubleshooting order

1. Verify the HKUST(GZ) Connect campus data path, not just `127.0.0.1:1080`.
2. Verify the primary proxy independently with a non-campus site.
3. Confirm the generated rules are above broad rules and the gateway/process
   direct guards remain present.
4. Check whether the failure is TCP, UDP, DNS, or an overlapping IP route.
5. Disable only the most recently added integration and retest; do not erase
   unrelated proxy, Tailscale, or DNS configuration.

## References

- [Mihomo SOCKS5 proxy configuration](https://wiki.metacubex.one/en/config/proxies/socks/)
- [Mihomo rule configuration](https://wiki.metacubex.one/en/config/rules/)
- [Mihomo DNS processing](https://wiki.metacubex.one/en/config/dns/diagram/)
- [Tailscale with other VPNs](https://tailscale.com/docs/reference/faq/other-vpns)
- [Tailscale userspace networking](https://tailscale.com/docs/concepts/userspace-networking)
- [Tailscale interoperability](https://tailscale.com/docs/reference/interoperability)
- [Tailscale route injection](https://tailscale.com/docs/reference/route-injection)
- [Tailscale MagicDNS](https://tailscale.com/docs/features/magicdns)
- [Shadowrocket configuration reference (community-maintained)](https://github.com/LOWERTOP/Shadowrocket/wiki)
