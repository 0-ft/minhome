#!/usr/bin/env bash
# Cloudflare Tunnel + origin-TLS one-time setup script.
# Run from the repository root via:  make tunnel-setup
# Requires: docker
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${REPO_ROOT}/data/tunnel"
ENV_FILE="${REPO_ROOT}/.env"

# ─── helpers ──────────────────────────────────────────────────────────────────

info()  { echo "  $*"; }
ok()    { echo "✓ $*"; }
ask()   { printf "  %s: " "$1"; read -r "$2"; }

env_get() {
  # Read a value from .env, return empty string if not present
  grep -E "^${1}=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

env_set() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    # Replace existing line
    sed -i "s|^${key}=.*|${key}=${val}|" "${ENV_FILE}"
  else
    echo "${key}=${val}" >> "${ENV_FILE}"
  fi
}

# ─── banner ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   Cloudflare Tunnel + origin HTTPS – first-time setup ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── step 0: gather inputs ────────────────────────────────────────────────────

TUNNEL_HOSTNAME="$(env_get TUNNEL_HOSTNAME)"
CF_DNS_API_TOKEN="$(env_get CF_DNS_API_TOKEN)"

if [[ -z "${TUNNEL_HOSTNAME}" ]]; then
  ask "Public hostname (e.g. minhome.example.com)" TUNNEL_HOSTNAME
fi

if [[ -z "${CF_DNS_API_TOKEN}" ]]; then
  echo ""
  echo "  A Cloudflare API token is needed so Caddy can issue a Let's Encrypt cert"
  echo "  using the DNS-01 challenge.  The token needs Zone:DNS:Edit permission."
  ask "Cloudflare DNS API token" CF_DNS_API_TOKEN
fi

# Persist inputs early so partial runs can be resumed
env_set TUNNEL_HOSTNAME "${TUNNEL_HOSTNAME}"
env_set CF_DNS_API_TOKEN "${CF_DNS_API_TOKEN}"

echo ""
info "Hostname : ${TUNNEL_HOSTNAME}"

# ─── step 1: data directory ───────────────────────────────────────────────────

echo ""
echo "─── [1/4] Preparing data directory ───────────────────"

mkdir -p "${DATA_DIR}"
ok "data/tunnel/ ready"

# ─── step 2: cloudflared login ────────────────────────────────────────────────

echo ""
echo "─── [2/4] Authorizing cloudflared ─────────────────────"

if [[ -f "${DATA_DIR}/cert.pem" ]]; then
  ok "cert.pem already present – skipping login"
else
  echo ""
  echo "  Opening a Cloudflare login URL – approve it in your browser."
  echo "  (The browser tab should open automatically; if not, copy the URL printed below.)"
  echo ""
  docker run --rm \
    -v "${DATA_DIR}:/home/nonroot/.cloudflared" \
    cloudflare/cloudflared:latest \
    tunnel login
  ok "cert.pem written to data/tunnel/"
fi

# ─── step 3: create named tunnel ──────────────────────────────────────────────

echo ""
echo "─── [3/4] Creating named tunnel ───────────────────────"

TUNNEL_ID="$(env_get TUNNEL_ID)"

if [[ -n "${TUNNEL_ID}" && -f "${DATA_DIR}/credentials.json" ]]; then
  ok "Tunnel already configured (ID: ${TUNNEL_ID}) – skipping creation"
else
  ask "Tunnel name (e.g. minhome)" TUNNEL_NAME
  echo ""
  echo "  Creating tunnel '${TUNNEL_NAME}'…"

  # Run create; output goes to a tmp file so we can parse the tunnel ID
  TMP_OUT="$(mktemp)"
  docker run --rm \
    --user 0:0 \
    -v "${DATA_DIR}:/etc/cloudflared" \
    cloudflare/cloudflared:latest \
    tunnel --origincert /etc/cloudflared/cert.pem create "${TUNNEL_NAME}" \
    2>&1 | tee "${TMP_OUT}"

  # Extract UUID from the output line "Created tunnel <name> with id <uuid>"
  TUNNEL_ID="$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "${TMP_OUT}" | head -1)"
  rm -f "${TMP_OUT}"

  if [[ -z "${TUNNEL_ID}" ]]; then
    echo ""
    echo "ERROR: could not parse tunnel ID from cloudflared output."
    echo "Check the output above and set TUNNEL_ID manually in .env,"
    echo "copy the credentials JSON to data/tunnel/credentials.json, then re-run."
    exit 1
  fi

  # cloudflared writes <uuid>.json into the mounted dir; normalise it
  JSON_SRC="${DATA_DIR}/${TUNNEL_ID}.json"
  if [[ ! -f "${JSON_SRC}" ]]; then
    # May have been written as root inside Docker; try with sudo
    JSON_SRC_ROOT="${DATA_DIR}/${TUNNEL_ID}.json"
    if sudo test -f "${JSON_SRC_ROOT}" 2>/dev/null; then
      sudo cp "${JSON_SRC_ROOT}" "${DATA_DIR}/credentials.json"
      sudo chmod 600 "${DATA_DIR}/credentials.json"
      sudo chown "$(id -u):$(id -g)" "${DATA_DIR}/credentials.json"
      sudo rm -f "${JSON_SRC_ROOT}"
    else
      echo "ERROR: credentials file ${JSON_SRC} not found."
      exit 1
    fi
  else
    cp "${JSON_SRC}" "${DATA_DIR}/credentials.json"
    chmod 600 "${DATA_DIR}/credentials.json"
    rm -f "${JSON_SRC}"
  fi

  env_set TUNNEL_ID "${TUNNEL_ID}"
  ok "Tunnel created: ${TUNNEL_NAME} (ID: ${TUNNEL_ID})"
  ok "credentials.json written to data/tunnel/"
fi

# ─── step 4: route DNS ────────────────────────────────────────────────────────

echo ""
echo "─── [4/4] Routing DNS ─────────────────────────────────"
echo ""
echo "  Pointing ${TUNNEL_HOSTNAME} → tunnel ${TUNNEL_ID}…"

# Re-read TUNNEL_NAME for the route command; cloudflared accepts tunnel ID directly
docker run --rm \
  --user 0:0 \
  -v "${DATA_DIR}:/etc/cloudflared" \
  cloudflare/cloudflared:latest \
  tunnel --origincert /etc/cloudflared/cert.pem route dns "${TUNNEL_ID}" "${TUNNEL_HOSTNAME}"

ok "DNS CNAME created"

# ─── done ─────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                    Setup complete!                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  .env has been updated with TUNNEL_HOSTNAME, TUNNEL_ID,"
echo "  and CF_DNS_API_TOKEN."
echo ""
echo "  Start the tunnel stack:"
echo ""
echo "    make up-tunnel BUILD=1       # production"
echo "    make up-dev-tunnel BUILD=1   # development (with Vite HMR)"
echo ""
