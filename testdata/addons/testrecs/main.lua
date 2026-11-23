local d = korie.addon.dir
local items = {}
for i = 1, 5 do
  items[#items + 1] = { id = "r" .. i, type = "movie", title = "Rec Movie " .. i, year = 2000 + i, overview = "Recommended film " .. i .. ".", genres = "Drama", backdrop = d .. "/bd" .. i .. ".jpg" }
end
items[#items + 1] = { id = "rs", type = "series", title = "Rec Series", year = 2022, overview = "A series.", backdrop = d .. "/bd6.jpg" }
items[#items + 1] = { id = "rr", type = "radio", title = "Rec Radio", backdrop = d .. "/bd6.jpg" }
items[#items + 1] = { id = "rn", type = "movie", title = "No Art Movie" }
korie.on("catalog", function() return items end)
korie.on("detail", function(item) return { buttons = { { id = "play", label = "Play" } } } end)
korie.on("action", function(item, button) korie.log("RECACTION " .. tostring(item.id) .. " " .. tostring(button)) end)
