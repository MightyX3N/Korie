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
| `next` | ref | The player wants what comes after the one it is showing (Next Episode was pressed, or it ended with `autonext`). Start it with `korie.play{...}`; it takes over the open player. |
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
| `korie.browse{url=, fullscreen=, title=}` | Opens a web page in Korie's own browser. `fullscreen = true`: only the page, with every key and a game controller going to the page itself (a game stream plays with them); Back on the remote closes it, Home keeps it running in the background, where Korie shows it in the island (OK opens it again, holding OK closes it; Settings › Background limits how many and for how long); `title` shows in the hint at the top for a few seconds. Otherwise the page opens as a new tab in the Browser, among the viewer's tabs. Returns `true`; Korie before 2.4 has no `korie.browse`, so check for it (`if korie.browse then ... end`). |
| `korie.ask{title=, message=, choices={...}, input="text" or "password", value=}` | A question on screen, in a system dialog that works with a remote and by touch. Waits for the answer and returns the number of the chosen entry, the typed text, `true` for a plain message, or `nil` when cancelled. With a `message`, up to three `choices` become the dialog's buttons. |
| `korie.net.broadcast(port, message, seconds)` | Sends one UDP message to everything on the local network and returns the answers as `{ {address, text} }`: how a server on the home network is found without typing its address. Needs `internet`. |
| `korie.profile()` · `korie.profiles.list()` · `korie.profiles.add(name)` | The current Korie profile `{id, name}` · all of them · make one (returns it, or `nil` and the reason when Korie is full). |
| `korie.toast(text)` · `korie.log(...)` | A short message on screen · a line in the add-on's log (`adb logcat -s KorieAddon`). |
| `korie.timer(seconds, fn, repeat)` / `korie.cancel(id)` | Timers. |
| `korie.device()` | `{tv, touch, android, model, language, korie}` |
| `korie.addon` | `{id, name, version, dir}` |
| `korie.json.decode(text)` / `korie.json.encode(value)` | JSON. |

Each add-on runs in its own isolate with real Lua 5.5 and its safe standard library (no `io`,
`os.execute` or `debug`), and can only `require` files from its own folder. Lua that runs for 6
seconds without waiting for anything is stopped and the add-on started again. Time the viewer
spends answering a `korie.ask` does not count against an answer's time limit.

## Testing

`flutter test test/addons_test.dart` runs this folder's add-ons on Korie's real add-on host (real
Lua, real internet, a fake Jellyfin server) and checks what they answer.

## Korie 2: more places to add to

Every place an add-on can add to is a name for `korie.on`; Korie asks every add-on that answers
it and shows the answers in its own look.

| Name | Arguments | Return |
|---|---|---|
| `setup` | | A page for Korie's setup, or nothing when there is nothing to set up: `{id, title, message, rows = { {id, title, sub, value, check} }}`. |
| `setup.choose` | page id, row id | The next page, `"done"`, or nothing to show the same page again. Ask what you need with `korie.ask` meanwhile. |
| `users` | | People who can be Korie profiles: `{ {id, name, detail} }` (a Jellyfin server's users). Setup offers them in Who Uses Korie, and Link Profiles puts people with the same name together across add-ons. |
| `signedin` | profile, user | Whether that Korie profile is signed in as that user. When not, picking the profile shows Korie's password screen. |
| `signin` | profile, user, password | `true`, or the reason as text ("Wrong password."). The password is any text. |
| `island` | | What to show in the top-right island: `{title, sub, image, playing}`. `playing` true or false gives it a play/pause button. |
| `island.ok` / `island.hold` / `island.toggle` | | OK on it, holding OK on it, its play/pause button. |

| Function | Does |
|---|---|
| `korie.update(what)` | Something the add-on shows changed: `"island"` or `"home"` makes Korie ask again now. |
| `korie.profiles.add(name)` | As before; a profile can also be linked to an add-on's user in setup or by holding OK on it in Who's Watching. |

The `uses` list can also hold `location`, `profiles` and `media`; the install question explains each.

## Korie TV

Korie TV is one tile on Home that opens a place for everything add-ons give to watch, like Apple's
TV app: a sidebar (Search, Home, Movies, Series, then sections add-ons add), a featured picture at
the top of each page and rows below it. A simple add-on fills it without doing anything new:

- its `catalog` gives Movies and Series (Recently Added, one row per genre) and the featured
  pictures (the newest titles with a `backdrop`); items of other types (`"radio"`…) stay out of
  those pages and are found in Search;
- its `home` answer is Korie TV's Continue Watching row (OK plays straight away, holding OK
  opens the title's page);
- a title's page shows the `detail` buttons, seasons and `episodes`, and More Like This
  (titles sharing genres, or the add-on's `similar` answer).

These item fields are shown when they are there: `runtime` (minutes), `official` (age rating,
"15"), `ends` (the year a series ended), `rating`, `genres` (text with commas, or a list).

To add more:

| Name | Arguments | Return |
|---|---|---|
| `tv` | page | Extra for a page: `{ featured = {items}, rows = { {title=, items={...}, style=} } }`. `page` is `"home"`, `"movies"`, `"series"` or the id of one of the add-on's own sections. `style` is `"poster"` (tall, the default), `"wide"` or `"square"` (logos, with the name under them; OK plays at once). |
| `tv.sections` | | The add-on's own sections in the sidebar, under "From your add-ons": `{ {id, title, icon} }`. `icon` is one of `live`, `radio`, `music`, `film`, `tv`, `star`, `sport`, `kids`, `news`, `podcast`, `book`, `game`, `list`. Korie asks `tv` with the section's id for what it shows. |
| `tiles` | | The add-on's own tiles on Home: `{ {id, title, image, icon, colors = {"#E0533D", "#8E2418"}, section} }`. A tile with `section` opens Korie TV at that section; otherwise OK on it calls `tile` with its id. `image` (a web address or a file in the add-on's folder) fills the whole tile; without one it shows the icon and title on the colours. Tiles can be moved and hidden like apps. |
| `tile` | id | OK on a tile without a `section`. |
| `similar` | item | Items for the title page's More Like This. |

`korie.update("tv")` makes an open Korie TV page ask again; `korie.update("tiles")` refreshes the tiles.
The Radio add-on is the example: a Radio section (Most Listened, then a row per kind of music) and a
Radio tile that opens it.

## Settings of type `action`

`{ "key": "account", "title": "Signed in as", "type": "action" }` is a row that does something
instead of holding a value. Pressing it calls the add-on's `button` handler with the key; the
add-on asks what it needs with `korie.ask`. Whatever the add-on puts there with
`korie.set_setting(key, text)` is shown beside the title ("Signed in as:  Bob"). The Jellyfin
add-on is the example: finding the server, signing in and making profiles are all `action` rows.

## Skip and next in the player

`korie.play{...}` can also carry:

- `segments = { {type="intro", start=5, ["end"]=60}, ... }`: parts in seconds. `intro` and `recap` get a
  "Skip Intro" / "Skip Recap" button while they play; `credits` is the cue for "Next Episode".
- `next = {title="S1 E3 · Name", series=, image=, overview=}`: there is something after this. When this
  ends, the Next Up screen shows it, and the `next` event asks the add-on to start it.
- `autonext = true`: the Next Up screen counts down 7 seconds and then starts it.

The Skip button sits bottom right and never takes the focus: while it shows and the controls do not,
OK presses it; on a touch screen it is tapped.

A `detail` answer for a series can carry `focus = {season=, episode=}`: the page opens on that season
with the focus on that episode.
