-- Jellyfin: films and series from the user's own Jellyfin server.
--
-- The server is shared by everyone on the device; the sign-in is kept per Korie profile, so each
-- profile is its own Jellyfin user with its own watch state. Everything goes through Jellyfin's
-- HTTP API (https://api.jellyfin.org); playback is Korie's player, and its reports are passed on
-- to the server so Continue Watching and "watched" stay right on every Jellyfin app.

local TICKS = 10000000  -- Jellyfin counts time in ticks: 10 million per second

-- ---------------------------------------------------------------- saved state

local function profile_id()
  return korie.profile().id
end

local function server()
  return korie.store.get("server", nil)  -- { url, name, id }
end

local function account()
  return korie.store.get("account:" .. profile_id(), nil)  -- { token, user, name }
end

local function device_id()
  local id = korie.store.get("device", nil)
  if not id then
    math.randomseed(os.time())
    id = "korie-"
    for _ = 1, 16 do id = id .. string.format("%x", math.random(0, 15)) end
    korie.store.set("device", id)
  end
  -- One id per profile: Jellyfin ends a device's earlier sign-in when another user signs in on it.
  return id .. "-" .. profile_id()
end

local function show_state()
  local s, a = server(), account()
  korie.set_setting("server", s and s.name or "Not set")
  korie.set_setting("account", a and a.name or (s and "Not signed in" or ""))
end

-- ---------------------------------------------------------------- talking to the server

local function quote(s)
  return (tostring(s):gsub('[\\"]', ""))
end

local function auth_header(token)
  local d = korie.device()
  local h = 'MediaBrowser Client="Korie", Device="' .. quote(d.model or "Android") .. '", DeviceId="' .. device_id()
      .. '", Version="' .. quote(d.korie or "1") .. '"'
  if token then h = h .. ', Token="' .. token .. '"' end
  return h
end

local function encode(v)
  return (tostring(v):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", string.byte(c)) end))
end

local function query(params)
  local parts = {}
  for k, v in pairs(params or {}) do
    if v ~= nil then parts[#parts + 1] = encode(k) .. "=" .. encode(v) end
  end
  table.sort(parts)
  return #parts > 0 and ("?" .. table.concat(parts, "&")) or ""
end

-- Returns the decoded answer, or nil and a reason. base and token default to the saved ones.
local function call(method, path, params, body, base, token, timeout)
  local s = server()
  base = base or (s and s.url)
  if not base then return nil, "no server is set" end
  if token == nil then
    local a = account()
    token = a and a.token
  end
  local r, why = korie.http.request{
    url = base .. path .. query(params), method = method, timeout = timeout or 15,
    headers = { ["Authorization"] = auth_header(token or nil), ["Content-Type"] = "application/json", ["Accept"] = "application/json" },
    body = body and korie.json.encode(body) or nil,
  }
  if not r then return nil, why or "the server did not answer" end
  if r.status == 401 then return nil, "not signed in", 401 end
  if not r.ok then return nil, "the server answered " .. tostring(r.status), r.status end
  if not r.body or r.body == "" then return true end
  local ok, data = pcall(korie.json.decode, r.body)
  if not ok then return nil, "the server's answer could not be read" end
  return data
end

-- A sign-in the server no longer accepts is forgotten, so the user is asked again instead of
-- seeing an empty Korie with no reason.
local function signed_out(status)
  if status == 401 and account() then
    korie.store.remove("account:" .. profile_id())
    show_state()
    korie.toast("Jellyfin: sign in again in Settings → Add-ons → Jellyfin")
  end
end

local function api(method, path, params, body)
  local data, why, status = call(method, path, params, body)
  if not data then signed_out(status) end
  return data, why
end

-- ---------------------------------------------------------------- finding the server

-- Is there a Jellyfin server at this address? Returns { url, name, id } or nil.
local function check(url)
  url = url:gsub("/+$", "")
  local info = call("GET", "/System/Info/Public", nil, nil, url, false, 5)
  if type(info) == "table" and info.Id then
    return { url = url, name = info.ServerName or url, id = info.Id }
  end
end

-- What the user typed may lack the http:// and the port; try the likely spellings.
local function resolve(text)
  text = (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if text == "" then return nil end
  local tries = {}
  if text:match("^https?://") then
    tries = { text }
  elseif text:match(":%d+$") or text:match(":%d+/") then
    tries = { "http://" .. text, "https://" .. text }
  else
    tries = { "https://" .. text, "http://" .. text .. ":8096", "http://" .. text }
  end
  for _, u in ipairs(tries) do
    local s = check(u)
    if s then return s end
  end
end

-- Jellyfin servers answer "who is JellyfinServer?" sent to everyone on the network (UDP 7359).
local function discover()
  local found, seen = {}, {}
  for _, reply in ipairs(korie.net.broadcast(7359, "who is JellyfinServer?", 3)) do
    local ok, info = pcall(korie.json.decode, reply.text)
    if ok and type(info) == "table" then
      local s = (info.Address and check(info.Address)) or check("http://" .. reply.address .. ":8096")
      if s and not seen[s.id] then
        seen[s.id] = true
        found[#found + 1] = s
      end
    end
  end
  return found
end

local function use_server(s)
  local old = server()
  korie.store.set("server", s)
  if not old or old.id ~= s.id then  -- another server: its sign-ins don't apply here
    for _, p in ipairs(korie.profiles.list()) do korie.store.remove("account:" .. p.id) end
    korie.store.remove("users")
  end
  show_state()
end

-- ---------------------------------------------------------------- signing in

-- Every sign-in by Jellyfin user, so a Korie profile made later for that user is signed in too.
local function remember_user(acct)
  local all = korie.store.get("users", {})
  all[tostring(acct.user)] = acct
  korie.store.set("users", all)
end

local function forget_user(id)
  local all = korie.store.get("users", {})
  all[tostring(id)] = nil
  korie.store.set("users", all)
end

local function signed_in(result)
  if type(result) ~= "table" or not result.AccessToken or not result.User then return false end
  local acct = { token = result.AccessToken, user = result.User.Id, name = result.User.Name }
  korie.store.set("account:" .. profile_id(), acct)
  remember_user(acct)  -- Korie 2: profiles made later find it by user
  show_state()
  korie.refresh()
  return true
end

-- A Jellyfin user with no password and the profile's name signs in by itself. The server does not
-- say which users have no password (it reports one for everybody), so this simply tries the
-- profile's name with an empty password, once per profile and server: a wrong guess is one failed
-- sign-in, and repeating it could lock the user out on the server.
local function try_without_password()
  local s = server()
  if not s or account() then return false end
  local mark = "tried:" .. tostring(s.id) .. ":" .. profile_id()
  if korie.store.get(mark, false) then return false end
  korie.store.set(mark, true)
  local name = korie.profile().name
  if signed_in(call("POST", "/Users/AuthenticateByName", nil, { Username = name, Pw = "" }, nil, false, 8)) then
    korie.toast("Jellyfin: signed in as " .. account().name)
    return true
  end
  korie.toast("Jellyfin: sign " .. name .. " in under Settings → Add-ons → Jellyfin")
  return false
end

local offer_profiles  -- defined with the other profile code further down

local function quick_connect()
  if call("GET", "/QuickConnect/Enabled", nil, nil, nil, false) ~= true then
    korie.ask{ title = "Quick Connect", message = "Quick Connect is turned off on this server. Sign in with a user name and password instead, or turn it on in the server's Dashboard." }
    return
  end
  local qc, why = call("POST", "/QuickConnect/Initiate", nil, nil, nil, false)
  if type(qc) ~= "table" or not qc.Secret then
    korie.ask{ title = "Quick Connect", message = "Could not start Quick Connect: " .. tostring(why) }
    return
  end
  while true do
    local pick = korie.ask{
      title = "Quick Connect",
      message = "In Jellyfin on a phone or computer where you are signed in, open your user menu, choose Quick Connect and enter this code:\n\n" .. tostring(qc.Code) .. "\n\nThen choose Done here.",
      choices = { "Done", "Cancel" },
    }
    if pick ~= 1 then return end
    local state = call("GET", "/QuickConnect/Connect", { secret = qc.Secret }, nil, nil, false)
    if type(state) == "table" and state.Authenticated then
      if signed_in(call("POST", "/Users/AuthenticateWithQuickConnect", nil, { Secret = qc.Secret }, nil, false)) then
        korie.toast("Jellyfin: signed in as " .. account().name)
        offer_profiles()
      else
        korie.ask{ title = "Quick Connect", message = "The server did not accept the sign-in. Try again." }
      end
      return
    end
    korie.toast("The code has not been entered in Jellyfin yet")
  end
end

local function password_sign_in()
  local name = korie.ask{ title = "Jellyfin user name", input = "text", value = korie.profile().name }
  if not name or name == "" then return end
  local pw = korie.ask{ title = "Password for " .. name, input = "password" }
  if pw == nil then return end
  local result, why = call("POST", "/Users/AuthenticateByName", nil, { Username = name, Pw = pw }, nil, false)
  if signed_in(result) then
    korie.toast("Jellyfin: signed in as " .. account().name)
    offer_profiles()
  else
    korie.ask{ title = "Jellyfin", message = (why == "not signed in" or why == "the server answered 401") and "Wrong user name or password." or ("Could not sign in: " .. tostring(why)) }
  end
end

-- ---------------------------------------------------------------- the settings buttons

local buttons = {}

function buttons.server()
  local s = server()
  local choices = { "Find on this network", "Type the address" }
  if s then choices[#choices + 1] = "Forget " .. s.name end
  local pick = korie.ask{ title = s and ("Server: " .. s.name) or "Jellyfin server", choices = choices }
  if pick == 1 then
    korie.toast("Looking for Jellyfin servers…")
    local found = discover()
    if #found == 0 then
      korie.ask{ title = "Jellyfin server", message = "No Jellyfin server answered on this network. If yours is somewhere else, or the network blocks the search, type its address instead." }
      return
    end
    local chosen = found[1]
    if #found > 1 then
      local names = {}
      for i, f in ipairs(found) do names[i] = f.name .. "   " .. f.url end
      local which = korie.ask{ title = "Which server?", choices = names }
      if not which then return end
      chosen = found[which]
    end
    use_server(chosen)
    korie.toast("Jellyfin: found " .. chosen.name)
    if not try_without_password() then korie.refresh() end
  elseif pick == 2 then
    local text = korie.ask{ title = "Server address", message = "The IP address or domain of the server, for example 192.168.1.20 or jellyfin.example.com", input = "text", value = s and s.url or "" }
    if not text or text == "" then return end
    korie.toast("Looking for the server…")
    local found = resolve(text)
    if not found then
      korie.ask{ title = "Jellyfin server", message = "No Jellyfin server answered at " .. text .. ". Check the address, and the port if the server does not use 8096." }
      return
    end
    use_server(found)
    korie.toast("Jellyfin: connected to " .. found.name)
    if not try_without_password() then korie.refresh() end
  elseif pick == 3 and s then
    korie.store.remove("server")
    korie.store.remove("users")
    for _, p in ipairs(korie.profiles.list()) do korie.store.remove("account:" .. p.id) end
    show_state()
    korie.refresh()
  end
end

function buttons.account()
  if not server() then
    korie.ask{ title = "Jellyfin", message = "Set the server first." }
    return
  end
  local a = account()
  local choices = { "Quick Connect (a code, no typing)", "User name and password" }
  if a then choices[#choices + 1] = "Sign out " .. a.name end
  local pick = korie.ask{ title = "Sign in " .. korie.profile().name .. " to Jellyfin", choices = choices }
  if pick == 1 then
    quick_connect()
  elseif pick == 2 then
    password_sign_in()
  elseif pick == 3 and a then
    call("POST", "/Sessions/Logout")
    forget_user(a.user)
    korie.store.remove("account:" .. profile_id())
    show_state()
    korie.refresh()
  end
end

-- The server's users. Signed in, Jellyfin gives the whole list (GET /Users). Not signed in, it only
-- gives the users shown on its sign-in screen (GET /Users/Public), and Jellyfin hides users from
-- that screen unless the server's owner unticks it, so that list is usually empty.
local function server_users()
  local users, why
  if account() then users, why = api("GET", "/Users", { isDisabled = "false" }) end
  if type(users) ~= "table" then users, why = call("GET", "/Users/Public", nil, nil, nil, false) end
  if type(users) ~= "table" then return nil, why end
  return users
end

-- Jellyfin users that have no Korie profile yet (the signed-in user counts as this profile).
local function users_without_profile(users)
  local have, a = {}, account()
  for _, p in ipairs(korie.profiles.list()) do have[p.name:lower()] = true end
  if a then have[a.name:lower()] = true end
  local out = {}
  for _, u in ipairs(users) do
    if u.Name and not have[u.Name:lower()] then out[#out + 1] = u.Name end
  end
  return out
end

local function make_profiles(names)
  local made, full = {}, nil
  for _, name in ipairs(names) do
    local p, reason = korie.profiles.add(name)
    if p then made[#made + 1] = name else full = reason; break end
  end
  return made, full
end

-- One Korie profile per Jellyfin user.
function buttons.profiles()
  if not server() then
    korie.ask{ title = "Jellyfin", message = "Set the server first." }
    return
  end
  local users, why = server_users()
  if not users then
    korie.ask{ title = "Profiles", message = "Could not get the users: " .. tostring(why) }
    return
  end
  local missing = users_without_profile(users)
  local text
  if #users == 0 then
    text = "The server gives no users before someone is signed in. Sign in first, then choose this again."
  elseif #missing == 0 then
    text = "Every Jellyfin user already has a profile."
  else
    local made, full = make_profiles(missing)
    text = (#made > 0 and ("Made: " .. table.concat(made, ", ") .. ".\n\nSwitch to a profile on Home, then sign it in here.") or "No profile could be made.")
    if full then text = text .. "\n\nNot all users got one: " .. full .. "." end
  end
  korie.ask{ title = "Profiles", message = text }
end

-- Straight after a sign-in: offer a profile for each of the server's other users.
local in_setup = false  -- Korie's setup makes the profiles itself
function offer_profiles()
  if in_setup then return end
  local users = server_users()
  if not users then return end
  local missing = users_without_profile(users)
  if #missing == 0 then return end
  local pick = korie.ask{
    title = "Profiles",
    message = "This server also has: " .. table.concat(missing, ", ") .. ".\n\nMake a Korie profile for each of them?",
    choices = { "Make profiles", "Not now" },
  }
  if pick ~= 1 then return end
  local made, full = make_profiles(missing)
  local text = #made > 0 and ("Made: " .. table.concat(made, ", ") .. ".\n\nSwitch to a profile on Home, then sign it in under Settings → Add-ons → Jellyfin.") or "No profile could be made."
  if full then text = text .. "\n\nNot all users got one: " .. full .. "." end
  korie.ask{ title = "Profiles", message = text }
end

korie.on("button", function(key)
  if buttons[key] then buttons[key]() end
end)

korie.on("setting", function(key)
  if key == "quality" then return end  -- read when something is played
end)

korie.on("profile", function()
  show_state()
  if not try_without_password() then korie.refresh() end
end)

-- ---------------------------------------------------------------- items

local function image(id, kind, tag, width)
  if not id or not tag then return "" end
  return server().url .. "/Items/" .. id .. "/Images/" .. kind .. "?maxWidth=" .. width .. "&quality=90&tag=" .. encode(tag)
end

local function backdrop_of(it, width)
  if it.BackdropImageTags and it.BackdropImageTags[1] then return image(it.Id, "Backdrop/0", it.BackdropImageTags[1], width) end
  if it.ParentBackdropItemId and it.ParentBackdropImageTags and it.ParentBackdropImageTags[1] then
    return image(it.ParentBackdropItemId, "Backdrop/0", it.ParentBackdropImageTags[1], width)
  end
  return ""
end

local function genres(it)
  local g = {}
  for i = 1, math.min(3, #(it.Genres or {})) do g[i] = it.Genres[i] end
  return table.concat(g, ", ")
end

local function to_item(it)
  local series = it.Type == "Series"
  local tmdb = it.ProviderIds and (it.ProviderIds.Tmdb or it.ProviderIds.tmdb)
  return {
    id = it.Id, kind = it.Type, type = series and "series" or "movie",
    title = it.Name or "", year = it.ProductionYear and tostring(it.ProductionYear) or "",
    overview = it.Overview or "", genres = genres(it), rating = it.CommunityRating,
    runtime = it.RunTimeTicks and math.floor(it.RunTimeTicks / TICKS / 60 + 0.5) or nil,
    official = it.OfficialRating,
    ends = series and it.EndDate and it.Status ~= "Continuing" and string.sub(it.EndDate, 1, 4) or nil,
    poster = image(it.Id, "Primary", it.ImageTags and it.ImageTags.Primary, 400),
    backdrop = backdrop_of(it, 1920),
    added = it.DateCreated,
    key = tmdb and ("tmdb:" .. (series and "tv" or "movie") .. ":" .. tostring(tmdb)) or nil,
  }
end

-- The whole library of this profile's user; Korie saves it and searches it on the device.
korie.on("catalog", function()
  local a = account()
  if not server() or not a then return {} end
  local out, start, page = {}, 0, 500
  while true do
    local data, why = api("GET", "/Items", {
      userId = a.user, recursive = "true", includeItemTypes = "Movie,Series", sortBy = "SortName",
      fields = "Overview,Genres,ProviderIds,DateCreated,OfficialRating,EndDate,Status", enableUserData = "false", imageTypeLimit = 1,
      enableImageTypes = "Primary,Backdrop", startIndex = start, limit = page,
    })
    if type(data) ~= "table" or type(data.Items) ~= "table" then error("no library: " .. tostring(why)) end
    for _, it in ipairs(data.Items) do out[#out + 1] = to_item(it) end
    start = start + #data.Items
    if #data.Items < page or start >= (data.TotalRecordCount or 0) or start >= 20000 then break end
  end
  return out
end)

local function minutes_left(it)
  local pos = it.UserData and it.UserData.PlaybackPositionTicks or 0
  if pos <= 0 or not it.RunTimeTicks then return nil end
  return math.max(1, math.floor((it.RunTimeTicks - pos) / TICKS / 60 + 0.5))
end

local function left_text(min)
  if min >= 60 then return string.format("%d h %d min left", math.floor(min / 60), min % 60) end
  return min .. " min left"
end

-- Continue Watching and Next Up from the server, for the carousel.
local function home_item(it)
  local item
  if it.Type == "Episode" then
    -- An episode on Home stands for its series: OK opens the series page at this episode
    -- (the page's "focus" comes from the server's Next Up for the series).
    local n = (it.ParentIndexNumber and ("S" .. it.ParentIndexNumber .. " ") or "") .. (it.IndexNumber and ("E" .. it.IndexNumber) or "")
    item = {
      id = it.SeriesId, kind = "Series", type = "series", title = it.SeriesName or it.Name or "",
      -- (no overview: the episode line says which one; Korie TV shows the series' own overview)
      episode = (n ~= "" and (n .. " · ") or "") .. (it.Name or ""),
      poster = image(it.SeriesId, "Primary", it.SeriesPrimaryImageTag, 400),
      focus_episode = it.Id, focus_season = it.SeasonId,
    }
  else
    item = to_item(it)
  end
  item.backdrop = backdrop_of(it, 1920)
  if item.backdrop == "" then item.backdrop = image(it.Id, "Thumb", it.ImageTags and it.ImageTags.Thumb, 1920) end
  if item.backdrop == "" then item.backdrop = image(it.Id, "Primary", it.ImageTags and it.ImageTags.Primary, 1280) end
  local left = minutes_left(it)
  if left then
    item.remaining = left
    item.progress = (it.UserData.PlayedPercentage or 0) / 100
  end
  return item
end

korie.on("home", function()
  local a = account()
  if not server() or not a then return {} end
  local out, seen = {}, {}
  local function add(list)
    for _, it in ipairs(list or {}) do
      local key = (it.Type == "Episode" and it.SeriesId) or it.Id
      if #out < 8 and not seen[key] then
        seen[key] = true
        local item = home_item(it)
        if item.backdrop ~= "" then out[#out + 1] = item end
      end
    end
  end
  local resume = api("GET", "/UserItems/Resume", { userId = a.user, limit = 8, mediaTypes = "Video", fields = "Overview,Genres",
    enableImageTypes = "Primary,Backdrop,Thumb", imageTypeLimit = 1 })
  add(type(resume) == "table" and resume.Items)
  if #out < 8 then
    local nextup = api("GET", "/Shows/NextUp", { userId = a.user, limit = 8 - #out, fields = "Overview", enableImageTypes = "Primary,Backdrop,Thumb", imageTypeLimit = 1 })
    add(type(nextup) == "table" and nextup.Items)
  end
  return out
end)

-- What a title's page shows: Resume and Play for a film or an episode, seasons for a series.
korie.on("detail", function(item)
  local a = account()
  if not a then return { buttons = { { id = "signin", label = "Sign in to Jellyfin first" } } } end
  if item.kind == "Series" then
    local data = api("GET", "/Shows/" .. item.id .. "/Seasons", { userId = a.user })
    local seasons = {}
    for _, s in ipairs(type(data) == "table" and data.Items or {}) do seasons[#seasons + 1] = { id = s.Id, name = s.Name } end
    -- Where to open: the episode the carousel showed, else the server's Next Up for this series
    -- (the episode in progress, or the one after the last watched), as Jellyfin's own app does.
    local focus
    if item.focus_episode then
      focus = { season = item.focus_season, episode = item.focus_episode }
    else
      local nu = api("GET", "/Shows/NextUp", { userId = a.user, seriesId = item.id, limit = 1, enableResumable = "true", fields = "SeasonId" })
      local ep = type(nu) == "table" and nu.Items and nu.Items[1]
      if ep then focus = { season = ep.SeasonId, episode = ep.Id } end
    end
    return { seasons = seasons, focus = focus }
  end
  local it = api("GET", "/Items/" .. item.id, { userId = a.user })
  local left = type(it) == "table" and minutes_left(it)
  if left then
    return { buttons = { { id = "resume", label = "Resume", sub = left_text(left) }, { id = "play", label = "Play from the start" } } }
  end
  return { buttons = { { id = "play", label = "Play" } } }
end)

korie.on("episodes", function(item, season)
  local a = account()
  if not a then return {} end
  local data = api("GET", "/Shows/" .. item.id .. "/Episodes", { userId = a.user, seasonId = season, fields = "Overview", enableUserData = "true" })
  local out = {}
  for _, e in ipairs(type(data) == "table" and data.Items or {}) do
    local ud = e.UserData or {}
    out[#out + 1] = {
      id = e.Id, kind = "Episode", row = true, series = e.SeriesName or item.title,
      title = (e.IndexNumber and (e.IndexNumber .. ". ") or "") .. (e.Name or ""),
      thumb = image(e.Id, "Primary", e.ImageTags and e.ImageTags.Primary, 480),
      overview = e.Overview or "",
      progress = ud.Played and 1 or ((ud.PlayedPercentage or 0) / 100),
    }
  end
  return out
end)

-- ---------------------------------------------------------------- playing

-- What Korie's player (ExoPlayer) plays as it is; anything else the server converts to HLS.
local DEVICE_PROFILE = {
  Name = "Korie", MaxStreamingBitrate = 120000000, MaxStaticBitrate = 120000000,
  DirectPlayProfiles = {
    { Type = "Video", Container = "mp4,m4v,mkv,webm,mov,ts,mpegts", VideoCodec = "h264,hevc,vp8,vp9,av1,mpeg4,mpeg2video", AudioCodec = "aac,mp3,ac3,eac3,opus,vorbis,flac,pcm" },
    { Type = "Audio" },
  },
  TranscodingProfiles = {
    { Type = "Video", Container = "ts", Protocol = "hls", VideoCodec = "h264", AudioCodec = "aac,mp3,ac3", Context = "Streaming", MaxAudioChannels = "6", MinSegments = 1, BreakOnNonKeyFrames = true },
  },
  SubtitleProfiles = {
    { Format = "srt", Method = "Embed" }, { Format = "subrip", Method = "Embed" }, { Format = "ass", Method = "Embed" },
    { Format = "ssa", Method = "Embed" }, { Format = "vtt", Method = "Hls" },
  },
}

local started = {}  -- play sessions the server has been told about

-- The parts of a video the server knows can be skipped (Jellyfin 10.10 and later, and only when the
-- server has something that finds them, such as the Intro Skipper plugin). Korie's player shows
-- "Skip Intro" / "Skip Recap" over them, and uses the credits as the cue for "Next Episode".
local SEGMENT = { Intro = "intro", Recap = "recap", Outro = "credits", Preview = "preview", Commercial = "ad" }

local function segments_of(id)
  -- All types (the server wants a list parameter repeated, not with commas; SEGMENT above picks the ones used).
  local data = call("GET", "/MediaSegments/" .. id, nil, nil, nil, nil, 6)
  local out = {}
  for _, sg in ipairs(type(data) == "table" and data.Items or {}) do
    local kind = SEGMENT[sg.Type]
    if kind and sg.StartTicks and sg.EndTicks and sg.EndTicks > sg.StartTicks then
      out[#out + 1] = { type = kind, start = sg.StartTicks / TICKS, ["end"] = sg.EndTicks / TICKS }
    end
  end
  return out
end

local function episode_label(it)
  return (it.ParentIndexNumber and ("S" .. it.ParentIndexNumber .. " ") or "") .. (it.IndexNumber and ("E" .. it.IndexNumber .. " · ") or "") .. (it.Name or "")
end

-- The episode after this one, across seasons, in the server's own order.
local function next_episode(it, user)
  if it.Type ~= "Episode" or not it.SeriesId then return nil end
  local data = api("GET", "/Shows/" .. it.SeriesId .. "/Episodes", { userId = user, startItemId = it.Id, limit = 2, fields = "Overview" })
  local items = type(data) == "table" and data.Items or {}
  if items[1] and items[1].Id == it.Id and items[2] then return items[2] end
  return nil
end

local function play(item, resume)
  local a = account()
  if not server() or not a then
    korie.toast("Jellyfin: sign in first, in Settings → Add-ons → Jellyfin")
    return
  end
  local it = api("GET", "/Items/" .. item.id, { userId = a.user })
  if type(it) ~= "table" then
    korie.toast("Jellyfin: the server did not answer")
    return
  end
  local convert = korie.setting("quality") == "convert"
  local info, why = api("POST", "/Items/" .. item.id .. "/PlaybackInfo", { userId = a.user }, {
    UserId = a.user, DeviceProfile = DEVICE_PROFILE, MaxStreamingBitrate = 120000000,
    EnableDirectPlay = not convert, EnableDirectStream = not convert, EnableTranscoding = true, AutoOpenLiveStream = true,
  })
  local src = type(info) == "table" and info.MediaSources and info.MediaSources[1]
  if not src then
    korie.toast("Jellyfin: this cannot be played (" .. tostring(type(info) == "table" and info.ErrorCode or why) .. ")")
    return
  end
  local url, method, mime
  if not convert and (src.SupportsDirectPlay or src.SupportsDirectStream) then
    url = server().url .. "/Videos/" .. item.id .. "/stream" .. query{ static = "true", mediaSourceId = src.Id, deviceId = device_id(), playSessionId = info.PlaySessionId }
    method = "DirectPlay"
  elseif src.TranscodingUrl then
    url = server().url .. src.TranscodingUrl
    method, mime = "Transcode", "application/x-mpegURL"
  else
    korie.toast("Jellyfin: the server offers no way to play this here")
    return
  end
  -- Subtitles Jellyfin can give as text (from the file or beside it), as WebVTT for the player.
  local subs = {}
  for _, st in ipairs(src.MediaStreams or {}) do
    if st.Type == "Subtitle" and st.IsTextSubtitleStream ~= false and st.Index then
      subs[#subs + 1] = {
        label = st.DisplayTitle or st.Title or st.Language or ("Subtitles " .. (#subs + 1)),
        lang = st.Language,
        url = server().url .. "/Videos/" .. item.id .. "/" .. src.Id .. "/Subtitles/" .. math.floor(st.Index) .. "/0/Stream.vtt" .. query{ api_key = a.token },
        default = st.IsDefault == true or st.IsForced == true or nil,
      }
    end
  end
  local pos = it.UserData and it.UserData.PlaybackPositionTicks or 0
  local title, subtitle = it.Name or item.title, nil
  local following
  if it.Type == "Episode" then
    title = it.SeriesName or title
    subtitle = episode_label(it)
    following = next_episode(it, a.user)
  end
  korie.play{
    url = url, mime = mime, title = title, subtitle = subtitle,
    start = resume and (pos / TICKS) or 0,
    headers = { ["Authorization"] = auth_header(a.token) },
    segments = segments_of(item.id),
    subtitles = #subs > 0 and subs or nil,
    next = following and {
      title = episode_label(following), series = following.SeriesName or it.SeriesName,
      image = image(following.Id, "Primary", following.ImageTags and following.ImageTags.Primary, 640),
      overview = following.Overview,
    } or nil,
    autonext = korie.setting("autonext") ~= false,
    ref = { id = item.id, source = src.Id, session = info.PlaySessionId, method = method, profile = profile_id(),
      next = following and following.Id or nil },
  }
end

korie.on("action", function(item, button)
  if button == "signin" then
    buttons.account()
    return
  end
  -- An episode chosen in the row, or a title on the carousel, carries on where it was left.
  local resume = button == "resume" or item.row == true
  play(item, resume)
end)

-- The player asks for what comes after the one it is showing ("Next Episode", or the episode ended).
korie.on("next", function(ref)
  if type(ref) == "table" and ref.next then play({ id = ref.next, kind = "Episode" }, false) end
end)

-- Korie's player reports; the server hears it, so every Jellyfin app shows the same progress.
korie.on("playback", function(ref, info)
  if type(ref) ~= "table" or not ref.id or ref.profile ~= profile_id() then return end
  local body = {
    ItemId = ref.id, MediaSourceId = ref.source, PlaySessionId = ref.session, PlayMethod = ref.method,
    PositionTicks = math.floor((info.position or 0) * TICKS), CanSeek = true, IsPaused = info.state == "paused", IsMuted = false,
  }
  if info.state == "playing" or info.state == "paused" then
    if not started[ref.session or ref.id] then
      started[ref.session or ref.id] = true
      api("POST", "/Sessions/Playing", nil, body)
    end
    api("POST", "/Sessions/Playing/Progress", nil, body)
  else
    if info.state == "ended" and (info.duration or 0) > 0 then body.PositionTicks = math.floor(info.duration * TICKS) end
    api("POST", "/Sessions/Playing/Stopped", nil, body)
    started[ref.session or ref.id] = nil
  end
end)

-- ---------------------------------------------------------------- Korie 2: setup and profiles
--
-- Korie's setup shows these pages, and can make Korie's profiles from the server's users: each
-- profile is then that Jellyfin user, and Korie asks for the user's password when the profile is
-- picked (until it is signed in).

local found_servers = {}

local function signin_page(s)
  return {
    id = "signin", title = "Sign In to " .. (s and s.name or "Jellyfin"),
    message = "Jellyfin shows its users after one of them signs in.",
    rows = {
      { id = "qc", title = "Quick Connect", sub = "Enter a code in Jellyfin on your phone; no typing here" },
      { id = "pw", title = "User Name and Password" },
      { id = "skip", title = "Skip", sub = "Sign in later in Settings → Add-ons → Jellyfin" },
    },
  }
end

korie.on("setup", function()
  local s = server()
  if s then
    for _, p in ipairs(korie.profiles.list()) do
      if korie.store.get("account:" .. p.id, nil) then return nil end  -- already set up
    end
    return signin_page(s)
  end
  found_servers = discover()
  local rows = {}
  for i, f in ipairs(found_servers) do
    rows[#rows + 1] = { id = "s" .. i, title = f.name, sub = f.url:gsub("^https?://", "") .. " · found on your network", value = "Connect" }
  end
  rows[#rows + 1] = { id = "type", title = "Type an Address…", sub = "Like jellyfin.example.com or 192.168.1.20" }
  rows[#rows + 1] = { id = "skip", title = "Skip", sub = "Jellyfin can be set up later in Settings" }
  return {
    id = "connect", title = "Connect to Jellyfin",
    message = #found_servers > 0 and "Servers found on your network. Or type an address." or "No server answered on this network. Type its address, or skip.",
    rows = rows,
  }
end)

korie.on("setup.choose", function(page, row)
  if row == "skip" then return "done" end
  if page == "connect" then
    local chosen
    if row == "type" then
      local text = korie.ask{ title = "Server Address", message = "The IP address or domain of the server, for example 192.168.1.20 or jellyfin.example.com", input = "text" }
      if not text or text == "" then return nil end
      chosen = resolve(text)
      if not chosen then
        korie.ask{ title = "Jellyfin", message = "No Jellyfin server answered at " .. text .. ". Check the address, and the port if the server does not use 8096." }
        return nil
      end
    else
      chosen = found_servers[tonumber(row:sub(2))]
      if not chosen then return nil end
    end
    use_server(chosen)
    return signin_page(chosen)
  elseif page == "signin" then
    in_setup = true
    if row == "qc" then quick_connect() elseif row == "pw" then password_sign_in() end
    in_setup = false
    if account() then return "done" end
    return nil
  end
  return "done"
end)

-- Any saved sign-in, to ask the server things when this profile has none.
local function any_account()
  local a = account()
  if a then return a end
  for _, p in ipairs(korie.profiles.list()) do
    a = korie.store.get("account:" .. p.id, nil)
    if a then return a end
  end
end

-- The users that can become Korie profiles: { {id, name, detail} }.
korie.on("users", function()
  local s = server()
  if not s then return nil end
  local users
  local a = any_account()
  if a then users = call("GET", "/Users", { isDisabled = "false" }, nil, nil, a.token) end
  if type(users) ~= "table" then users = call("GET", "/Users/Public", nil, nil, nil, false) end
  if type(users) ~= "table" then return nil end
  local out = {}
  for _, u in ipairs(users) do
    if u.Id and u.Name then
      out[#out + 1] = { id = u.Id, name = u.Name, detail = s.name .. " · " .. s.url:gsub("^https?://", "") }
    end
  end
  return out
end)

-- Is this Korie profile signed in as this user? A sign-in of the same user by another profile counts.
korie.on("signedin", function(profile, user)
  local mine = korie.store.get("account:" .. profile.id, nil)
  if mine and mine.user == user.id then return true end
  -- Signed in before under another profile (in setup, say, before the profiles were made).
  local a = korie.store.get("users", {})[tostring(user.id)]
  if a then
    korie.store.set("account:" .. profile.id, a)
    return true
  end
  -- A user without a password signs in by itself, with no password screen. The server does not
  -- say who has one, so an empty password is tried once per user and server; when it fails, that
  -- is remembered, so the user is never counted more than one wrong try towards a lock-out.
  local s = server()
  if not s then return false end
  local mark = "nopw-failed:" .. tostring(s.id) .. ":" .. tostring(user.id)
  if korie.store.get(mark, false) then return false end
  local result = call("POST", "/Users/AuthenticateByName", nil, { Username = user.name, Pw = "" }, nil, false, 8)
  if type(result) == "table" and result.AccessToken and result.User then
    local acct = { token = result.AccessToken, user = result.User.Id, name = result.User.Name }
    korie.store.set("account:" .. profile.id, acct)
    remember_user(acct)
    show_state()
    korie.refresh()
    return true
  end
  korie.store.set(mark, true)
  return false
end)

-- The password typed on Korie's password screen.
korie.on("signin", function(profile, user, password)
  if not server() then return "Jellyfin has no server set." end
  local result, why = call("POST", "/Users/AuthenticateByName", nil, { Username = user.name, Pw = password or "" }, nil, false, 15)
  if type(result) == "table" and result.AccessToken and result.User then
    local acct = { token = result.AccessToken, user = result.User.Id, name = result.User.Name }
    korie.store.set("account:" .. profile.id, acct)
    remember_user(acct)
    show_state()
    korie.refresh()
    return true
  end
  if why == "not signed in" or why == "the server answered 401" then return "Wrong password." end
  return "Could not sign in: " .. tostring(why)
end)

show_state()
if server() and not account() then korie.timer(2, try_without_password, false) end
