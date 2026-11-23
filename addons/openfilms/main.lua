-- Open Films: the smallest content add-on. It has a short, fixed list, so it answers "catalog":
-- Korie saves the list on the device and searches it there, with or without internet.

local films = {
  {
    id = "sintel", type = "movie", title = "Sintel", year = "2010",
    genres = "Animation, Fantasy",
    overview = "A lonely young woman, Sintel, helps and befriends a dragon, whom she calls Scales. But when he is kidnapped by an adult dragon, Sintel decides to embark on a dangerous quest to find her lost friend.",
    url = "https://download.blender.org/durian/movies/Sintel.2010.1080p.mkv",
  },
  {
    id = "tears-of-steel", type = "movie", title = "Tears of Steel", year = "2012",
    genres = "Science Fiction",
    overview = "A group of warriors and scientists gather at the Oude Kerk in Amsterdam to stage a crucial event from the past, in a desperate attempt to rescue the world from destructive robots.",
    url = "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov",
  },
}

korie.on("catalog", function()
  return films
end)

-- Where each film was stopped, in seconds. Korie's player reports it (see "playback" below).
local function saved(id)
  return korie.store.get("pos:" .. id, 0)
end

-- What the title's page shows for this add-on.
korie.on("detail", function(item)
  local pos = saved(item.id)
  if pos > 30 then
    local at = string.format("from %d:%02d", math.floor(pos / 60), math.floor(pos % 60))
    return { buttons = {
      { id = "resume", label = "Resume", sub = at },
      { id = "play", label = "Play from the start" },
    } }
  end
  return { buttons = { { id = "play", label = "Play" } } }
end)

-- A button was chosen: play in Korie's own player. "ref" comes back with every progress report.
korie.on("action", function(item, button)
  korie.play({
    url = item.url,
    title = item.title,
    start = (button == "resume") and saved(item.id) or 0,
    ref = item.id,
  })
end)

-- The player says where it is: every 10 seconds while playing, and when it stops or ends.
korie.on("playback", function(ref, info)
  if info.state == "ended" then
    korie.store.remove("pos:" .. ref)
  elseif info.position > 0 then
    korie.store.set("pos:" .. ref, info.position)
  end
end)
