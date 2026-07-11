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
    PORT=4011
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY shared/seed.json shared/seed.json
VOLUME /data
EXPOSE 4011
CMD ["node", "server/dist/index.js"]
