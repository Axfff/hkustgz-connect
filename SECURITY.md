# Security policy

## Supported release

Security fixes are applied to the latest release. This project is an
unofficial compatibility client; always retain access to the vendor-supported
client for recovery.

## Report a vulnerability

Do not open a public issue containing credentials, session material, private
keys, internal hostnames, assigned client addresses, raw logs, or packet
captures. Use GitHub's private vulnerability reporting for this repository.

Include the affected version, platform, minimal reproduction, and redacted
impact. Never send a real campus password or session token.

## Data handling

- The engine reads the username and password from standard input, never command
  arguments.
- The CLI stores its password in macOS Keychain and its username/port in an
  owner-only local file.
- The app stores credentials through Electron's OS-backed `safeStorage` and
  keeps its data under the per-user Application Support directory.
- Runtime logs are owner-only and should be reviewed before sharing.
- Private CIDRs and VPN DNS addresses are stored only in the shared owner-only
  local policy and are not included in release artifacts.
- The listener binds to loopback only and enforces the destination allowlist.
- TLS certificate and hostname verification cannot be disabled.

## Scope boundary

The project is for authorized remote access. Reports and contributions must not
add credential extraction, authentication bypass, broad network scanning,
traffic interception, hidden persistence, or access outside the documented
campus policy.
