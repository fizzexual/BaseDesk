# ---- build ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY server/package.json server/
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    ADMIN_PORT=4010 \
    PORTAL_PORT=4011
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY shared/seed.json shared/seed.json
VOLUME /data
EXPOSE 4010 4011

# Drop root. The node image ships an unprivileged `node` user; without this a container
# escape lands as uid 0, and everything written to the data volume is root-owned. /data
# must be chowned first or the app cannot create its SQLite file after the switch.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# Lets an orchestrator see that the process is actually serving rather than merely
# running — a Node process can survive while its HTTP server is wedged.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ADMIN_PORT||4010)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
