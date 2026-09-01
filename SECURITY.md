# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability") — do **not** open a public issue for security problems.

Include: affected file/version, reproduction steps, and impact. You'll get a response within a few days; fixes land in the next patch release.

## Security model & hardening notes

- **API keys never leave the server.** `config/keys.json` lives server-side only and is gitignored. The browser talks to the same-origin `/api/chat` relay and never sees keys. Never commit or paste `keys.json`.
- **Default bind is `127.0.0.1`** — the server only listens on localhost. Setting `LLMCHESS_HOST=0.0.0.0` (LAN / Docker / cloud) exposes the relay to your network; since the relay holds your keys, only do this on trusted networks.
- **No authentication by default.** Anyone who can reach the port can use the relay (spending your LLM quota). On shared networks prefer a firewall rule or an authenticating reverse proxy; keep the default localhost bind otherwise.
- **Runtime artifacts** (`logs/`, `temp/`, `screenshots/`) may contain game data; they are gitignored and never published by the project.
