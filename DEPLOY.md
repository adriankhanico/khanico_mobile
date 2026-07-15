# Deploying to Windows Server (IIS reverse proxy)

Target: a dedicated subdomain (e.g. `ventor.khanico.com`) on your IIS server,
reverse-proxied to a single Node process that serves both the built client
and the API. Node listens only on `127.0.0.1` (not exposed externally) — IIS
is the only thing the network sees.

## 0. One-time server prerequisites

1. **Node.js** — already installed (per your setup).
2. **IIS** with these features/role services enabled (Server Manager → Add
   Roles and Features → Web Server (IIS)):
   - Web Server → Application Development → nothing extra needed (no
     iisnode required for this approach)
3. **Application Request Routing (ARR)** + **URL Rewrite** modules —
   download and install both from the IIS.net downloads page (Microsoft's
   official IIS extensions, installed via the Web Platform Installer or
   standalone MSI). These are what let IIS act as a reverse proxy.
4. In IIS Manager, select the server node (top level) → **Application
   Request Routing Cache** → **Server Proxy Settings** (right pane) →
   check **Enable proxy** → Apply. This turns on ARR's proxy capability
   server-wide (site-level rewrite rules still control what gets proxied).
5. **DNS**: point `ventor.khanico.com` (or whatever subdomain you choose) at
   the server's IP, same as your other internal sites.

## 1. Get the code onto the server

Clone or copy the repo to somewhere permanent, e.g. `C:\apps\ventor-mobile`.
If you deploy by git pull, make sure `.env` (step 3) is never committed —
it already is git-ignored.

## 2. Install dependencies and build

```powershell
cd C:\apps\ventor-mobile
npm install
npm run build:server
npm run build:client
```

This produces `server/dist/server/src/index.js` (the compiled BFF, which
now also serves the built client) and `client/dist/` (the static PWA
assets, which the server reads from at runtime).

## 3. Create `server/.env`

Copy `server/.env.example` to `server/.env` and fill in real values:

```
PORT=3001
ODOO_BASE_URL=https://your-instance.odoo.com
ODOO_DB=your-db-name
SESSION_SECRET=<generate a long random string>
CLIENT_ORIGIN=https://ventor.khanico.com
COOKIE_SECURE=true
```

Notes:
- `PORT` is the **internal** port Node listens on — pick anything free,
  e.g. `3001`. This is never exposed directly; IIS proxies to it.
- `COOKIE_SECURE=true` requires the site to actually be served over HTTPS
  (see step 6). If you're testing over plain HTTP first, set this to
  `false` temporarily, or the session cookie won't be sent back by the
  browser and login will silently fail.
- Generate `SESSION_SECRET` with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 4. Run Node as a Windows Service

Don't run `node dist/server/src/index.js` in a terminal window — it'll die
on logout/reboot. Use a service wrapper. **NSSM** (Non-Sucking Service
Manager) is the simplest option:

1. Download NSSM, put `nssm.exe` somewhere like `C:\tools\nssm\nssm.exe`.
2. Install the service:
   ```powershell
   C:\tools\nssm\nssm.exe install VentorMobile
   ```
   This opens a GUI. Set:
   - **Path**: `C:\Program Files\nodejs\node.exe` (wherever `node.exe` is —
     check with `(Get-Command node).Source`)
   - **Startup directory**: `C:\apps\ventor-mobile\server`
   - **Arguments**: `dist\server\src\index.js`
   - On the **Environment** tab (or via `nssm set`), you generally don't
     need to set env vars here since `dotenv` reads `server/.env` — just
     make sure the working directory is right so that file is found.
3. Start it:
   ```powershell
   nssm start VentorMobile
   ```
4. Confirm it's listening locally:
   ```powershell
   curl http://localhost:3001/api/health
   ```
   Should return `{"status":"ok"}` (or similar) with HTTP 200.

To update the app later: stop the service, `git pull`, `npm install` (if
deps changed), rebuild both workspaces, start the service again.

## 5. Create the IIS site and proxy rule

1. IIS Manager → **Sites** → **Add Website**:
   - **Site name**: `ventor-mobile`
   - **Physical path**: any empty folder (e.g. `C:\inetpub\ventor-placeholder`)
     — IIS requires one even though URL Rewrite will intercept everything;
     nothing here is actually served.
   - **Binding**: Host name `ventor.khanico.com`, port `80` for now (add
     `443` after the cert is in place in step 6).
2. Select the new site → **URL Rewrite** (double-click) → **Add Rule(s)** →
   **Reverse Proxy** (this template only appears once ARR is installed) →
   enter `localhost:3001` as the server → OK. This creates a rule that
   forwards all requests for this site to your Node process.
3. Confirm `web.config` was generated in the site's rewrite config with an
   inbound rule targeting `http://localhost:3001/{R:1}` — you can inspect
   it via the URL Rewrite UI, no manual editing needed.
4. Browse to `http://ventor.khanico.com/` from another machine on the
   network — you should see the Ventor login screen.

## 6. HTTPS (recommended before real use)

Since real Odoo passwords travel in the login request and the session
cookie protects a live Odoo identity, don't leave this on plain HTTP long
term.

- If the server already has a certificate solution (internal CA, wildcard
  cert, etc.), bind it to this site's `443` binding in IIS the same way as
  your other sites.
- Otherwise, **win-acme** (a Windows ACME/Let's Encrypt client) can
  automate obtaining and binding a cert for `ventor.khanico.com`, provided
  that hostname is reachable from the internet for the HTTP-01 challenge
  (or your DNS provider supports the DNS-01 challenge if it's internal-only).
- Once HTTPS is bound, set `COOKIE_SECURE=true` in `server/.env` (already
  shown above) and restart the `VentorMobile` service.
- Optionally add an HTTP→HTTPS redirect rule in the same site's URL
  Rewrite rules (a plain redirect rule ahead of the reverse-proxy rule).

## 7. Verify end to end

1. `https://ventor.khanico.com/` loads the login screen.
2. Log in with a real Odoo user's credentials; confirm `GET /api/auth/me`
   (via browser devtools network tab) reflects that identity.
3. Exercise a read (inventory search, transfer list) and a write (scan a
   pick line, edit a sale order line) to confirm the full round trip to
   Odoo works from the deployed instance.
4. Confirm the resulting Odoo records' `create_uid`/`write_uid` show the
   real logged-in user, not an admin/service account.

## If ARR/ORR reverse proxy isn't available or blocked

As a fallback with no IIS involvement at all: keep the same build/service
steps (1–4) above, but instead of a proxy, have Node listen directly and
open it up on the network:

- Set `PORT` to whatever you want exposed (e.g. `8013`) and bind the NSSM
  service the same way — Node's `app.listen(config.port, ...)` already
  binds all interfaces by default (`0.0.0.0`), so no code change is needed.
- Open that port in Windows Firewall (inbound rule, TCP, specific port).
- Access via `http://khanicohsse01:8013/` directly, same pattern as your
  other locally-run apps.
- Downsides versus the IIS approach: no IIS-managed HTTPS/cert, no clean
  hostname (port number in every URL), and Node is directly reachable from
  the network rather than sitting behind IIS.
