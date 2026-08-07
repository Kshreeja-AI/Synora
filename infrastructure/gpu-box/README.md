# GPU box — Synora's model endpoint

This directory turns a rented GPU instance into the authenticated,
OpenAI-compatible endpoint Synora's Ollama provider talks to. One
script, run once on the box.

**The one rule this exists to enforce**: raw Ollama has **no
authentication**. It must never listen on a public interface. The script
binds Ollama to `127.0.0.1` and puts Caddy in front of it; Caddy rejects
every request that does not carry the bearer token, before Ollama ever
sees it.

## Founder steps (~10 minutes once the box exists)

1. Rent a GPU instance (RunPod / Vast.ai / Lambda class), Ubuntu image,
   24–48 GB VRAM, and open a terminal on it.
2. Copy `setup.sh` onto the box and run:

   ```bash
   sudo bash setup.sh
   ```

   Optional knobs (defaults shown):

   ```bash
   MODELS="llama3.1:8b qwen2.5-coder:7b nomic-embed-text"  # what to pull
   PROXY_PORT=8443                                          # proxy listen port
   TLS_MODE=off                                             # off = platform TLS; auto = own domain
   DOMAIN=                                                  # required when TLS_MODE=auto
   ```

3. The script self-verifies (no-token → 401, token → 200) and then
   prints the exact `OLLAMA_*` values. Enter them into Synora's hosting
   environment (or `apps/backend/.env.local` for local development) —
   never into git, never into chat.
4. Synora needs **zero code changes**: the same env vars point at any
   OpenAI-compatible endpoint, which is what makes buying your own GPU
   hardware later a pure re-run of this script.

## TLS: which mode am I in?

| Situation | Mode | OLLAMA_BASE_URL |
|---|---|---|
| RunPod / Vast-style platform HTTPS proxy | `TLS_MODE=off` (default) | the platform's `https://…` URL for the proxy port, plus `/v1` |
| Bare VPS + your own domain | `TLS_MODE=auto DOMAIN=models.example.com` | `https://models.example.com/v1` |

Never use plain `http://` across the public internet — the bearer token
would travel unencrypted.

## Cost control

The box bills by the hour (~$0.20–0.80/hr). Stop it when idle; Synora's
health probes (`model-endpoint:*`) go `down` within a minute and recover
on restart, and requests fail with an honest provider error rather than
hanging. Ollama keeps models warm for 1h after last use
(`OLLAMA_KEEP_ALIVE`), so the first generation after a long idle period
can still take tens of seconds while the model pages back in — that is
the box, not a Synora bug.

## Rotating the token

```bash
OLLAMA_PROXY_TOKEN=$(openssl rand -hex 32) sudo -E bash setup.sh
```

Then update `OLLAMA_API_KEY` (and `EMBEDDING_OLLAMA_API_KEY`) wherever
Synora runs. Until you do, Synora's requests get 401 and the endpoint
probe logs "refused its token" — pointing at the token, not the machine.

## Status honesty

This script is **UNVERIFIED ON A REAL BOX** until the first GPU instance
exists (the founder action in the launch runbook). Its verification step
is built in — it refuses to declare the box ready unless the 401/200
pair holds. What IS verified today, against a mock endpoint in CI-style
tests: Synora's side of the contract — Bearer header on the wire,
streaming, usage accounting, health probes, and 401 handling
(`apps/backend/src/test-support/mockOpenAIServer.ts` suites).
