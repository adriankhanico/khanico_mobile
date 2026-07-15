# Ventor Mobile

Custom warehouse/inventory mobile PWA integrating with Odoo 17/18, built to replace the commercial "Ventor" app for this deployment.

## Structure

- `client/` — the PWA (Vite + TypeScript)
- `server/` — Node/Express backend-for-frontend (BFF) that holds the Odoo API key and exposes a REST API to the client
- `shared/` — TypeScript types shared between client and server
- `docs/` — operational docs (e.g. Zebra DataWedge profile setup)

## Setup

```bash
npm install
cp server/.env.example server/.env   # then fill in real Odoo credentials
npm run dev:server                   # http://localhost:3001
npm run dev:client                   # http://localhost:5173
```

## Security

The Odoo API key lives only in `server/.env` (gitignored) and is never sent to the browser. The PWA has its own independent login, decoupled from Odoo credentials.
