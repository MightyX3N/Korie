# Checking Korie against Jellyfin's apps

Korie answers Jellyfin's API so Jellyfin's own apps work with it. These checks prove that with the
apps' own code and with numbers, not by looking at screenshots.

| Check | What it does |
| --- | --- |
| `flow.py <url> <user> <password> <outdir>` | Goes through what the Android TV app does (sign in, home, films, a film, playback info, playing, progress, resume, series, seasons, episodes, watched, next up, favourites, intro segments, search, subtitles), the way its SDK sends it, and reads every answer with the **real Jellyfin Kotlin SDK** the app uses (`Check.java`). An answer the app couldn't read fails. Run `get_sdk.sh` once first (needs Java). |
| `addons.py <url> <user> <password> <outdir>` | Checks that the add-ons' content reaches Jellyfin's apps, read with the same SDK: add-on films in Films, series with seasons, episodes and pictures, categories in Series, channels in Live TV, playing, resume, favourites and search. Needs the DRTV and Free Films add-ons turned on. |
| `web.mjs <url> <user> <password> <outdir>` | Uses **Jellyfin's own web app** (served by Korie at `/web`) in Chrome: signs in, opens Films, a film, plays it (checks the video's time moves), opens Series, a season. Lists every failed request and script error. Needs `npm i puppeteer-core` and Chrome (`CHROME=`). |
| `atv.py <outdir> <keys...>` | Drives the **real Jellyfin Android TV app** in an emulator with remote keys only (UP DOWN LEFT RIGHT OK BACK, `slow:<text>`, `wait:<s>`, `shot:<name>`) and writes down which element has focus after every press, from Android's own accessibility tree. Needs `adb` (`ADB=`). |
| `speed.py korie\|jellyfin` | Adds 1000 films and 50 series (`BIG=` folder with `Films/` and `Series/`) and measures how long until Jellyfin's apps can list them all, and how long opening one to play takes. |

Results on 16 November 2026 (Jellyfin 12.4 as the comparison, same machine, same files):

- `flow.py`: 38 of 38 steps pass on Korie and on Jellyfin.
- `addons.py`: 34 of 35 steps pass. DRTV's films, series, categories and search work; Free Films
  plays. DR's live channels can't play from outside Denmark (DR answers 403), so that step fails
  here; Korie now tells the app the stream couldn't start instead of sending an empty video.
- `web.mjs`: everything opens and plays on Korie; no failed requests or script errors.
- `atv.py`: Jellyfin Android TV 0.20.0 signs in to Korie, shows home, films, series, seasons and
  episodes, plays (file as it is, and converted), resumes where you stopped. Up from a row goes to
  the row above first, then the menu bar; every item of the menu bar is reached in order.
- `speed.py`: Korie lists 1000 films and 50 series 0.2 s after the folders are added (opening a
  film to play: 81 ms). Jellyfin 12.4 needed 4 min 29 s for the same folders.
