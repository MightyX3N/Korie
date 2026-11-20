# syntax=docker/dockerfile:1
# Korie's server with its web client and admin at /web.
# Build:  docker build -t korie .
FROM node:22-trixie-slim AS web
WORKDIR /korie/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# playit.gg's agent (BSD-2-Clause, Developed Methods LLC), for watching away from home
FROM node:22-trixie-slim AS playit
ARG TARGETARCH
ADD --checksum=sha256:db7f02937fbfd8a6b3bf74d3dea730825e24196c6b7dcc028aa410d9ead9865d https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-amd64 /playit/amd64
ADD --checksum=sha256:db07c541695dd1937c40bf7e99a480bc4513f9a97018dcab485f96d52e692a2f https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-aarch64 /playit/arm64
ADD --checksum=sha256:d0d3c219b8b78b346057cc846d74f32c9964ad39a4f91948509d5a285c3abe7a https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-linux-armv7 /playit/arm
RUN cp /playit/${TARGETARCH} /usr/local/bin/playit && chmod 755 /usr/local/bin/playit

FROM node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=playit /usr/local/bin/playit /usr/local/bin/playit
COPY server/licenses/playit-agent.txt /usr/share/doc/playit/LICENSE
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
# 8101: the outside port (playit.gg's tunnel points at it; what comes in there counts as outside the home)
EXPOSE 8100/tcp 8101/tcp 7361/udp 7359/udp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
