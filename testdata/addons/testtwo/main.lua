korie.on("search", function(text)
  if not string.find("fixture movie", string.lower(text), 1, true) then return {} end
  return { { id = "x9", key = "t:1", type = "movie", title = "Fixture Movie", year = 2020 } }
end)
korie.on("action", function(item, button) korie.log("ACTION2 " .. tostring(item.id) .. " " .. tostring(button)) end)
