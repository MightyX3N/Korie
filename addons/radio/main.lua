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
  return out
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
