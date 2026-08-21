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

Literal private IPs from the local policy may need Shadowrocket TUN exclusions or higher-priority
rules so they reach the local campus node rather than the system's direct
route. Keep the campus rules above broad `DIRECT`, proxy-group, and fake-IP
rules.

The relay is optional and independently managed. Its example LaunchAgent is
in `cli/com.hkustgz.connect-fallback.plist.example` and must be updated with
the installed binary path before loading.

## Application configuration

Applications with native SOCKS support should use SOCKS5 hostname resolution
(`socks5h`) at `127.0.0.1:1080`. Applications with PAC support can use the file
printed by `./cli/hkustgzconnect pac`.

Never expose either local proxy port on a non-loopback address.
