# Traffic and proxying

## Public default policy

The engine binds only `127.0.0.1:1080` and permits these destinations by
default:

- `hkust-gz.edu.cn` and subdomains;
- `hkust.edu.hk` and subdomains;

Private campus CIDRs and VPN DNS addresses are deliberately absent from the
public repository. Obtain them only through an approved campus source. Install
a supplied file with `./cli/hkustgzconnect set-policy FILE`, or enter the same
values in the desktop app under **Settings > Advanced route policy**. Both
interfaces store the policy at `~/.config/hkustgz-connect/policy.json` with
mode 0600.

The accepted local schema is:

```json
{
  "version": 1,
  "vpn_dns_servers": [],
  "route_ipv4_cidrs": []
}
```

The overlay cannot change the gateway, endpoints, public domain allowlist, TLS
behavior, bind address, or credentials.

Other destinations are rejected. The client does not install a global proxy,
replace system DNS, or modify default routes.

## SSH and private IPs

macOS web proxy settings do not affect OpenSSH. A private campus target follows
the normal Wi-Fi route unless SSH receives an explicit SOCKS `ProxyCommand`:

```sshconfig
Host campus-server
    HostName CAMPUS_SERVER_IP
    User YOUR_SERVER_USERNAME
    ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:1080 %h %p
```

Use host-specific blocks. Do not combine this with `ProxyJump` for the same
host unless the jump host design explicitly requires it.

The frequently used HPC login has a managed macOS path in **Access > Application
access > HPC SSH**. It installs an owner-only helper and one marked block
in `~/.ssh/config`, preserving unrelated entries and a one-time backup. Both
`hkustgz-hpc` and `hpc2login.hpc.hkust-gz.edu.cn` then use a bounded direct-first
route: a working on-campus TCP connection is reused as-is, while off-campus
connections pass the hostname unresolved to the campus SOCKS engine. The
helper accepts only the reviewed campus domain suffixes.

## Shadowrocket coexistence

The optional `ec-fallback` process listens on `127.0.0.1:1081`. Shadowrocket
can select that local node for campus domains while remaining the global
policy owner:

- campus traffic goes from 1081 to the shared engine on 1080;
- public campus names may fall back to the direct interface if the engine is
  unavailable;
- private campus IPs and campus DNS fail closed without the engine;
- non-campus destinations go back to Shadowrocket's general SOCKS listener on
  1082, preserving its normal proxy and remote DNS behavior.

The desktop app installs or removes this user-level relay under **Access >
Network compatibility > Shadowrocket**. It ships the matching relay binary and
does not depend on a separately installed CLI. The CLI equivalent is:

```bash
./cli/hkustgzconnect install-fallback
```

Both interfaces serialize relay install, update, rollback, and removal through
the same owner-only interprocess lock. A concurrent operation fails clearly
instead of changing the LaunchAgent or relay binary underneath the other
frontend.

Create a local SOCKS5 node named `HKUSTGZ` for `127.0.0.1:1081`. Keep a normal
Internet-capable node selected as Shadowrocket's default; `HKUSTGZ` is only a
rule target. Generate the module with:

```bash
./cli/hkustgzconnect shadowrocket-module
```

Open **Config > Modules > New Module** in Shadowrocket, paste the generated
file's contents, save it, and enable `HKUST(GZ) Connect`. Disable or delete an
older Campus only or Realtime/DNS repair copy so exactly one HKUST(GZ) Connect
module is enabled. Importing the file as a main configuration does not install
it as a module.

The default campus-only module contains no credentials or private topology
from the repository. It adds locally configured CIDRs only when generated on
the user's machine. It also adds those CIDRs as `tun-included-routes`, ensuring
macOS sends more-specific private routes to Shadowrocket before the campus rule
is applied. It does not replace Shadowrocket's DNS or IPv6 policy.

