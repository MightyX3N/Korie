# Korie's server with its web client and admin at /web.
# Build:  docker build -t korie .
FROM node:22-trixie-slim AS web
WORKDIR /korie/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /korie/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY server/builtin ./builtin
# the TMDb key, scrambled (tools/make_secret.mjs); never in the repository
COPY server/secret.dat* ./
COPY --from=web /korie/web/dist /korie/web/dist
ENV KORIE_DATA=/data KORIE_WEB=/korie/web/dist NODE_ENV=production
VOLUME /data
# 7359/udp: Jellyfin's apps find the server by themselves
EXPOSE 8100/tcp 7361/udp 7359/udp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
