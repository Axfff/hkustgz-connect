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

## Shadowrocket coexistence

The optional `ec-fallback` process listens on `127.0.0.1:1081`. Shadowrocket
can select that local node for campus domains while remaining the global
policy owner:

- campus traffic goes from 1081 to the shared engine on 1080;
- public campus names may fall back to the direct interface if the engine is
  unavailable;
- private campus IPs and campus DNS fail closed without the engine.
- non-campus destinations go back to Shadowrocket's general SOCKS listener on
  1082, preserving its normal proxy and remote DNS behavior.

Install or update the relay with:

```bash
./cli/hkustgzconnect install-fallback
```

Create a local SOCKS5 node named `HKUSTGZ` for `127.0.0.1:1081`. Keep a normal
Internet-capable node selected as Shadowrocket's default; `HKUSTGZ` is only a
rule target. Generate the module with:

```bash
./cli/hkustgzconnect shadowrocket-module
```

Open **Config > Modules > New Module** in Shadowrocket, paste the generated
file's contents, save it, and enable `HKUST(GZ) Connect`. Importing the file as
a main configuration does not install it as a module.

The generated module contains no credentials or private topology from the
repository. It adds locally configured CIDRs only when generated on the user's
machine. Its DNS settings use proxied DoH, disable system-DNS fallback and
IPv6 address racing, and hijack port 53 so native Node/Electron WebSockets do
not receive poisoned system answers while Chromium HTTPS still appears usable.
It also keeps the documented ChatGPT/Codex WebSocket domains on Shadowrocket's
normal `PROXY` policy.

Literal private IPs from the local policy may need Shadowrocket TUN exclusions or higher-priority
rules so they reach the local campus node rather than the system's direct
route. Keep the campus rules above broad `DIRECT`, proxy-group, and fake-IP
rules.

Run `./cli/hkustgzconnect doctor-public` to compare the system/TUN path with
Shadowrocket's explicit SOCKS path for `chatgpt.com` and `ws.chatgpt.com`.
An explicit-SOCKS pass combined with a system-path failure points to DNS, TUN,
or IPv6 handling rather than an OpenAI service outage. OpenAI requires secure
WebSocket upgrades over TCP 443 for those realtime features; see its
[network recommendations](https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps).

The relay remains optional and independently managed. Its example LaunchAgent
is in `cli/com.hkustgz.connect-fallback.plist.example`; the CLI installer is
preferred because it supplies both campus and general loopback upstreams.

## Application configuration

Applications with native SOCKS support should use SOCKS5 hostname resolution
(`socks5h`) at `127.0.0.1:1080`. Applications with PAC support can use the file
printed by `./cli/hkustgzconnect pac`.

Never expose either local proxy port on a non-loopback address.
