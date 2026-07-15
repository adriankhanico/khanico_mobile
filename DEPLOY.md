# Deploying with Docker Compose

Target: an on-prem Linux server (Docker + Compose already installed), reachable
directly on the local network — no reverse proxy, no TLS termination in front
of it. A single container serves both the built PWA and the API on one port.

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
