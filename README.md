# Korie

A small, fast media server for the whole household, that **Jellyfin's own apps** play from.

Korie is a server (in Docker, on a NAS). It speaks Jellyfin's language, so the Jellyfin apps
people already use work with it as they are (checked so far: the Android TV app and the web app;
phone apps, Infuse and Swiftfin should work but haven't been checked yet): their remote control, scrolling and screen sizes are theirs, already proven.
Behind that, the library is Korie's: adding a folder takes seconds, not hours, and Korie adds what
Jellyfin doesn't have: people with PINs like Netflix, age limits per person, add-ons written in a
few lines of Lua, and a Store for them.

| Part | What it is |
| --- | --- |
| `server/` | Node.js 22. The library (folders, names from the files at once, details from TMDb afterwards), people with PINs and age limits, watched status, the Lua add-ons and the Store, and Jellyfin's API (`src/jellyfin.ts`). Plays files as they are when a device can, and converts them with FFmpeg as they play when it can't. |
| `docs/index.html` | Korie's website: what it is, what it does, and how it compares with Jellyfin. |
| `client/` | Korie's own web pages: settings (folders, people, add-ons, the Store) and watching in a browser. |
| `tools/jellyfin-check/` | The checks that prove Jellyfin's apps work with Korie: the real Jellyfin SDK reading Korie's answers, Jellyfin's web app in Chrome, the real Android TV app driven by remote keys, and a speed test against Jellyfin. |

## Watching

- **TV (Android TV / Google TV):** install *Jellyfin for Android TV* from the Play Store. Korie shows
  up under *Discovered servers* (or type `http://<nas>:8100`). Pick who's watching.
- **Phone, tablet, iPhone:** the Jellyfin app (or Infuse, Swiftfin, Findroid ...). Not checked yet.
- **Browser:** `http://<nas>:8100/web` is Jellyfin's own web app; `http://<nas>:8100` is Korie's
  pages, where an admin adds folders, people and add-ons.

## Running the server

GitHub builds the image (`ghcr.io/mightyx3n/korie:latest`, for x86 and ARM) on every push. On a
NAS, paste this into the Docker app as a project (or save it as `docker-compose.yml` and run
`docker compose up -d`). Change `/volume1/Media` to the folder with your films, series and music,
and `/volume1/docker/korie` to where Korie may keep its data:

```yaml
services:
  korie:
    image: ghcr.io/mightyx3n/korie:latest
    container_name: korie
    restart: unless-stopped
    # host networking lets TVs find Korie by themselves (UDP 7359 and 7361)
    network_mode: host
    environment:
      - TZ=Europe/Copenhagen
    volumes:
      - /volume1/docker/korie:/data
      - /volume1/Media:/media:ro
```

Then open `http://<nas>:8100` and add your folders under Settings → Libraries. To update:
`docker compose pull && docker compose up -d`.

If a Jellyfin server runs on the same NAS, it keeps UDP 7359 and its apps find only Jellyfin by
themselves; type Korie's address (`http://<nas>:8100`) once instead.

## What Jellyfin's apps get from Korie

Sign-in (Korie's people; a PIN is the password), home rows (continue watching, next up, recently
added), Films and Series with seasons and episodes, pictures, playing (the file as it is, or
converted as it plays), audio and subtitle tracks (subtitles as WebVTT when an app wants files),
progress and resume, watched, favourites, search, genres, and intros as "Skip intro" segments.
Anything else Jellyfin's apps ask for (Live TV, music, SyncPlay ...) gets an empty answer for now,
so the apps show nothing there instead of an error.

## Building

    cd client && npm ci && npm run build
    cd server && npm ci && npm start              # http://localhost:8100
    node tools/make_secret.mjs <file with a TMDb key>   # server/secret.dat, never committed
    docker build -t korie .

To serve Jellyfin's web app outside Docker, point `KORIE_JELLYFIN_WEB` at a `jellyfin-web` folder
(from any Jellyfin server release).

Add-ons are written in Lua and run sandboxed on the server: see `docs/ADDONS.md` and the
Korie-Store repository.

## Licence notes

Korie talks to Jellyfin's apps over Jellyfin's published API; it contains no Jellyfin code. The
Docker image includes Jellyfin's web app unchanged (GPL-2.0, from Jellyfin's own release), served
at `/web`.
