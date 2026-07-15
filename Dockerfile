# --- deps + build ---
FROM node:20-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci

COPY client client
COPY server server
COPY shared shared

RUN npm run build:client
RUN npm run build:server

# --- runtime ---
# @khanico/shared is a workspace-only, types-only package ("*" in
# server/package.json dependencies) — it doesn't exist on the npm registry,
# so npm install must run with the full workspace root present, or it'll
# 404 trying to fetch it. Simplest correct way: reuse the same root install,
# then strip devDependencies afterward.
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --omit=dev

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY shared/types.ts shared/types.ts

EXPOSE 3001
CMD ["node", "server/dist/server/src/index.js"]
