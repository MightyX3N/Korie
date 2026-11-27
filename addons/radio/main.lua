-- Radio: stations of one country from the Radio Browser directory (https://www.radio-browser.info,
-- a free community directory; its API may be used by any software).
-- The whole list is the add-on's catalog, so Korie saves it and Search finds stations at once,
-- also before the internet is up.

local API = "https://all.api.radio-browser.info"

-- The chosen country, or the device's own when none is chosen yet.
local function country()
  local c = korie.setting("country")
  if c and c ~= "" then return c end
  local region = string.match(korie.device().language or "", "%-(%a%a)$")
  return region and string.upper(region) or "US"
end

local function trim(s)
  return (string.gsub(string.gsub(s or "", "^%s+", ""), "%s+$", ""))
end

korie.on("catalog", function()
  -- Without a connection http returns nil and the reason; failing here keeps the saved list.
  local r, why = korie.http.get(API .. "/json/stations/search?countrycode=" .. country()
    .. "&hidebroken=true&order=clickcount&reverse=true&limit=300")
  if not r then error("no station list: " .. tostring(why)) end
  if not r.ok then error("the station list answered " .. tostring(r.status)) end
  local out = {}
  for _, s in ipairs(korie.json.decode(r.body)) do
    local name = trim(s.name)
    if name ~= "" and s.url_resolved and s.url_resolved ~= "" then
      out[#out + 1] = {
        id = s.stationuuid, type = "radio", title = name,
        poster = s.favicon or "", genres = trim(s.tags), url = s.url_resolved,
      }
    end
  end
  -- Kept for Korie TV's Radio section, which is built from the same list.
  korie.store.set("stations", out)
  korie.update("tv")
  return out
end)

-- Korie TV: a Radio section in the sidebar, and a Radio tile on Home that opens it.
korie.on("tv.sections", function()
  return { { id = "radio", title = "Radio", icon = "radio" } }
end)

korie.on("tiles", function()
  return { { id = "radio", title = "Radio", icon = "radio", colors = { "#E0533D", "#8E2418" }, section = "radio" } }
end)

local function nice(tag)
  return (string.gsub(tag, "^%l", string.upper))
end

-- The section: the most listened stations, then a row for each of the biggest kinds of music.
korie.on("tv", function(page)
  if page ~= "radio" then return nil end
  local stations = korie.store.get("stations", {})
  local rows = {}
  local top = {}
  for i = 1, math.min(20, #stations) do top[i] = stations[i] end
  if #top > 0 then rows[1] = { title = "Most Listened", style = "square", items = top } end
  local count, order = {}, {}
  for _, s in ipairs(stations) do
    for raw in string.gmatch(string.lower(s.genres or ""), "[^,]+") do
      -- (Lua 5.5: a loop's own variable cannot be changed, so the trimmed tag gets its own name)
      local tag = trim(raw)
      if tag ~= "" then
        if not count[tag] then count[tag] = {}; order[#order + 1] = tag end
        table.insert(count[tag], s)
      end
    end
  end
  table.sort(order, function(a, b) return #count[a] > #count[b] end)
  for i = 1, math.min(8, #order) do
    local tag = order[i]
    if #count[tag] >= 4 then
      local items = {}
      for j = 1, math.min(20, #count[tag]) do items[j] = count[tag][j] end
      rows[#rows + 1] = { title = nice(tag), style = "square", items = items }
    end
  end
  return { rows = rows }
end)

korie.on("detail", function(station)
  return { buttons = { { id = "play", label = "Play" } } }
end)

local function play(station)
  korie.play({ url = station.url, title = station.title, audio = true, ref = station.id })
end

korie.on("action", function(station, button)
  play(station)
  korie.store.set("last", { id = station.id, title = station.title, url = station.url })
  -- The directory asks players to count a click when a station is started.
  pcall(korie.http.get, API .. "/json/url/" .. station.id)
end)

-- A new country means a new list.
korie.on("setting", function(key)
  if key == "country" then korie.refresh() end
end)

-- "Start the last station when Korie starts": some devices (car boxes) take a minute to get
-- online, so wait for the internet, trying every 5 seconds for up to 3 minutes.
local function start_last(tries)
  local last = korie.store.get("last")
  if not last then return end
  local ok, r = pcall(korie.http.request, { url = API .. "/json/stats", timeout = 4 })
  if ok and r and r.ok then
    play(last)
  elseif tries > 0 then
    korie.timer(5, function() start_last(tries - 1) end)
  end
end

if korie.setting("autostart") then
  korie.timer(1, function() start_last(36) end)
end
