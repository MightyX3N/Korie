-- ZeroPlay: your Xbox through ZeroPlay (https://github.com/MightyX3N/ZeroPlay), the NAS server
-- that streams an Xbox to browsers and apps.
--
-- An Xbox tile on Home opens an Xbox section in Korie TV with the games installed on the
-- console (covers and wide pictures from ZeroPlay). Recently played games are in the carousel
-- and every game is in Search. Play starts the game and opens ZeroPlay to stream it; Start on
-- Xbox starts it on the console itself, for the TV the Xbox is connected to. The island shows
-- what the Xbox is doing.
--
-- ZeroPlay is shared by everyone on the device; the sign-in (a ZeroPlay profile) is kept per
-- Korie profile, so each person only sees the games their ZeroPlay profile may play.

-- ---------------------------------------------------------------- saved state

local function profile_id()
  return korie.profile().id
end

local function server()
  return korie.store.get("server", nil) -- { url, name }
end

local function account()
  return korie.store.get("account:" .. profile_id(), nil) -- { token, name }
end

local function show_state()
  local s, a = server(), account()
  korie.set_setting("server", s and s.name or "Not set")
  korie.set_setting("account", a and a.name or (s and "Not signed in" or ""))
end

-- ---------------------------------------------------------------- talking to ZeroPlay

-- Calls ZeroPlay's API. Returns the decoded answer, or nil and the reason (and the status).
local function call(method, path, body, timeout)
  local s = server()
  if not s then return nil, "ZeroPlay is not set up" end
  local headers = {}
  local a = account()
  if a then headers["x-zeroplay-session"] = a.token end
  local r, why = korie.http.request{
    url = s.url .. path, method = method, headers = headers, body = body, timeout = timeout or 8,
  }
  if not r then return nil, why end
  local ok, data = pcall(korie.json.decode, r.body or "")
  if not r.ok then
    local reason = ok and type(data) == "table" and data.error or ("ZeroPlay answered " .. tostring(r.status))
    return nil, reason, r.status
  end
  return ok and data or {}
end

-- A ZeroPlay at this address, or nil.
local function check(url)
  url = (string.gsub(url, "/+$", ""))
  local r = korie.http.get(url .. "/api/access", { timeout = 3 })
  if not r or not r.ok then return nil end
  local ok, data = pcall(korie.json.decode, r.body or "")
  if not ok or type(data) ~= "table" or not data.verdict then return nil end
  local host = string.match(url, "^https?://([^/:]+)") or url
  return { url = url, name = "ZeroPlay (" .. host .. ")" }
end

-- What was typed: an address with or without http:// and the port (ZeroPlay's is 8080).
local function resolve(text)
  text = (string.gsub(string.gsub(text, "^%s+", ""), "%s+$", ""))
  local url = string.find(text, "^https?://") and text or ("http://" .. text)
  if not string.match(url, "^https?://[^/]+:%d+") then
    local with_port = check((string.gsub(url, "^(https?://[^/]+)", "%1:8080")))
    if with_port then return with_port end
  end
  return check(url)
end

-- ZeroPlay answers "zeroplay?" sent to everyone on the network (UDP 7377) with its web port.
local function discover()
  local found, seen = {}, {}
  for _, reply in ipairs(korie.net.broadcast(7377, "zeroplay?", 2)) do
    local ok, info = pcall(korie.json.decode, reply.text)
    if ok and type(info) == "table" and info.port then
      local s = check("http://" .. reply.address .. ":" .. tostring(math.floor(info.port)))
      if s and not seen[s.url] then
        seen[s.url] = true
        found[#found + 1] = s
      end
    end
  end
  return found
end

-- ---------------------------------------------------------------- the library

local last -- the latest /api/library answer

local function library()
  local data, why = call("GET", "/api/library")
  if data then
    last = data
    korie.store.set("library:" .. profile_id(), data)
  end
  return data, why
end

local function known()
  return last or korie.store.get("library:" .. profile_id(), nil)
end

local function console_name(lib, id)
  for _, c in ipairs(lib and lib.consoles or {}) do
    if c.id == id then return c.name end
  end
  return "Xbox"
end

local function item(lib, g)
  return {
    id = g.id,
    key = "xbox:" .. g.id,
    type = "game",
    title = g.name,
    poster = g.image or "",
    backdrop = g.hero or g.image or "",
    overview = "On " .. console_name(lib, g.console) .. ", through ZeroPlay.",
    game = g.id,
    console = g.console,
  }
end

-- Every game, most recently played first (ZeroPlay's order).
local function games(lib)
  local out = {}
  for _, g in ipairs(lib and lib.games or {}) do out[#out + 1] = item(lib, g) end
  return out
end

-- ---------------------------------------------------------------- what Korie asks

korie.on("catalog", function()
  local lib, why = library()
  if not lib then error("no game list from ZeroPlay: " .. tostring(why)) end
  korie.update("tv")
  korie.update("island")
  return games(lib)
end)

-- The carousel: recently played games with a wide picture.
korie.on("home", function()
  local out = {}
  for _, it in ipairs(games(known())) do
    if it.backdrop ~= "" then out[#out + 1] = it end
    if #out >= 8 then break end
  end
  return out
end)

korie.on("tv.sections", function()
  return { { id = "xbox", title = "Xbox", icon = "game" } }
end)

korie.on("tiles", function()
  return { { id = "xbox", title = "Xbox", icon = "game", colors = { "#1DB21D", "#0B4F0B" }, section = "xbox" } }
end)

local function by_title(list)
  local copy = {}
  for i, it in ipairs(list) do copy[i] = it end
  table.sort(copy, function(a, b) return string.lower(a.title) < string.lower(b.title) end)
  return copy
end

korie.on("tv", function(page)
  local all = games(known())
  if #all == 0 then return nil end
  if page == "home" then
    -- A row of the Xbox's recent games on Korie TV's own Home.
    local recent = {}
    for i = 1, math.min(12, #all) do recent[i] = all[i] end
    return { rows = { { title = "On Your Xbox", items = recent } } }
  end
  if page ~= "xbox" then return nil end
  local featured, recent = {}, {}
  for _, it in ipairs(all) do
    if it.backdrop ~= "" and #featured < 6 then featured[#featured + 1] = it end
  end
  for i = 1, math.min(12, #all) do recent[i] = all[i] end
  return {
    featured = featured,
    rows = {
      { title = "Recently Played", items = recent },
      { title = "All Games", items = by_title(all) },
    },
  }
end)

korie.on("similar", function(it)
  if it.type ~= "game" then return nil end
  local out = {}
  for _, other in ipairs(games(known())) do
    if other.id ~= it.id then out[#out + 1] = other end
    if #out >= 12 then break end
  end
  return out
end)

korie.on("detail", function(it)
  return {
    buttons = {
      { id = "play", label = "Play", sub = "Stream it with ZeroPlay" },
      { id = "xbox", label = "Start on Xbox", sub = "On the TV the Xbox is connected to" },
    },
  }
end)

-- Opens ZeroPlay in the browser, signed in as this profile (the sign-in travels after the #,
-- which never leaves the device), on the stream when `console` is given.
local function open_zeroplay(console)
  local s = server()
  if not s then return end
  local url = s.url .. "/"
  if console then url = url .. "?play=1&console=" .. console end
  local a = account()
  if a then url = url .. "#session=" .. a.token end
  if not korie.open{ url = url } then
    korie.ask{ title = "ZeroPlay", message = "No browser opened " .. s.url .. ". Install a browser on this device, or open that address on another one." }
  end
end

local function launch(it, stream)
  local _, why, status = call("POST", "/api/launch", { console = it.console, game = it.game, stream = stream }, 10)
  if why then
    if status == 401 then why = "Sign in to ZeroPlay first (Settings › Add-ons › ZeroPlay)." end
    korie.ask{ title = it.title, message = "Could not start the game: " .. tostring(why) }
    return false
  end
  return true
end

korie.on("action", function(it, button)
  if it.type ~= "game" then return end
  if button == "xbox" then
    if launch(it, false) then korie.toast("Starting " .. it.title .. " on the Xbox") end
  else
    if launch(it, true) then open_zeroplay(it.console) end
  end
end)

-- The island: what the Xbox is doing.
korie.on("island", function()
  local lib = known()
  if not lib then return nil end
  local s = lib.stream or {}
  if s.state == "live" or s.state == "starting" then
    return {
      title = s.title or s.consoleName or "Xbox",
      sub = s.state == "live" and ("Streaming from " .. (s.consoleName or "the Xbox")) or "Starting the stream",
    }
  end
  for _, c in ipairs(lib.consoles or {}) do
    if c.power == "On" then return { title = c.name, sub = "Xbox is on" } end
  end
  return nil
end)

korie.on("island.ok", function()
  local lib = known()
  local s = lib and lib.stream or {}
  open_zeroplay(s.console)
end)

-- ---------------------------------------------------------------- settings

local buttons = {}

local function use_server(s)
  local old = server()
  korie.store.set("server", s)
  if not old or old.url ~= s.url then -- another ZeroPlay: its sign-ins don't apply here
    for _, p in ipairs(korie.profiles.list()) do
      korie.store.remove("account:" .. p.id)
      korie.store.remove("library:" .. p.id)
    end
    last = nil
  end
  show_state()
  korie.refresh()
end

function buttons.server()
  local s = server()
  local choices = { "Find on this network", "Type the address" }
  if s then choices[#choices + 1] = "Forget " .. s.name end
  local pick = korie.ask{ title = s and s.name or "ZeroPlay", choices = choices }
  if pick == 1 then
    korie.toast("Looking for ZeroPlay…")
    local found = discover()
    if #found == 0 then
      korie.ask{ title = "ZeroPlay", message = "No ZeroPlay answered on this network. If it is somewhere else, or the network blocks the search, type its address instead." }
      return
    end
    local chosen = found[1]
    if #found > 1 then
      local names = {}
      for i, f in ipairs(found) do names[i] = f.name end
      local which = korie.ask{ title = "Which ZeroPlay?", choices = names }
      if not which then return end
      chosen = found[which]
    end
    use_server(chosen)
    korie.toast("Found " .. chosen.name)
    buttons.account()
  elseif pick == 2 then
    local text = korie.ask{ title = "ZeroPlay address", message = "The address of the NAS or computer ZeroPlay runs on, for example 192.168.1.20 (port 8080 is added), or its playit address.", input = "text", value = s and s.url or "" }
    if not text or text == "" then return end
    korie.toast("Looking for ZeroPlay…")
    local found = resolve(text)
    if not found then
      korie.ask{ title = "ZeroPlay", message = "No ZeroPlay answered at " .. text .. "." }
      return
    end
    use_server(found)
    buttons.account()
  elseif pick == 3 and s then
    korie.store.remove("server")
    for _, p in ipairs(korie.profiles.list()) do
      korie.store.remove("account:" .. p.id)
      korie.store.remove("library:" .. p.id)
    end
    last = nil
    show_state()
    korie.refresh()
  end
end

function buttons.account()
  if not server() then
    korie.ask{ title = "ZeroPlay", message = "Set ZeroPlay first." }
    return
  end
  local a = account()
  if a then
    local pick = korie.ask{ title = "Signed in as " .. a.name, choices = { "Sign in as someone else", "Sign out" } }
    if pick == 2 then
      korie.store.remove("account:" .. profile_id())
      korie.store.remove("library:" .. profile_id())
      last = nil
      show_state()
      korie.refresh()
      return
    elseif pick ~= 1 then
      return
    end
  end
  -- Before anyone has a ZeroPlay profile, ZeroPlay needs no sign-in at home.
  local access = call("GET", "/api/access")
  if access and access.verdict == "ok" and not a then
    korie.toast("ZeroPlay needs no sign-in here")
    korie.refresh()
    return
  end
  local name = korie.ask{ title = "ZeroPlay profile", input = "text", value = korie.profile().name }
  if not name or name == "" then return end
  local password = korie.ask{ title = "Password for " .. name, input = "password" }
  if not password then return end
  local data, why = call("POST", "/api/login", { name = name, password = password })
  if not data or not data.token then
    korie.ask{ title = "ZeroPlay", message = "Could not sign in: " .. tostring(why or "no answer") }
    return
  end
  korie.store.set("account:" .. profile_id(), { token = data.token, name = name })
  show_state()
  korie.toast("Signed in to ZeroPlay as " .. name)
  korie.refresh()
end

korie.on("button", function(key)
  if buttons[key] then buttons[key]() end
end)

korie.on("profile", function()
  last = nil
  show_state()
  korie.refresh()
  korie.update("tiles")
end)

-- Keep the island and the Xbox section current while Korie runs.
korie.timer(60, function()
  if server() and library() then
    korie.update("island")
  end
end, true)

show_state()
