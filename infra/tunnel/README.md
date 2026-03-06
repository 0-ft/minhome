# Tunnel Setup (Fresh)

This directory contains the origin-HTTPS tunnel stack:

- `caddy` terminates HTTPS locally with Let's Encrypt (DNS-01 via Cloudflare).
- `cloudflared` runs a locally-managed named tunnel and forwards traffic to Caddy.

Runtime traffic path:

`Cloudflare Edge -> cloudflared -> https://caddy:443 -> server:3111`

## Quick start

Run the interactive setup script from the repository root:

```bash
make tunnel-setup
```

This handles everything: cloudflared login, tunnel creation, DNS routing, and
`.env` updates.  The only requirement is that `docker` is installed and running.

After setup completes:

```bash
make up-tunnel BUILD=1       # production
make up-dev-tunnel BUILD=1   # development (Vite HMR over wss)
```

---

## Before you start (prerequisites)

1. A domain in Cloudflare DNS (e.g. `example.com`).
2. The public hostname you want to expose (e.g. `home.example.com`).
3. A Cloudflare API token with **Zone → DNS → Edit** permission, scoped to
   your zone — the script will prompt for this.
4. Docker installed and running on the host.

## Files in this directory

| Path | Description |
|------|-------------|
| `Caddyfile` | Caddy origin HTTPS + reverse proxy config |
| `cloudflared/config.template.yml` | Template rendered at container start via env vars |
| `cloudflared/Dockerfile` | Minimal image with `cloudflared` + shell/sed |
| `caddy/Dockerfile` | Caddy build with Cloudflare DNS plugin |
| `setup.sh` | Interactive one-time provisioning script |

Secrets (auto-created by `setup.sh`, never committed):

| Path | Description |
|------|-------------|
| `data/tunnel/cert.pem` | Cloudflare origin cert for tunnel management |
| `data/tunnel/credentials.json` | Named tunnel credentials |

## Manual steps (if you prefer not to use the script)

<details>
<summary>Click to expand</summary>

### 1) Configure `.env`

Add/update these values in project root `.env`:

```env
TUNNEL_HOSTNAME=home.example.com
TUNNEL_ID=<tunnel-uuid>
CF_DNS_API_TOKEN=<cloudflare-dns-edit-token>
```

### 2) Authorize `cloudflared`

From the repository root:

```bash
docker run --rm \
  -v "$(pwd)/data/tunnel:/home/nonroot/.cloudflared" \
  cloudflare/cloudflared:latest tunnel login
```

Open the URL printed and approve in your browser. This writes `data/tunnel/cert.pem`.

### 3) Create a named tunnel

```bash
TUNNEL_NAME="minhome"
docker run --rm --user 0:0 \
  -v "$(pwd)/data/tunnel:/etc/cloudflared" \
  cloudflare/cloudflared:latest \
  tunnel --origincert /etc/cloudflared/cert.pem create "${TUNNEL_NAME}"
```

This writes `data/tunnel/<tunnel-id>.json`. Copy it:

```bash
cp data/tunnel/<tunnel-id>.json data/tunnel/credentials.json
chmod 600 data/tunnel/credentials.json
rm data/tunnel/<tunnel-id>.json
```

Set `TUNNEL_ID=<tunnel-id>` in `.env`.

### 4) Route hostname to tunnel

```bash
TUNNEL_ID="<tunnel-id>"
TUNNEL_HOSTNAME="home.example.com"
docker run --rm --user 0:0 \
  -v "$(pwd)/data/tunnel:/etc/cloudflared" \
  cloudflare/cloudflared:latest \
  tunnel --origincert /etc/cloudflared/cert.pem route dns "${TUNNEL_ID}" "${TUNNEL_HOSTNAME}"
```

</details>

## Verification

Tail logs after starting:

```bash
make logs-tunnel
```

Healthy signs:

- **Caddy**: `certificate obtained successfully` for `TUNNEL_HOSTNAME`.
- **Cloudflared**: multiple `Registered tunnel connection` lines, no restart loop.

## Rotation / recovery

- **Rotate tunnel**: create a new tunnel, update `TUNNEL_ID` + `data/tunnel/credentials.json`.
- **Rotate ACME DNS token**: update `CF_DNS_API_TOKEN` in `.env` and restart tunnel stack.
- **Tunnel deleted in Cloudflare**: re-run `make tunnel-setup` (or manual steps 3–4).
