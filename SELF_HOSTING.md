# Self-Hosting Guide

Host your own Remote Agent Chat relay server using Docker Compose and Cloudflare Tunnel. No VPS required — runs on any machine with Docker Desktop (Windows, Mac, Linux, or a home server/NAS).

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed
- A free [Cloudflare account](https://cloudflare.com) (no domain required — Cloudflare provides a free `*.trycloudflare.com` subdomain, or you can use your own domain)
- A [Google Cloud Console](https://console.cloud.google.com) project for OAuth (free)

---

## Step 1 — Create a Cloudflare Tunnel

1. Log in to [Cloudflare Zero Trust](https://one.dash.cloudflare.com)
2. Go to **Networks → Tunnels → Create a tunnel**
3. Select **Cloudflared** as the connector type
4. Name your tunnel (e.g. `remote-agent-chat`)
5. On the **Install connector** screen, select **Docker** — copy the tunnel token from the displayed command (the long string after `--token`)
6. Under **Public Hostname**, add a route:
   - **Subdomain / Domain**: your chosen hostname (e.g. `agents.yourdomain.com`)
   - **Service**: `http://relay:3500`
   - Save the tunnel

> **No custom domain?** Use Cloudflare's free [Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) instead — run `cloudflared tunnel --url http://localhost:3500` locally to get a temporary `trycloudflare.com` URL. Note: the URL changes on each restart, so it's better for testing than permanent use.

---

## Step 2 — Set up Google OAuth

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Under **Authorized redirect URIs**, add: `https://your-tunnel-hostname/auth/callback`
4. Copy the **Client ID** and **Client Secret**

---

## Step 3 — Configure the relay

Clone or download this repo, then copy `.env.example` to `.env` and fill in all values:

```bash
cp .env.example .env
```

Generate the required secrets (run each in a terminal):

```bash
# SESSION_SECRET
openssl rand -hex 32

# JWT_SECRET
openssl rand -hex 32

# PROXY_SECRET
openssl rand -hex 32
```

Fill in `.env`:

```env
PUBLIC_URL=https://your-tunnel-hostname
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
ALLOWED_EMAIL=you@gmail.com
SESSION_SECRET=<generated above>
JWT_SECRET=<generated above>
PROXY_SECRET=<generated above>
CLOUDFLARE_TUNNEL_TOKEN=<token from Step 1>
```

---

## Step 4 — Start the relay

```bash
docker compose up -d
```

This starts two containers:
- `relay` — the Node.js relay server on port 3500
- `cloudflared` — Cloudflare Tunnel connector (routes public traffic to `relay:3500`)

Check logs:

```bash
docker compose logs -f
```

Visit your tunnel hostname in a browser — you should see the Google login page.

---

## Step 5 — Configure the agent proxy (Windows)

Launch Antigravity with CDP enabled:

```bat
launch-antigravity-cdp.bat
```

Then choose **one** of the two proxy modes:

### Option A: VS Code Extension (VSIX) — simplest setup

1. In Antigravity, go to **Extensions** → `···` menu → **Install from VSIX...**
2. Select `agent-proxy/vscode-ext/remote-agent-proxy-1.0.0.vsix`
3. Open **Settings** (Ctrl+,) and search `remoteAgentProxy`:
   - **Relay URL**: `wss://your-tunnel-hostname/proxy-ws`
   - **Proxy Secret**: same value as in relay `.env`
   - **CDP Ports**: `9223`
4. The proxy starts automatically — check the status bar for `Proxy (N)`.

If you open multiple Antigravity windows, only one runs the proxy. The others show `Proxy (standby)` and will take over automatically if the leader window closes.

### Option B: Standalone process

Edit `agent-proxy/.env`:

```env
RELAY_URL=wss://your-tunnel-hostname/proxy-ws
PROXY_SECRET=<same value as in relay .env>
CDP_PORTS=9223
```

Start the proxy (via Windows Scheduled Task, or manually for testing):

```bash
node agent-proxy/index.js
```

> **Do not run both at once.** If switching between modes, disable the Scheduled Task or uninstall the VSIX first.

---

## Updating

When a new version is available:

```bash
git pull
docker compose up -d --build
```

---

## Troubleshooting

**Tunnel not connecting** — check `docker compose logs cloudflared`. The token must match the tunnel you configured in Step 1.

**OAuth redirect mismatch** — the `PUBLIC_URL` in `.env` and the Authorized Redirect URI in Google Console must exactly match, including `https://` and no trailing slash.

**Proxy not connecting** — check that `PROXY_SECRET` matches in both `.env` files, and that `RELAY_URL` uses `wss://` (not `ws://`).

**Sessions not appearing** — verify the CDP port is reachable (`http://localhost:9223/json/list`) and Antigravity was launched via `launch-antigravity-cdp.bat`.
