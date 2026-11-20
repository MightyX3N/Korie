# syntax=docker/dockerfile:1
# Korie's server with its web client and admin at /web.
# Build:  docker build -t korie .
FROM node:22-trixie-slim AS web
WORKDIR /korie/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# playit.gg's agent (BSD-2-Clause, Developed Methods LLC), for watching away from home:
# playitd (the agent) and playit-cli (to link it to the admin's playit account)
FROM node:22-trixie-slim AS playit
ARG TARGETARCH
ADD --checksum=sha256:9d27a8dbb4d2d8a7107fcabfa33028c789a30a64c97a36447fe4afb94e08dde9 https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-linux-amd64 /playit/amd64/playitd
ADD --checksum=sha256:aed86fc2b82a772ca0e1d5cddec6c3123f96e12a099f7ae45aaa59a9a430a2cd https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-linux-aarch64 /playit/arm64/playitd
ADD --checksum=sha256:a3b3990c40669f93a333b0b16cb8ea2bcfdac9564a420d952a58d4aebe9e87e3 https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-linux-armv7 /playit/arm/playitd
ADD --checksum=sha256:28dbb93f52acda04af99418d03042659356b33fa4279ef8e431f22cf84378a36 https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-cli-linux-amd64 /playit/amd64/playit-cli
ADD --checksum=sha256:bf7215ae4f67abe81bcb4871046c11b0080ba012c6c98aad6d148d346b631d78 https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-cli-linux-aarch64 /playit/arm64/playit-cli
ADD --checksum=sha256:ddbb0edc0c2b241676ca1ad5b998e755c4ca07ce21980d5da28381cbf3f88281 https://github.com/playit-cloud/playit-agent/releases/download/v2.0.2/playit-cli-linux-armv7 /playit/arm/playit-cli
RUN cp /playit/${TARGETARCH}/playitd /playit/${TARGETARCH}/playit-cli /usr/local/bin/ && chmod 755 /usr/local/bin/playitd /usr/local/bin/playit-cli

FROM node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=playit /usr/local/bin/playitd /usr/local/bin/playit-cli /usr/local/bin/
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
