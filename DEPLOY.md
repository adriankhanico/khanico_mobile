# Deploying with Docker Compose

Target: an on-prem Linux server (Docker + Compose already installed), reachable
directly on the local network — no reverse proxy, no TLS termination in front
of it. A single container serves both the built PWA and the API on one port.

**Server**: `10.6.0.77` (SSH user: `adrian`, key auth already set up — no
password needed). App runs from `/opt/khanico-mobile`, exposed directly on
`http://10.6.0.77:3001`, no login/VPN/VSCode required, just a terminal with
`ssh`. Portainer (container UI, read-mostly for this app since it wasn't
created through Portainer) is at `http://10.6.0.77:9000`.

## Connecting and updating (the day-to-day loop)

For a **code change** (anything in `client/`, `server/`, or `shared/`):

1. On your own machine: commit and push the change to `main` on GitHub as normal.
2. SSH into the server and redeploy:
   ```bash
   ssh adrian@10.6.0.77
   cd /opt/khanico-mobile
   git pull
   docker compose up -d --build
   ```
3. Verify:
   ```bash
   curl http://localhost:3001/api/health
   ```
   should print `{"status":"ok"}`.

For an **env-only change** (e.g. switching which Odoo instance it points at —
edit `server/.env` on the server directly, it's gitignored and never touches
git):
```bash
ssh adrian@10.6.0.77
nano /opt/khanico-mobile/server/.env   # edit, save
cd /opt/khanico-mobile
docker compose up -d                   # no --build needed, env vars aren't baked into the image
```

Restarting the container (either path) logs everyone out — sessions are
in-memory, see Notes below.

To check whether the server is running the latest code:
```bash
git log --oneline -1                          # on your machine
ssh adrian@10.6.0.77 "cd /opt/khanico-mobile && git log --oneline -1"   # on the server
```
If the commit hashes match and `git status --short` is empty on both sides,
they're in sync.

## First-time setup

The steps below are only needed once, when standing the app up on a brand new
server — not for routine updates (see above).

## 0. One-time server prerequisites

- Docker + Docker Compose installed.
- A free port for the app to bind to (this deployment uses `3001`).
- SSH access with a user that can write to `/opt/`.

## 1. Get the code onto the server

Clone (or `git pull` if already cloned) into `/opt/khanico-mobile`:

```bash
sudo mkdir -p /opt/khanico-mobile
sudo chown "$USER:$USER" /opt/khanico-mobile
git clone <repo-url> /opt/khanico-mobile
```

To update later: `cd /opt/khanico-mobile && git pull`.

## 2. Create `server/.env`

Copy `server/.env.example` to `server/.env` on the server and fill in real
values. This file is gitignored and never leaves the server:

```
PORT=3001
ODOO_BASE_URL=https://your-instance.odoo.com
ODOO_DB=your-db-name
SESSION_SECRET=<generate a long random string>
CLIENT_ORIGIN=http://<server-ip>:3001
COOKIE_SECURE=false
```

Notes:
- `CLIENT_ORIGIN` should match exactly how the app is accessed (used for CORS).
- `COOKIE_SECURE=false` is correct for plain-HTTP local-network access. Only
  set it to `true` if this is served over HTTPS — otherwise the session
  cookie won't be sent back by the browser and login will silently fail.
- Generate `SESSION_SECRET` with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 3. Build and run

```bash
cd /opt/khanico-mobile
docker compose up -d --build
```

This builds a multi-stage image (client + server compiled, then a slim
runtime image) and starts a single container that serves the API and the
built PWA on the same port.

To redeploy after a `git pull`:

```bash
docker compose up -d --build
```

Env var changes (edits to `server/.env`) don't need a rebuild — just:

```bash
docker compose up -d
```

## 4. Verify

```bash
curl http://localhost:3001/api/health
```

Should return `{"status":"ok"}`. Then browse to `http://<server-ip>:3001/`
from another machine on the network — you should see the Khanico Mobile
login screen. Log in with a real Odoo user and exercise a read (inventory
search) and a write (scan a pick line) to confirm the full round trip to
Odoo works from the deployed instance.

## Notes

- Sessions are held in-memory in the Node process (a single container), so
  restarting the container logs everyone out. Acceptable for a small internal
  team; revisit with a shared session store (e.g. Redis) if this needs to
  scale beyond one container.
- If this is ever exposed beyond the local network, put a reverse proxy with
  TLS in front of it and set `COOKIE_SECURE=true` — real Odoo credentials and
  session cookies should not travel over plain HTTP outside a trusted LAN.
