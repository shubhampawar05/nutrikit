# Nutrikit: one image serving the API, the developer portal and the web app on port 8787.
#   docker build -f docker/Dockerfile -t nutrikit .
# Needs a PostgreSQL database (DATABASE_URL); run `node dist/cli/migrate.js` before starting a new version.
# The food catalog (server/data/foods.db) must exist in the build context: build it with `npm run build:db`.

ARG NODE_VERSION=24

# ---- build: install everything, build the web app and compile the server
FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY sdk/js/package.json sdk/js/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY sdk/js sdk/js
COPY web web
COPY server server
RUN npm run build -w web && npm run build -w server \
 && find web/dist server/dist -name "*.map" -delete  # source maps stay out of the image

# ---- deps: production dependencies of the server only. npm's --workspace/--omit=dev combination still
# installs the workspace's devDependencies, so this stage narrows the workspace list to the server and
# installs against the same lockfile.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN node -e "const fs = require('fs'); const p = JSON.parse(fs.readFileSync('package.json')); p.workspaces = ['server']; delete p.devDependencies; fs.writeFileSync('package.json', JSON.stringify(p))" \
 && npm install --omit=dev --no-audit --no-fund

# ---- runtime: Alpine keeps the image small; the server has no native modules (node:sqlite is built in)
FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/server/package.json server/package.json
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY server/migrations server/migrations
COPY server/data/foods.db server/data/foods.db
COPY sdk/js/nutrikit.mjs sdk/js/nutrikit.d.ts sdk/js/
USER node
WORKDIR /app/server
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "dist/main.js"]