The relay exports TCP CONNECT only. The module therefore rejects campus UDP
rules before the campus node is selected, rather than allowing unsupported UDP
to leak or fall through to a primary-proxy or direct rule. OpenSSH does not
rely on the system resolver for the managed HPC route: the helper passes an
unresolved off-campus hostname directly to the campus engine for VPN-side DNS.

Regenerate and replace the enabled module after changing the local route policy;
the existing module is static. Keep the campus rules above broad `DIRECT`,
proxy-group, and fake-IP rules.

The separate **Realtime/DNS repair** preset is intentionally more invasive. It
uses proxied DoH, disables system-DNS fallback and IPv6 preference, hijacks port
53, and keeps reviewed ChatGPT/Codex realtime and authentication domains on
Shadowrocket's normal `PROXY` policy. Consider it only after the campus-only
module is confirmed and the affected application's persistent connection still
fails:

```bash
./cli/hkustgzconnect doctor-public
./cli/hkustgzconnect shadowrocket-repair-module
```

Run `./cli/hkustgzconnect doctor-public` to obtain separate system/TUN and
explicit primary SOCKS HTTPS reachability results for `chatgpt.com` and
`ws.chatgpt.com`. A primary SOCKS pass combined with a system/TUN failure is a
differential signal for local DNS, TUN, or IPv6 handling. If both paths fail,
the result does not support enabling repair.

The probe accepts any HTTP status returned to a WebSocket-shaped HTTPS request.
It does not prove a `101` upgrade, continued WebSocket frames, or stable
application streaming. After replacing the campus-only module with the repair
module, keep exactly one HKUST(GZ) Connect module enabled and verify the original
symptom in ChatGPT, Codex, or the affected application. OpenAI requires secure
WebSocket upgrades over TCP 443 for realtime features; see its
[network recommendations](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps).

The Realtime/DNS repair preset can affect other DNS-dependent applications,
including Tailscale MagicDNS. Return to the campus-only module when the measured
public path no longer requires it. The relay remains optional and independently
managed; its example LaunchAgent is in
`cli/com.hkustgz.connect-fallback.plist.example`.

## Clash and Mihomo coexistence

The generated Mihomo snippet connects directly to the engine on
`127.0.0.1:1080`; it does not need `ec-fallback`. It contains:

- a local SOCKS5 node with `udp: false`;
- direct rules for the engine process and campus gateway, preventing loops;
- ordered UDP rejection for campus domains and local private CIDRs;
- campus domain and CIDR rules targeting the local node.

Generate it with `./cli/hkustgzconnect mihomo-profile` or use **Copy snippet**
in the desktop app. Merge the proxy entry into `proxies`, then insert the
generated rules before broad private-network, `GEOIP`, `DIRECT`, or `MATCH`
rules. Do not replace the existing DNS section, providers, groups, or final
policy. Mihomo can continue matching after selecting a proxy that does not
support UDP, so the UDP rejection must remain before the campus TCP routes.

## Tailscale coexistence

HKUST(GZ) Connect does not change MagicDNS, exit-node selection, accepted
subnet routes, or tailnet policy. The application-scoped SOCKS/PAC path leaves
those responsibilities with Tailscale. A conflict is still possible when a
Tailscale subnet route, a Shadowrocket/Mihomo TUN route, and a locally supplied
campus CIDR overlap. Diagnostics reports route capture without guessing which
third-party service should own it; the app does not rewrite another service's
configuration.

## Application configuration

Applications with native SOCKS support should use SOCKS5 hostname resolution
(`socks5h`) at `127.0.0.1:1080`. Applications with PAC support can use the file
printed by `./cli/hkustgzconnect pac`.

Selecting the generated PAC replaces an existing browser-level PAC or explicit
proxy. It does not compose policies automatically; manually merge the rules or
use the primary network client's TUN/system mode when another PAC already owns
the browser.

Never expose either local proxy port on a non-loopback address.

See [Network coexistence](NETWORK_COEXISTENCE.md) for complete Shadowrocket,
Clash/Mihomo, Tailscale, and multi-tool tutorials.
