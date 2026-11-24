# Add-ons (Korie)

An add-on is a small Lua program that gives Korie **content and actions**: titles for Search and
the carousel, what a title's buttons do, a series' seasons and episodes. Korie owns every screen;
an add-on never draws one, so everything an add-on provides works with a remote and by touch
without the add-on doing anything for it.

`addons/openfilms` is the smallest complete example.

## Package

A folder with `addon.json` and `main.lua`, zipped and named `<id>.korie`
(`python3 tools/pack-addons.py` packs every folder in `addons/` into `addons/dist/` and writes
`addons/index.json`, the list Settings → Add-ons reads from the repository).

```json
{
  "id": "openfilms",
  "name": "Open Films",
  "version": "1.0",
  "author": "Korie",
  "description": "Shown in the install question.",
  "uses": ["internet"],
  "icon": "icon.png"
}
```

- `id`: lowercase letters, digits, dots, dashes; the folder has the same name.
- `uses`: `internet` for `korie.http` and for playing web addresses, `apps` for `korie.open` and `korie.apps`.
  What is not listed is refused. The install question shows the list.
- `icon` (optional): a picture in the folder, shown on the add-on's button and on its posters.

## Settings

List them in `addon.json`; they appear in Settings → Add-ons → the add-on, and `korie.setting(key)`
reads them. When one changes the add-on hears `korie.on("setting", function(key, value) end)`.

```json
"settings": [
  { "key": "country", "title": "Country", "type": "choice",
    "options": [ { "value": "DK", "label": "Denmark" }, { "value": "SE", "label": "Sweden" } ] },
  { "key": "autostart", "title": "Start the last station when Korie starts", "type": "toggle", "default": false },
  { "key": "server", "title": "Server address", "type": "text" }
]
```

## Installing

Settings → Add-ons: **From the Download folder** (any `.korie` file there), **From the Korie
add-on list**, or open a `.korie` file from a file manager and choose Korie. Every way ends in the
same question: what the add-on is, who made it and what it can use.

## Questions Korie asks

Register a function for each question the add-on can answer: `korie.on(name, fn)`.

| Name | Arguments | Return |
|---|---|---|
| `catalog` | | The add-on's **whole list** of items. Korie saves it on the device, searches it there (instantly, and without internet) and refreshes it every 6 hours. Use this when the list can be fetched whole. |
| `search` | text | Items for that text. For sources too big to list; asked on every search, after typing pauses. Not asked when the add-on answers `catalog`. |
| `home` | | Up to 8 items for the carousel; each needs a `backdrop`. An item that was started can carry `progress` (0 to 1) and `remaining` (minutes): the carousel then says "18 min left" and its button reads Resume. |
| `detail` | item | `{ buttons = { {id, label, sub} }, seasons = { {id, name} } }` — what the title's page shows for this add-on. A film gives buttons (Play; Resume with `sub = "42 min left"`); a series gives seasons. Without a `detail` function there is one Play button. |
| `episodes` | item, season id | `{ {id, title, thumb, overview, progress} }` for the row of episodes. |
| `playback` | ref, info | Korie's player reports on what `korie.play` started: `info = {state, position, duration}` in seconds; `state` is `"playing"` (every 10 seconds), `"paused"`, `"stopped"` (the viewer left) or `"ended"`. Save the position, or pass it on to a server. |
| `button` | key | A settings row of type `action` was pressed (see Settings). |
| `profile` | profile | Home switched to another profile: `{id, name}`. Add-ons that keep one sign-in per profile follow it. |
| `action` | item, button id | A button was chosen — or an episode, which arrives as the item with the button id `"play"`. Do it: `korie.play{...}`, `korie.open{...}`. |

An **item** is a table. Korie reads these fields and hands the whole table back unchanged, so keep
whatever else you need in it (ids, stream addresses):

`title` (required) · `type` (`"movie"` or `"series"`) · `year` · `overview` · `genres` · `rating` ·
`poster` · `backdrop` (web addresses, or files in the add-on's folder: `korie.addon.dir .. "/x.jpg"`) ·
`added` (when the source got it, as text that sorts by date, for the Recently Added row) ·
`key` — an id shared between add-ons, such as `"tmdb:603"`. Items with the same `key` from different
add-ons become **one** title in Search with one button per add-on ("How to Watch"). With one
add-on the page shows that add-on's buttons directly.

Answers must come within 8 seconds (`catalog`: 60).

## Functions

| Function | Does |
|---|---|
| `korie.http.get(url, opts)` / `.post(url, body, opts)` / `.request{url=, method=, headers=, body=}` | Returns `{status, ok, body, headers}`; `opts` may hold `headers` and `timeout` (seconds). Decode JSON with `korie.json.decode(r.body)`. Without a connection it returns `nil` and the reason. |
| `korie.store.get(key, default)` / `.set(key, value)` / `.remove(key)` | Saved values (tables are fine), private to the add-on. |
| `korie.setting(key)` / `korie.set_setting(key, value)` | The add-on's settings (see Settings below). |
| `korie.refresh()` | Fetch the `catalog` again now, for example after a setting changed what it should hold. |
| `korie.play{url=, title=, start=, audio=, mime=, headers=, ref=}` | Plays in Korie's own player. Video opens the player screen (`start` in seconds). `audio = true` plays sound in the background and shows the now-playing pill on Home. `ref` is any value; it comes back with every `playback` report. |
| `korie.stop()` | Stops background sound. |
| `korie.open{...}` / `korie.apps.list()` / `korie.apps.open(pkg)` | Opens a link or an app. |
| `korie.ask{title=, message=, choices={...}, input="text" or "password", value=}` | A question on screen, in a system dialog that works with a remote and by touch. Waits for the answer and returns the number of the chosen entry, the typed text, `true` for a plain message, or `nil` when cancelled. With a `message`, up to three `choices` become the dialog's buttons. |
| `korie.net.broadcast(port, message, seconds)` | Sends one UDP message to everything on the local network and returns the answers as `{ {address, text} }`: how a server on the home network is found without typing its address. Needs `internet`. |
| `korie.profile()` · `korie.profiles.list()` · `korie.profiles.add(name)` | The current Korie profile `{id, name}` · all of them · make one (returns it, or `nil` and the reason when Korie is full). |
| `korie.toast(text)` · `korie.log(...)` | A short message on screen · a line in the add-on's log (`adb logcat -s KorieAddon`). |
| `korie.timer(seconds, fn, repeat)` / `korie.cancel(id)` | Timers. |
| `korie.device()` | `{tv, touch, android, model, language, korie}` |
| `korie.addon` | `{id, name, version, dir}` |
| `korie.json.decode(text)` / `korie.json.encode(value)` | JSON. |

Each add-on runs on its own thread with the Lua standard library (no `io`, `os.execute` or
`debug`), and can only `require` files from its own folder.

## Testing

`bash tools/addon-test/run.sh` runs the add-ons' Lua on the computer with a fake Korie and checks
what they answer.

## Settings of type `action`

`{ "key": "account", "title": "Signed in as", "type": "action" }` is a row that does something
instead of holding a value. Pressing it calls the add-on's `button` handler with the key; the
add-on asks what it needs with `korie.ask`. Whatever the add-on puts there with
`korie.set_setting(key, text)` is shown beside the title ("Signed in as:  Bob"). The Jellyfin
add-on is the example: finding the server, signing in and making profiles are all `action` rows.
