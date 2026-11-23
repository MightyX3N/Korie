local items = {
  { id = "m1", key = "t:1", type = "movie", title = "Fixture Movie", year = 2020, overview = "A movie that two add-ons have.", progress = 0.4 },
  { id = "a1", type = "movie", title = "Fixture Radio", overview = "Sound only." },
  { id = "s1", type = "series", title = "Fixture Series", year = 2021, overview = "A series with two seasons." },
}
korie.on("catalog", function() return items end)
korie.on("detail", function(item)
  if item.type == "series" then
    return { seasons = { { id = 1, name = "Season 1" }, { id = 2, name = "Season 2" } } }
  end
  return { buttons = { { id = "resume", label = "Resume", sub = "42 min left" }, { id = "play", label = "Play from the start" } } }
end)
korie.on("episodes", function(item, season)
  local out = {}
  local n = season == "1" and 8 or 3
  for i = 1, n do
    out[#out + 1] = { id = "s" .. season .. "e" .. i, title = "S" .. season .. " E" .. i .. " Episode", progress = (i == 1) and 0.5 or nil }
  end
  return out
end)
korie.on("action", function(item, button)
  korie.log("ACTION " .. tostring(item.id) .. " " .. tostring(button))
  if item.id == "a1" then
    korie.play({ url = korie.addon.dir .. "/tone.wav", title = "Fixture Radio", audio = true, ref = "a1" })
  else
    korie.play({ url = korie.addon.dir .. "/test.mp4", title = item.title, start = (button == "resume") and 20 or 0, ref = item.id })
  end
end)
korie.on("playback", function(ref, info)
  korie.log("PLAYBACK " .. tostring(ref) .. " " .. info.state .. " " .. string.format("%.0f/%.0f", info.position, info.duration))
end)
korie.on("home", function()
  return { { id = "m1", type = "movie", title = "Fixture Movie", year = 2020, overview = "From the test add-on.", backdrop = korie.addon.dir and (korie.addon.dir .. "/bd.jpg") or "" } }
end)
