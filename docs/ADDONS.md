# Writing Korie add-ons

An add-on is a folder named after its id with an `addon.json` and Lua 5.4 code. It runs
on the Korie server in a sandbox: only `base`, `string`, `table`, `math` and `utf8`; no
files, no `os`, no loading code; each call has a time limit (3 s) and the add-on a memory
limit (64 MB). Errors stop the add-on's call, never Korie.

## addon.json

```json
{
  "id": "example.channel", "name": "Example", "type": "content", "version": "1.0.0",
  "author": "You", "description": "What it adds, in plain words.", "main": "main.lua",
  "access": "sandbox", "permissions": ["internet"], "hosts": ["api.example.com", "*.example-cdn.com"],
  "hosts_from_settings": false, "games": false,
  "settings": [{ "key": "server", "label": "Server", "type": "text", "help": "Like 192.168.1.20:8080" }]
}
```

- `permissions: ["internet"]`: an admin is asked before the add-on may fetch anything.
- `hosts`: the only places it may fetch from (https).
- `hosts_from_settings`: it may also fetch from the addresses an admin typed into its
  settings (http too, for servers at home). Passwords never count as addresses.
- `settings`: `text`, `password` (shown as dots) or `list` (several values).
- `games: true`: the add-on has games; Korie shows Games in the menu when it's on.

## Functions

`main.lua` returns a table of functions. Every function gets `ctx` with `now` (seconds
since 1970), `language` and `settings`.

```lua
local A = {}
function A.browse(ctx)       -- rows for Korie's sections (kept on the server, asked again every 30 min)
  return { home = { row }, films = { row }, series = { row }, games = { row }, live = { item, ... } }
end                          -- a row is { id = "...", title = "...", items = { item, ... } }
function A.page(item, ctx)   -- an item of kind "page" (a category): its own rows
  return { title = "...", rows = { row } }
end
function A.search(q, ctx) return { items = { item } } end
function A.open(item, ctx)   -- a series: its seasons and episodes
  return { seasons = { { n = 1, title = "", episodes = { { id = "...", n = 1, title = "...", overview = "", still = "https://...", data = {} } } } } }
end
function A.play(item, ctx)
  return { url = "https://...", live = false, subtitles = { { url = "https://....vtt", title = "Dansk", language = "da", default = true } } }
  -- or { web = "https://..." }: a web page full screen (RomM's game player)
  -- or { error = "why it can't be played" }
end
return A
```

An item is `{ id, kind = "film" | "series" | "episode" | "live" | "page" | "game", title,
subtitle, year, runtime, overview, poster, backdrop, thumb, genres, rating, director, cast, data }`.
`data` comes back unchanged when the item is opened or played. Korie checks everything an
add-on returns: wrong shapes are left out and noted in the add-on's log (Store → the add-on).

Streams play through the server: it repackages or converts them with FFmpeg when a device
can't play them as they are, so an add-on only says where the stream is.

## Fetching

Instead of an answer, a function may ask Korie to fetch and call it back:

```lua
return { fetch = "https://api.example.com/x", as = "json", next = "got_x", state = { page = 1 },
         method = "GET", headers = { Authorization = "..." }, body = nil, cache = 600 }
```

`fetch` may be a list (of addresses, or of tables with `url`, `as`, `method`, `headers`,
`body`); they're fetched together and `next` gets a list of answers, `false` for one that
failed. A table `body` is sent as JSON.

## The Store

The Korie Store is github.com/MightyX3N/korie-store: an add-on goes in `addons/<id>/`, then
`python3 tools/build_index.py` writes `index.json` with every file's sha256.
