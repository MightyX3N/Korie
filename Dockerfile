# Korie's server with its web client.  Build:  docker build -t korie .
FROM node:22-trixie-slim AS client
WORKDIR /korie/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /korie/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY server/builtin ./builtin
# the TMDb key, scrambled (tools/make_secret.mjs); never in the repository
COPY server/secret.dat* ./
COPY --from=client /korie/client/dist /korie/client/dist
ENV KORIE_DATA=/data KORIE_CLIENT=/korie/client/dist NODE_ENV=production
VOLUME /data
EXPOSE 8100/tcp 7361/udp
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts"]
