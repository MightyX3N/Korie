# Korie's server with its web pages, and Jellyfin's own web app (unchanged) for watching in a browser.
# Build:  docker build -t korie .
FROM debian:trixie-slim AS jellyfin-web
# Jellyfin's web app, taken as it is from Jellyfin's release (it's the same on every machine type)
ARG JELLYFIN_VERSION=12.4
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL "https://repo.jellyfin.org/files/server/linux/stable/v${JELLYFIN_VERSION}/amd64/jellyfin_${JELLYFIN_VERSION}-amd64.tar.gz" \
    | tar -xz -C / jellyfin/jellyfin-web

FROM node:22-trixie-slim AS client
WORKDIR /korie/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
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
COPY --from=client /korie/client/dist /korie/client/dist
COPY --from=jellyfin-web /jellyfin/jellyfin-web /korie/jellyfin-web
ENV KORIE_DATA=/data KORIE_CLIENT=/korie/client/dist KORIE_JELLYFIN_WEB=/korie/jellyfin-web NODE_ENV=production
VOLUME /data
# 7359/udp: Jellyfin's apps find the server by themselves
EXPOSE 8100/tcp 7361/udp 7359/udp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
