# Tunnel Setup (Fresh)

This directory contains the origin-HTTPS tunnel stack:

- `caddy` terminates HTTPS locally with Let's Encrypt (DNS-01 via Cloudflare).
- `cloudflared` runs a locally-managed named tunnel and forwards traffic to Caddy.

Runtime traffic path:

`Cloudflare Edge -> cloudflared -> https://caddy:443 -> server:3111`

## Before you start (new account / fresh machine)

1. You need a domain in Cloudflare DNS (for example `example.com`).
2. Pick the public app hostname you will use (for example `home.example.com`).
3. Create a Cloudflare API token for Caddy DNS-01 with:
   - Zone -> DNS -> Edit
   - Zone -> Zone -> Read
   - Scope limited to only the zone you need
4. Docker must be installed and running.

## Files in this directory

- `Caddyfile` - Caddy origin HTTPS + reverse proxy config.
- `cloudflared/config.template.yml` - Template rendered at container start using env vars.
- `cloudflared/Dockerfile` - Minimal image with `cloudflared` + shell/sed for template rendering.
- `caddy/Dockerfile` - Caddy build with Cloudflare DNS plugin.
- `cert.pem` - Cloudflare origin cert for tunnel management commands (secret, gitignored).
- `cloudflared/credentials.json` - Named tunnel credentials file (secret, gitignored).

## 1) Configure `.env`

Add/update these values in project root `.env`:

```env
TUNNEL_HOSTNAME=home.example.com
TUNNEL_ID=<tunnel-uuid>
TUNNEL_CREDENTIALS_FILE=./infra/tunnel/cloudflared/credentials.json
CF_DNS_API_TOKEN=<cloudflare-dns-edit-token>
```

Notes:

- `CF_DNS_API_TOKEN` should be least-privilege (Zone DNS edit only for your zone).
- `TUNNEL_CREDENTIALS_FILE` must match where you place the tunnel credentials JSON.

## 2) Authorize `cloudflared` (one-time)

From repository root, run:

```bash
PROJECT_ROOT="$(pwd)"
```

Then:

```bash
docker run --rm -v "${PROJECT_ROOT}/infra/tunnel:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel login
```

Open the URL it prints and approve access. This writes `infra/tunnel/cert.pem`.

## 3) Create a named tunnel (one-time)

Pick a tunnel name (example: `minhome`), then run:

```bash
TUNNEL_NAME="minhome"
docker run --rm --user 0:0 -v "${PROJECT_ROOT}/infra/tunnel:/etc/cloudflared" cloudflare/cloudflared:latest tunnel --origincert /etc/cloudflared/cert.pem create "${TUNNEL_NAME}"
```

This creates a credentials JSON like:

`infra/tunnel/<tunnel-id>.json`

Copy it to the runtime path used by compose:

```bash
docker run --rm --user 0:0 -v "${PROJECT_ROOT}/infra/tunnel:/work" alpine:3.20 sh -c 'cp /work/<tunnel-id>.json /work/cloudflared/credentials.json && chmod 600 /work/cloudflared/credentials.json'
```

Set `TUNNEL_ID=<tunnel-id>` in `.env`.

Tip: the command output includes the exact tunnel ID (UUID). Use that value directly.

## 4) Route hostname to tunnel (one-time or when hostname changes)

Run (set `TUNNEL_NAME` again if you opened a new shell):

```bash
docker run --rm --user 0:0 -v "${PROJECT_ROOT}/infra/tunnel:/etc/cloudflared" cloudflare/cloudflared:latest tunnel --origincert /etc/cloudflared/cert.pem route dns "${TUNNEL_NAME}" "${TUNNEL_HOSTNAME}"
```

## 5) Start and verify

Start stack:

```bash
make up-tunnel BUILD=1
```

Tail logs:

```bash
make logs-tunnel
```

Healthy signs:

- Caddy: `certificate obtained successfully` for `TUNNEL_HOSTNAME`.
- Cloudflared: multiple `Registered tunnel connection` lines and no restart loop.

## Rotation / recovery

- Rotate tunnel credentials: create a new tunnel or delete/recreate and update `TUNNEL_ID` + credentials JSON.
- Rotate ACME DNS token: update `CF_DNS_API_TOKEN` and restart tunnel stack.
- If tunnel was deleted in Cloudflare, recreate tunnel and rerun steps 3-5.
