# Korie

A media centre for the whole household: your films, series and music, add-ons (DRTV,
Stremio, RomM games) and a Store, on every screen in the house.

Korie is a **server** (in Docker, on a NAS) and **one web client** that every screen
uses: the Android TV app, the Windows/Mac/Linux app, or any browser.

| Part | What it is |
| --- | --- |
| `server/` | Node.js 22. The library (folders, TMDb details), people with PINs, watched status, the Lua add-ons and the Store. Plays files as they are when a device can, and converts them with FFmpeg when it can't. |
| `client/` | The web client (React, Norigin Spatial Navigation for remotes). TV, desktop and phone layouts sized from the real screen. |
| `android/` | The Android TV app: the client full screen. Finds the server by itself, can be the home screen, opens games on their own screen. |
| `desktop/` | The Windows/Mac/Linux app (Tauri): the client in a window, finds the server by itself. |
| `tools/check.mjs` | Goes through every screen with keys only, at TV, desktop and phone sizes, and plays things. Every build passes it. |

## Running the server

Korie runs in Docker. GitHub builds the image (`ghcr.io/mightyx3n/korie:latest`, for x86 and
ARM) on every push. On a NAS, paste this into the Docker app as a project (or save it as
`docker-compose.yml` and run `docker compose up -d`). Change `/volume1/Media` to the folder
with your films, series and music, and `/volume1/docker/korie` to where Korie may keep its data:

```yaml
# Korie on the NAS. Paste this into the NAS's Docker app as a project (or run
# "docker compose up -d" next to it). Korie sees /volume1/Media as /media: add
# its folders in Korie under Settings → Libraries. Open http://<NAS>:8100.
services:
  korie:
    image: ghcr.io/mightyx3n/korie:latest
    container_name: korie
    restart: unless-stopped
    # host networking lets TVs and PCs find Korie by themselves (UDP 7361);
    # Korie uses port 8100, so it doesn't clash with Jellyfin
    network_mode: host
    environment:
      - TZ=Europe/Copenhagen
    volumes:
      - /volume1/docker/korie:/data
      # the same media share Jellyfin uses
      - /volume1/Media:/media:ro
```

Or without compose:

    docker run -d --name korie --network host --restart unless-stopped \
      -v /volume1/docker/korie:/data -v /volume1/Media:/media:ro ghcr.io/mightyx3n/korie:latest

To update: pull the image again and restart the container (`docker compose pull && docker compose up -d`).

Then open `http://<nas>:8100` and add your folders under Settings → Libraries.
Host networking lets TVs and PCs find the server by themselves (UDP 7361). Without it,
type the address in the app once.

## Finding the server

Clients send `KORIE_DISCOVER` by UDP broadcast to port 7361 and every server answers. One
server: the app connects by itself. Several: it asks which and remembers. None: it asks
for the address.

## Building

    cd client && npm ci && npm run build
    cd server && npm ci && npm start              # http://localhost:8100
    node tools/make_secret.mjs <file with a TMDb key>   # server/secret.dat, never committed
    docker build -t korie .
    cd android && ./gradlew assembleRelease
    cd desktop/src-tauri && cargo build --release [--target x86_64-pc-windows-gnu]

Add-ons are written in Lua and run sandboxed on the server: see `docs/ADDONS.md` in the
Korie-Store repository.
