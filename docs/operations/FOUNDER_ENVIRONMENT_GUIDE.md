# Founder Environment Guide

Which settings you enter, which you never touch, and why.

This is the founder-facing companion to `apps/backend/.env.example`. For the
engineering model behind it — stages, modes, validation, adding a config field
— see `ENVIRONMENT_MANAGEMENT.md` in this folder. For running and deploying,
see `SYNORA_OPERATIONS.md` at the repository root.

---

## The short version

You manage **nine** settings. Synora handles the rest.

Synora reads about 161 environment variables. Roughly 134 are tuning knobs
with working defaults already in the code — batch sizes, retry counts,
timeouts. You never see those, and that is deliberate: a setting you must
manage is a setting that can drift, and most of them have exactly one sensible
value.

---

## What you enter yourself

| Setting | What it is |
|---|---|
| `SELF_HOSTED_TEXT_BASE_URL` | Web address of your AI router, ending in `/v1` |
| `SELF_HOSTED_TEXT_API_KEY` | The key for that router |
| `SELF_HOSTED_TEXT_MODEL` | Which model to use, spelled exactly as the router spells it |
| `HOSTINGER_API_TOKEN` | Lets Synora read your server details from Hostinger |
| `SYNORA_DOMAIN` | Your domain, e.g. `trysynora.com` |
| `FRONTEND_URL` | Public address of the website |
| `BACKEND_URL` | Public address of the API |
| `CORS_ORIGINS` | Which websites may talk to the API |
| `DATABASE_URL` | Where the database lives, including its password |

Two more are worth setting deliberately even though they have defaults, because
they are your spending brakes: `AI_GLOBAL_MAX_COST_PER_DAY_CENTS` and
`AI_USER_MAX_COST_PER_DAY_CENTS`.

## What you must never touch

| Setting | Why |
|---|---|
| `JWT_SECRET` | Changing it logs every user out instantly |
| `TOOL_SECRET_MASTER_KEY` | After launch, changing it makes every stored tool credential permanently unreadable |
| `NEXTAUTH_SECRET` | Reserved for the future sign-in flow |
| `POSTGRES_PASSWORD` | Only the containers ever read it |
| `VPS_ID`, `VPS_IP` | Read from Hostinger automatically |

These are generated from a cryptographic random source and written straight to
the file. **Never type one by hand.** A password a person invents is
predictable in ways a person cannot see.

---

## Secret or not?

A **secret** would let someone act as you. A **public** value is one any
visitor can already read.

| Secret — never share | Public — safe to say aloud |
|---|---|
| API keys and tokens | Your domain name |
| `DATABASE_URL` (contains the password) | Website and API addresses |
| Anything named `*_SECRET`, `*_KEY`, `*_TOKEN` | Your server's IP address |
| `POSTGRES_PASSWORD` | Port numbers, model names |

Anything beginning `NEXT_PUBLIC_` is **shipped to every visitor's browser**.
That prefix is a promise the value is public. Never put a secret behind it.

**Never paste a secret into a chat window** — including this one. Type it
directly into `apps/backend/.env.local`, which is deliberately invisible to
Git and cannot be committed.

---

## Where each credential comes from

**AI router key** — your router's dashboard, under API keys. Only they can
issue or revoke it.

**Hostinger token** — Hostinger control panel → API. Deleting the old token
there is what actually revokes it; replacing your local copy alone leaves the
old one working for whoever has it.

**Database password** — you choose it locally; Synora generates it for
production.

**JWT and encryption keys** — Synora generates them. Nobody outside Synora
needs to agree with them, which is exactly what makes them generatable. A
vendor API key is not generatable, because a random string is not an account.

---

## How the addresses work

Three addresses that are easy to confuse:

```
FRONTEND_URL          where people visit          https://trysynora.com
BACKEND_URL           where the API lives         https://api.trysynora.com
CORS_ORIGINS          who may call the API        https://trysynora.com
```

`CORS_ORIGINS` lists the **websites allowed to talk to your API**. If your
real domain is missing from it, the site loads but live updates silently fail
— everything looks fine except the parts that matter.

**Local and production differ:**

| | Local | Production |
|---|---|---|
| Frontend | `http://localhost:3000` | your domain |
| Backend | `http://localhost:3001` | your API address |
| Protocol | `http` | `https` |

Synora **refuses to start in production** with a `localhost` address
configured. That refusal is a safety feature: it means a half-configured
deployment fails loudly at boot instead of quietly serving broken links.

**Your VPS IP address is not an application address.** `200.234.32.93` is
where the server physically lives. Applications are reached by domain name.
DNS is what connects the two, and it is the last step of launch.

---

## Adding a new AI provider

Normally **two lines**, and you should not need to touch anything else:

```
SOMEPROVIDER_API_KEY=...      the key
AI_PROVIDER=someprovider      only if you want to force it
```

That is the whole point of Synora's design: business logic never learns a
vendor's name, so switching providers is editing settings, not rewriting the
product. If adding a provider ever requires a code change outside the provider
folder, something has gone wrong architecturally — say so.

Leave every provider key you are not using **blank**. A blank optional key is
not a problem and never blocks launch.

---

## What Claude configures automatically

- generating every `[AUTO]` secret, and rotating them on request
- discovering your VPS ID and IP from Hostinger
- asking your AI router which models it actually serves
- filling in every tuning knob from code defaults
- checking that no secret has leaked into Git or the browser
- validating the whole file and reporting `PASS` / `FAIL` per setting

Two commands, run from `F:\Synora-SYNORA`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\init-env.ps1    # build/refresh
powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1   # validate
```

`init-env.ps1` **merges** — values you have set are preserved exactly, and only
missing ones are filled. `check-env.ps1` reports status and length only, never
a value.

---

## If something looks wrong

| Symptom | Usually |
|---|---|
| Site loads, live updates don't | Real domain missing from `CORS_ORIGINS` |
| "Nothing was generated" | Router unreachable, or the model name doesn't match what the router calls it |
| Everyone logged out at once | `JWT_SECRET` changed |
| Production won't start | A `localhost` address or a placeholder left in place — working as designed |

Run `check-env.ps1` first. It names the setting without revealing any value.
