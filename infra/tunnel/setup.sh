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
    --user 0:0 \
    -v "${DATA_DIR}:/root/.cloudflared" \
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

  # Check if a tunnel with this name already exists
  LIST_OUT="$(
    docker run --rm \
      --user 0:0 \
      -v "${DATA_DIR}:/etc/cloudflared" \
      cloudflare/cloudflared:latest \
      tunnel --origincert /etc/cloudflared/cert.pem list -o json -name "${TUNNEL_NAME}" 2>/dev/null
  )" || true
  EXISTING_ID="$(echo "${LIST_OUT}" \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
    | head -1
  )" || true

  if [[ -n "${EXISTING_ID}" ]]; then
    echo "  Tunnel '${TUNNEL_NAME}' already exists (ID: ${EXISTING_ID})."
    printf "  Delete it and recreate? [y/N]: "
    read -r CONFIRM
    if [[ "${CONFIRM}" =~ ^[Yy]$ ]]; then
      info "Cleaning up connections…"
      docker run --rm \
        --user 0:0 \
        -v "${DATA_DIR}:/etc/cloudflared" \
        cloudflare/cloudflared:latest \
        tunnel --origincert /etc/cloudflared/cert.pem cleanup "${EXISTING_ID}" 2>&1 || true
      info "Deleting tunnel…"
      docker run --rm \
        --user 0:0 \
        -v "${DATA_DIR}:/etc/cloudflared" \
        cloudflare/cloudflared:latest \
        tunnel --origincert /etc/cloudflared/cert.pem delete "${EXISTING_ID}" 2>&1
      rm -f "${DATA_DIR}/credentials.json"
      ok "Deleted tunnel ${EXISTING_ID}"
    else
      echo "  Aborted."
      exit 1
    fi
  fi

  echo "  Creating tunnel '${TUNNEL_NAME}'…"

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

EXPECTED_CNAME="${TUNNEL_ID}.cfargotunnel.com"
ZONE_NAME="$(echo "${TUNNEL_HOSTNAME}" | awk -F. '{print $(NF-1)"."$NF}')"

# Look up the zone ID
ZONE_ID="$(curl -sf \
  -H "Authorization: Bearer ${CF_DNS_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)" || true

if [[ -n "${ZONE_ID}" ]]; then
  # Check for an existing DNS record
  EXISTING_RECORD="$(curl -sf \
    -H "Authorization: Bearer ${CF_DNS_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${TUNNEL_HOSTNAME}")" || true

  RECORD_ID="$(echo "${EXISTING_RECORD}" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)" || true
  RECORD_CONTENT="$(echo "${EXISTING_RECORD}" | grep -o '"content":"[^"]*"' | head -1 | cut -d'"' -f4)" || true

  if [[ -n "${RECORD_ID}" && "${RECORD_CONTENT}" != "${EXPECTED_CNAME}" ]]; then
    echo "  Existing DNS record found: ${TUNNEL_HOSTNAME} → ${RECORD_CONTENT}"
    echo "  Expected: ${EXPECTED_CNAME}"
    printf "  Delete and replace? [y/N]: "
    read -r CONFIRM
    if [[ "${CONFIRM}" =~ ^[Yy]$ ]]; then
      curl -sf -X DELETE \
        -H "Authorization: Bearer ${CF_DNS_API_TOKEN}" \
        "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" > /dev/null
      ok "Deleted stale DNS record"
    else
      echo "  Aborted."
      exit 1
    fi
  elif [[ -n "${RECORD_ID}" && "${RECORD_CONTENT}" == "${EXPECTED_CNAME}" ]]; then
    ok "DNS already points to this tunnel – skipping"
    SKIP_DNS_ROUTE=1
  fi
fi

if [[ -z "${SKIP_DNS_ROUTE:-}" ]]; then
  docker run --rm \
    --user 0:0 \
    -v "${DATA_DIR}:/etc/cloudflared" \
    cloudflare/cloudflared:latest \
    tunnel --origincert /etc/cloudflared/cert.pem route dns "${TUNNEL_ID}" "${TUNNEL_HOSTNAME}"
  ok "DNS CNAME created"
fi

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
