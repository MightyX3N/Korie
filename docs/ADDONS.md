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
  "hosts_from_settings": false, "hosts_from_account": false, "games": false,
  "accounts": { "who": "house", "label": "Example account", "profiles": true, "help": "Shown above the sign-in.",
                "fields": [{ "key": "email", "label": "E-mail", "type": "text" }, { "key": "password", "label": "Password", "type": "password" }] },
  "settings": [
    { "key": "server", "label": "Server", "type": "text", "help": "Like 192.168.1.20:8080" },
    { "key": "films", "label": "Films", "type": "toggle", "help": "Its films in Films", "default": true },
    { "key": "quality", "label": "Picture", "type": "choice", "options": [["best", "Best"], ["save", "Save data"]], "default": "best" }
  ]
}
```

- `permissions: ["internet"]`: an admin is asked before the add-on may fetch anything.
- `hosts`: the only places it may fetch from (https).
- `hosts_from_settings`: it may also fetch from the addresses an admin typed into its
  settings (http too, for servers at home). Passwords never count as addresses.
- `hosts_from_account`: it may also fetch from the hosts its `login()` kept in the account's
  data as `hosts` (Stremio: the add-ons in each person's Stremio account).
- `settings`: `text`, `password` (shown as dots), `list` (several values), `toggle` (on/off,
  drawn under "What shows up") or `choice` (`options` as `[value, label]`, drawn as buttons).
  `default` is what it is until an admin changes it.
- `accounts`: the add-on signs in to a service. `who: "house"` is one account for everyone; with
  `profiles: true` each person in Korie uses one of the account's profiles (DR). `who: "person"`
  is an optional account per person (Stremio): someone who signed in gets their own view, everyone
  else the house's. `ctx.house` is the house's own data (Stremio: the add-ons added for everyone),
  kept with `save_account` from a call made without a person's account. An admin signs in on the add-on's page; Korie never keeps the password, only what
  `login()` returns.
- `games: true`: the add-on has games; Korie shows Games in the menu when it's on.

## Functions

`main.lua` returns a table of functions. Every function gets `ctx` with `now` (seconds
since 1970), `language` and `settings`, and with accounts: `account` (what `login()` kept),
`person` (`{ id, name }`, who it's for) and, for a house account with profiles, `profile`
(`{ id, name, kid }`, the profile that person uses).

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

With accounts:

```lua
function A.login(fields, ctx)   -- fields: what the admin typed (fields in addon.json)
  return { account = { name = "who@example.com", data = { token = "..." } },
           profiles = { { id = "1", name = "Far", kid = false } } }   -- or { error = "why not" }
end
function A.mine(ctx)            -- a house account: the rows of the person's own profile
  return { rows = { row } }     -- (Continue watching, My list), first on their Home
end
function A.progress(item, p, ctx)  -- p = { position, duration (seconds), watched, stopped }:
  return { ok = true }             -- what they watch in Korie, back to the service (once a minute)
end
function A.about(ctx)           -- for the admin page: what it says about this account, and
  return { sections = { { title = "...", text = "...",
             items = { { title = "...", subtitle = "...", remove = { call = "remove_thing", value = "...", label = "Remove" } } },
             add = { call = "add_thing", label = "Add one", placeholder = "https://...", help = "..." } } },
           rows = { { id = "row id", title = "...", section = "films" } } }  -- rows an admin may hide
end
function A.add_thing(value, ctx)   -- what an admin typed (an address there may be fetched for this call)
  return { ok = true }             -- or { error = "why not" }; remove_thing gets the item's value
end
```

Lua has no empty list, only an empty table: an empty JSON list arrives as `{ __array = true }`
(`#t` is 0 and `ipairs` works) and leaves as `[]` again; write `{ __array = true }` yourself for
an empty list a service needs. Any answer may carry `save_account = { ... }`: Korie merges it into the account's data (one
level deep), so fresh tokens are kept. The `korie` table has helpers: `korie.sha256(s)`,
`korie.sha256_b64url(s)`, `korie.random(n)`, `korie.uuid()`, `korie.base64(s)`,
`korie.unbase64(s)`, `korie.urlencode(s)`, `korie.json(v)` and `korie.unjson(s)`.

Live channels and rows: an admin can hide channels, put them in another order and test that they
play, and hide rows `about()` lists, on the add-on's page. Keep row ids the same from one
`browse()` to the next so that sticks.

An item is `{ id, kind = "film" | "series" | "episode" | "live" | "page" | "game", title,
subtitle, year, runtime, overview, poster, backdrop, thumb, genres, rating, director, cast, data }`.
`data` comes back unchanged when the item is opened or played. Give `cert` (an age rating
such as `"DK 11"`, `"PG-13"` or `"15"`) or `age` (a number) when you know it: people with an
age limit then only see what's rated for them. Items without one are shown to everyone who may
use the add-on. Korie checks everything an
add-on returns: wrong shapes are left out and noted in the add-on's log (Store → the add-on).

Rows and pages are your categories. Each row of films or series ("Julefilm", "Krimi") and each
page ("Dokumentar") becomes a genre in Jellyfin's apps, a row of its own under Genres; Korie reads
your pages one after the other in the background to learn what's in them, so the films and series
only found inside a page are in Films and Series too. A row that's a taste of a bigger category
gives way to it, and an A-Z index or a row with nearly everything in it is left out. Without any
categories, an item's own `genres` are used.

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
failed. A table `body` is sent as JSON; `form = { ... }` sends a form instead. `as` is
`"json"`, `"text"` or `"full"`: `{ status, ok, url, text, json }`, for when the status matters
(a wrong password) or to see where redirects ended. `cookies = true` keeps cookies between the
fetches of one sign-in, as a browser would.

## The Store

The Korie Store is github.com/MightyX3N/korie-store: an add-on goes in `addons/<id>/`, then
`python3 tools/build_index.py` writes `index.json` with every file's sha256.
