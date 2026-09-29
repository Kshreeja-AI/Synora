#!/usr/bin/env bash
#
# Synora GPU box setup — turns a fresh Ubuntu/Debian GPU instance
# (RunPod / Vast.ai / Lambda / any VPS with an NVIDIA GPU) into an
# AUTHENTICATED, OpenAI-compatible model endpoint for Synora.
#
# What it does, in order:
#   1. Installs Ollama and binds it to 127.0.0.1 ONLY — raw Ollama has no
#      authentication and must never listen on a public interface.
#   2. Generates a random bearer token (or reuses the one you pass in).
#   3. Installs Caddy as the fronting proxy: every request must carry
#      `Authorization: Bearer <token>` or it is rejected with 401 before
#      it ever reaches Ollama.
#   4. Pulls the chosen models.
#   5. Prints the exact values to put into Synora's environment.
#
# Usage (as root, on the GPU box — never on your laptop):
#   MODELS="llama3.1:8b qwen2.5-coder:7b nomic-embed-text" \
#   PROXY_PORT=8443 \
#   bash setup.sh
#
# Two TLS situations, pick yours:
#   A. The platform terminates TLS for you (RunPod's *.proxy.runpod.net
#      URLs, Vast's port mappings behind their TLS proxy): keep
#      TLS_MODE=off (default). The proxy speaks plain HTTP locally; the
#      platform wraps it in HTTPS at the edge. Use the platform's https://
#      URL as OLLAMA_BASE_URL.
#   B. Bare VPS with your own domain pointed at it: set TLS_MODE=auto and
#      DOMAIN=models.example.com — Caddy provisions a real Let's Encrypt
#      certificate automatically.
#   Never use a bare http:// URL across the public internet: the bearer
#   token would travel unencrypted.
#
set -euo pipefail

MODELS="${MODELS:-llama3.1:8b qwen2.5-coder:7b nomic-embed-text}"
PROXY_PORT="${PROXY_PORT:-8443}"
TLS_MODE="${TLS_MODE:-off}"        # off | auto (auto requires DOMAIN)
DOMAIN="${DOMAIN:-}"
TOKEN="${OLLAMA_PROXY_TOKEN:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash setup.sh)." >&2
  exit 1
fi

if [ "$TLS_MODE" = "auto" ] && [ -z "$DOMAIN" ]; then
  echo "TLS_MODE=auto requires DOMAIN=<your-domain> pointing at this box." >&2
  exit 1
fi

echo "==> [1/5] Installing Ollama (bound to loopback only)"
if ! command -v ollama >/dev/null 2>&1; then
  curl -fsSL https://ollama.com/install.sh | sh
fi

# Bind Ollama to 127.0.0.1: the ONLY way in is through the token proxy.
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/synora.conf <<'UNIT'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
# Keep models warm for an hour after last use so the first request after
# an idle period is not a cold load.
Environment="OLLAMA_KEEP_ALIVE=1h"
UNIT
systemctl daemon-reload
systemctl enable --now ollama
systemctl restart ollama

echo "==> [2/5] Generating the bearer token"
if [ -z "$TOKEN" ]; then
  TOKEN="$(openssl rand -hex 32)"
fi
install -d -m 700 /etc/synora
printf '%s' "$TOKEN" > /etc/synora/ollama-proxy-token
chmod 600 /etc/synora/ollama-proxy-token

echo "==> [3/5] Installing Caddy (the token-checking proxy)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

if [ "$TLS_MODE" = "auto" ]; then
  SITE_ADDRESS="$DOMAIN"
else
  SITE_ADDRESS=":$PROXY_PORT"
fi

cat > /etc/caddy/Caddyfile <<CADDY
{
	# Platform-terminated TLS (TLS_MODE=off) serves plain HTTP locally;
	# the hosting platform's edge wraps it. TLS_MODE=auto lets Caddy
	# provision Let's Encrypt for \$DOMAIN instead.
$( [ "$TLS_MODE" = "off" ] && printf '\tauto_https off\n' )
}

$SITE_ADDRESS {
	# Reject anything without the exact bearer token BEFORE it reaches
	# Ollama. Raw Ollama has no auth of its own — this line is the auth.
	@unauthorized not header Authorization "Bearer {\$SYNORA_OLLAMA_TOKEN}"
	respond @unauthorized 401

	reverse_proxy 127.0.0.1:11434
}
CADDY

# Hand the token to Caddy via systemd credentials-style env, never inline
# in the Caddyfile (which is world-readable by default).
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/synora.conf <<UNIT
[Service]
Environment="SYNORA_OLLAMA_TOKEN=$TOKEN"
UNIT
chmod 600 /etc/systemd/system/caddy.service.d/synora.conf
systemctl daemon-reload
systemctl enable --now caddy
systemctl restart caddy

echo "==> [4/5] Pulling models: $MODELS"
for model in $MODELS; do
  ollama pull "$model"
done

echo "==> [5/5] Verifying the proxy end to end"
sleep 2
SCHEME="http"; [ "$TLS_MODE" = "auto" ] && SCHEME="https"
HOSTPART="127.0.0.1:$PROXY_PORT"; [ "$TLS_MODE" = "auto" ] && HOSTPART="$DOMAIN"
NO_AUTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$SCHEME://$HOSTPART/v1/models" || true)"
WITH_AUTH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$SCHEME://$HOSTPART/v1/models" || true)"

echo
echo "    no token  -> HTTP $NO_AUTH_STATUS   (must be 401)"
echo "    with token-> HTTP $WITH_AUTH_STATUS   (must be 200)"
if [ "$NO_AUTH_STATUS" != "401" ] || [ "$WITH_AUTH_STATUS" != "200" ]; then
  echo "SETUP FAILED VERIFICATION — do not point Synora at this box yet." >&2
  exit 1
fi

FIRST_MODEL="${MODELS%% *}"
echo
echo "============================================================"
echo " GPU box ready. Enter these into Synora's environment"
echo " (hosting dashboard / .env.local — NEVER into git or chat):"
echo "============================================================"
if [ "$TLS_MODE" = "auto" ]; then
  echo "  OLLAMA_BASE_URL=https://$DOMAIN/v1"
else
  echo "  OLLAMA_BASE_URL=<this box's platform HTTPS URL for port $PROXY_PORT>/v1"
fi
echo "  OLLAMA_API_KEY=$TOKEN"
echo "  OLLAMA_MODEL=$FIRST_MODEL"
echo "  OLLAMA_MODELS=$(echo "$MODELS" | tr ' ' ',')"
echo
echo "  Embeddings (same box):"
echo "  EMBEDDING_OLLAMA_BASE_URL=<same as OLLAMA_BASE_URL>"
echo "  EMBEDDING_OLLAMA_API_KEY=<same as OLLAMA_API_KEY>"
echo
echo " The token is also stored on this box at /etc/synora/ollama-proxy-token"
echo " To rotate it: OLLAMA_PROXY_TOKEN=\$(openssl rand -hex 32) bash setup.sh"
echo "============================================================"
