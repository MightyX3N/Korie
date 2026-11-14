-- Free Films: a content add-on that comes with Korie.
--
-- Only films that are free to watch everywhere Korie is used:
--   * silent films in the public domain in the EU too (every director and
--     writer died more than 70 years ago) as well as in the US
--   * the Blender Foundation's open movies, licensed CC BY (credit shown)
-- Pictures and descriptions come from TMDb; the films stream from the
-- Internet Archive. Note: some archive copies have music added later.

local catalogue = {
	{ tmdb = 653, id = "nosferatu", title = "Nosferatu", year = "1922", runtime = 94, genres = { "Horror", "Fantasy" }, overview = "The mysterious Count Orlok summons a happily married real estate agent to his castle, located up in the Transylvanian mountains, to finalise a terrifying deal.", rating = 7.6, director = "F. W. Murnau", poster = "https://image.tmdb.org/t/p/w342/zv7J85D8CC9qYagAEhPM63CIG6j.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/cA9iGtvjRGJHzDBfrq48l0eyCvA.jpg", archive = "Nosferatu1922", licence = "Public domain", added = 15, cast = { { "Max Schreck", "Count Orlok" }, { "Gustav von Wangenheim", "Hutter" }, { "Greta Schröder", "Ellen" }, { "Georg H. Schnell", "Harding" }, { "Ruth Landshoff", "Ruth" } } },
	{ tmdb = 234, id = "caligari", title = "The Cabinet of Dr. Caligari", year = "1920", runtime = 76, genres = { "Drama", "Horror", "Thriller", "Crime" }, overview = "Francis, a young man, recalls in his memory the horrible experiences he and his fiancée Jane recently went through. Francis and his friend Alan visit The Cabinet of Dr. Caligari, an exhibit where the mysterious doctor shows the somnambulist Cesare, and awakens him for some moments from his death-like sleep.", rating = 7.9, director = "Robert Wiene", poster = "https://image.tmdb.org/t/p/w342/myK9DeIsXWGKgUTZyGXg2IfFk0W.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/sLq72hBx8Xs2IISVsZJqgjOd31b.jpg", archive = "DasKabinettdesDoktorCaligariTheCabinetofDrCaligari", licence = "Public domain", added = 14, cast = { { "Werner Krauss", "Dr. Caligari" }, { "Conrad Veidt", "Cesare" }, { "Friedrich Fehér", "Francis" }, { "Lil Dagover", "Jane" }, { "Hans Heinrich von Twardowski", "Alan" } } },
	{ tmdb = 669, id = "nanook", title = "Nanook of the North", year = "1922", runtime = 79, genres = { "Documentary", "Drama" }, overview = "This pioneering documentary film depicts the lives of the indigenous Inuit people of Canada's northern Quebec region. Although the production contains some fictional elements, it vividly shows how its resourceful subjects survive in such a harsh climate, revealing how they construct their igloo homes and find food by hunting and fishing. The film also captures the beautiful, if unforgiving, frozen landscape of the Great White North, far removed from conventional civilization.", rating = 7.1, director = "Robert Flaherty", poster = "https://image.tmdb.org/t/p/w342/9WAboi1QbKu41WkyGxQVNpXwwxx.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/1Zgfk1raynguQf9Pvcmx9M5dyDN.jpg", archive = "NanookOfTheNorth-HD", licence = "Public domain", added = 13, cast = { { "Allakariallak", "Nanook" }, { "Alice Nevalinga", "Nanook's Wife - the Smiling One" }, { "Cunayou", "Cunayou - Nanook's Daughter" }, { "Allegoo", "Allegoo - Nanook's Son" }, { "Allee", "Allee - Nanook's Son" } } },
	{ tmdb = 775, id = "trip-to-the-moon", title = "A Trip to the Moon", year = "1902", runtime = 15, genres = { "Adventure", "Science Fiction", "Comedy" }, overview = "Professor Barbenfouillis and five of his colleagues from the Academy of Astronomy travel to the Moon aboard a rocket propelled by a giant cannon. Once on the lunar surface, the bold explorers face the many perils hidden in the caves of the mysterious planet.", rating = 7.9, director = "Georges Méliès", poster = "https://image.tmdb.org/t/p/w342/9o0v5LLFk51nyTBHZSre6OB37n2.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/g67r1eiQD3ERSEQFCFkSn7TeGw5.jpg", archive = "le-voyage-dans-la-lune-1902-georges-melies", licence = "Public domain", added = 12, cast = { { "Georges Méliès", "Professeur Barbenfouillis / La Lune" }, { "Bleuette Bernon", "Phoebe Déesse de la Lune" }, { "François Lallement", "L'officier de Marine / Commandant de la Base de Lancement" }, { "Jehanne d'Alcy", "La Secrétaire / Une Étoile / Agent de Bord de la Fusée" }, { "Henri Delannoy", "Le Pilote de la Fusée Lunaire" } } },
	{ tmdb = 5698, id = "great-train-robbery", title = "The Great Train Robbery", year = "1903", runtime = 12, genres = { "Western", "Crime", "Action", "Adventure" }, overview = "After the train station clerk is assaulted and left bound and gagged, then the departing train and its passengers robbed, a posse goes in hot pursuit of the fleeing bandits.", rating = 7.0, director = "Edwin S. Porter", poster = "https://image.tmdb.org/t/p/w342/vEYr1sJR1dOFGXwXawpBN6hDRGF.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/99uGRUGS2qxNvPARiM8dkuTrUnW.jpg", archive = "TheGreatTrainRobbery1903_201307", licence = "Public domain", added = 11, cast = { { "Gilbert M. Anderson", "Bandit / Shot Passenger / Tenderfoot Dancer (uncredited)" }, { "John Manus Dougherty Sr.", "Bandit (uncredited)" }, { "Frank Hanaway", "Bandit (uncredited)" }, { "Adam Charles Hayman", "Bandit (uncredited)" }, { "Robert Milasch", "Trainman / Bandit (uncredited)" } } },
	{ tmdb = 5991, id = "last-laugh", title = "The Last Laugh", year = "1924", runtime = 90, genres = { "Drama" }, overview = "An aging doorman, after being fired from his prestigious job at a luxurious hotel, is forced to face the scorn of his friends, neighbours and society.", rating = 7.8, director = "F. W. Murnau", poster = "https://image.tmdb.org/t/p/w342/7Y6Dxr3oYt1w7ew70YNdLLDYEjk.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/sTyt7e2PB5nfY02reL1iZUYPbly.jpg", archive = "the-last-laugh-restored-720p-hd", licence = "Public domain", added = 10, cast = { { "Emil Jannings", "Hotel Doorman" }, { "Maly Delschaft", "His Niece" }, { "Max Hiller", "Bridegroom" }, { "Hans Unterkircher", "Hotel Manager" }, { "Hermann Vallentin", "Potbellied Guest" } } },
	{ tmdb = 10728, id = "faust", title = "Faust", year = "1926", runtime = 106, genres = { "Fantasy", "Drama", "Horror" }, overview = "Murnau’s epic adaptation of Goethe’s tragedy stands with Fritz Lang’s Metropolis among the supreme achievements of German silent cinema. Gösta Ekman plays the alchemist who, his faith shaken in a time of plague, is offered the gift of healing and eternal youth… in exchange for his soul.", rating = 7.9, director = "F. W. Murnau", poster = "https://image.tmdb.org/t/p/w342/rN703hMFxmkZfyEzsXvFtuFhkXE.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/dQbnFqsbtyHS7OD108vuFJiUyzy.jpg", archive = "Faust1926_201706", licence = "Public domain", added = 9, cast = { { "Gösta Ekman", "Faust" }, { "Emil Jannings", "Mephisto" }, { "Camilla Horn", "Gretchen Marguerite" }, { "Frida Richard", "Gretchens's Mother" }, { "William Dieterle", "Valentin" } } },
	{ tmdb = 631, id = "sunrise", title = "Sunrise: A Song of Two Humans", year = "1927", runtime = 94, genres = { "Drama", "Romance" }, overview = "A married farmer falls under the spell of a slatternly woman from the city, who tries to convince him to drown his wife.", rating = 7.8, director = "F. W. Murnau", poster = "https://image.tmdb.org/t/p/w342/5V9jDm4u2QemGHbqjUyP5HmFmzf.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/hKrrCigPFmhv1bg5IJl9nzjEaN4.jpg", archive = "sunrise-a-song-of-two-humans-f.-w.-murnau-1927", licence = "Public domain", added = 8, cast = { { "George O'Brien", "The Man" }, { "Janet Gaynor", "The Wife" }, { "Margaret Livingston", "The Woman from the City" }, { "Bodil Rosing", "The Maid" }, { "J. Farrell MacDonald", "The Photographer" } } },
	{ tmdb = 899, id = "broken-blossoms", title = "Broken Blossoms", year = "1919", runtime = 88, genres = { "Drama", "Romance" }, overview = "A frail waif, abused by her brutal boxer father in London's seedy Limehouse District, is befriended by a sensitive Chinese immigrant with tragic consequences.", rating = 6.9, director = "D.W. Griffith", poster = "https://image.tmdb.org/t/p/w342/njwFIUL76zaRmPemnrZVmmTSCjz.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/3DW3xHM7FgdE8XzpODbEfvlR9qR.jpg", archive = "brokenblossoms1919", licence = "Public domain", added = 7, cast = { { "Lillian Gish", "Lucy Burrows" }, { "Richard Barthelmess", "Cheng Huan" }, { "Donald Crisp", "Battling Burrows" }, { "Arthur Howard", "Burrows' Manager" }, { "Edward Peil Sr.", "Evil Eye" } } },
	{ tmdb = 10378, id = "big-buck-bunny", title = "Big Buck Bunny", year = "2008", runtime = 8, genres = { "Animation", "Comedy", "Family" }, overview = "Follow a day of the life of Big Buck Bunny when he meets three bullying rodents: Frank, Rinky, and Gamera. The rodents amuse themselves by harassing helpless creatures by throwing fruits, nuts and rocks at them. After the deaths of two of Bunny's favorite butterflies, and an offensive attack on Bunny himself, Bunny sets aside his gentle nature and orchestrates a complex plan for revenge.", rating = 6.5, director = "Sacha Goedegebure", poster = "https://image.tmdb.org/t/p/w342/i9jJzvoXET4D9pOkoEwncSdNNER.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/xtdybjRRZ15mCrPOvEld305myys.jpg", archive = "BigBuckBunny_124", licence = "© Blender Foundation, CC BY 3.0 (creativecommons.org/licenses/by/3.0)", added = 6, cast = {  } },
	{ tmdb = 45745, id = "sintel", title = "Sintel", year = "2010", runtime = 14, genres = { "Animation", "Fantasy", "Adventure" }, overview = "A wandering warrior finds an unlikely friend in the form of a young dragon. The two develop a close bond, until one day the dragon is snatched away. She then sets out on a relentless quest to reclaim her friend, finding in the end that her quest exacts a far greater price than she had ever imagined.", rating = 7.3, director = "Colin Levy", poster = "https://image.tmdb.org/t/p/w342/l98Zns4oQe1BSvbF4hJ8oL6VSf0.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/msqeiEyIRpPAtrCeRGFNZQ9tkJL.jpg", archive = "Sintel", licence = "© Blender Foundation, CC BY 3.0 (creativecommons.org/licenses/by/3.0)", added = 5, cast = { { "Halina Reijn", "Sintel (voice)" }, { "Thom Hoffman", "Shaman (voice)" } } },
	{ tmdb = 133701, id = "tears-of-steel", title = "Tears of Steel", year = "2012", runtime = 12, genres = { "Science Fiction", "Animation" }, overview = "The film’s premise is about a group of warriors and scientists, who gathered at the “Oude Kerk” in Amsterdam to stage a crucial event from the past, in a desperate attempt to rescue the world from destructive robots.", rating = 5.7, director = "Ian Hubert", poster = "https://image.tmdb.org/t/p/w342/8qy3jRmaHR7f8VZh3iXCqCWfFsH.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/fOy6SL5Zs2PFcNXwqEPIDPrLB1q.jpg", archive = "Tears-of-Steel", licence = "© Blender Foundation, CC BY 3.0 (creativecommons.org/licenses/by/3.0)", added = 4, cast = { { "Derek de Lint", "Old Thom" }, { "Sergio Hasselbaink", "Barly" }, { "Vanja Rukavina", "Thom" }, { "Denise Rebergen", "Celia" }, { "Rogier Schippers", "Kapitän" } } },
	{ tmdb = 9761, id = "elephants-dream", title = "Elephants Dream", year = "2006", runtime = 11, genres = { "Animation", "Science Fiction" }, overview = "Elephants Dream is the story of two strange characters exploring a capricious and seemingly infinite machine. The elder, Proog, acts as a tour-guide and protector, happily showing off the sights and dangers of the machine to his initially curious but increasingly skeptical protege Emo. As their journey unfolds we discover signs that the machine is not all Proog thinks it is, and his guiding takes on a more desperate aspect.  Elephants Dream is a story about communication and fiction, made purposefully open-ended as the world’s first 3D animated “Open movie”. The film itself is released under the Creative Commons license, along with the entirety of the production files used to make it (roughly 7 Gigabytes of data). The software used to make the movie is the free/open source animation suite Blender along with other open source software, thus allowing the movie to be remade, remixed and re-purposed with only a computer and the data on the DVD or download.", rating = 5.8, director = "Bassam Kurdali", poster = "https://image.tmdb.org/t/p/w342/9zROtU9TkpZQrOuEaMAp68FOWLK.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/9bJDwuhza19HQcYA99FeslLYmUm.jpg", archive = "ElephantsDream", licence = "© Blender Foundation, CC BY 3.0 (creativecommons.org/licenses/by/3.0)", added = 3, cast = { { "Tygo Gernandt", "Proog (voice)" }, { "Cas Jansen", "Emo (voice)" } } },
	{ tmdb = 358332, id = "cosmos-laundromat", title = "Cosmos Laundromat", year = "2015", runtime = 12, genres = { "Animation", "Fantasy" }, overview = "On a desolate island, a suicidal sheep named Franck meets his fate…in the form of a quirky salesman named Victor, who offers him the gift of a lifetime. The gift is many lifetimes, actually, in many different worlds – each lasting just a few minutes. In the sequel to the pilot, Franck will find a new reason to live…in the form of a bewitching female adventurer named Tara, who awakens his long-lost lust for life. But can Franck keep up with her?", rating = 6.3, director = "Mathieu Auvray", poster = "https://image.tmdb.org/t/p/w342/5ZXi0oitpEgAdoJglFTc5SZF9nt.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/f2wABsgj2lIR2dkDEfBZX8p4Iyk.jpg", archive = "CosmosLaundromatFirstCycle", licence = "© Blender Foundation, CC BY 4.0 (creativecommons.org/licenses/by/4.0)", added = 2, cast = { { "Pierre Bokma", "Franck" }, { "Reinout Scholten van Aschat", "Victor" } } },
	{ tmdb = 891761, id = "sprite-fright", title = "Sprite Fright", year = "2021", runtime = 11, genres = { "Animation", "Horror", "Comedy", "Fantasy" }, overview = "Set in 80’s-Britain, when a group of rowdy teenagers trek into an isolated forest, they discover peaceful mushroom creatures that turn out to be an unexpected force of nature.", rating = 7.7, director = "Matthew Luhn", poster = "https://image.tmdb.org/t/p/w342/AjWJQOogG4Irpff6K49tzrUTb1s.jpg", backdrop = "https://image.tmdb.org/t/p/w1280/aCMT1okuiKFnyKHdCOez66rJKyT.jpg", archive = "sprite-fright", licence = "© Blender Foundation, CC BY 4.0 (creativecommons.org/licenses/by/4.0)", added = 1, cast = { { "Valerie LaPointe", "Ellie (voice)" }, { "Gabriel Bisset-Smith", "Rex (voice)" }, { "Nicole Davis", "Victoria (voice)" }, { "Homer Todiwala", "Jay (voice)" }, { "Ed Kear", "Phil (voice)" } } },
}

local by_id = {}
for _, f in ipairs(catalogue) do by_id[f.id] = f end

local addon = {}

-- Korie's Films (and Home) get these as a row of their own.
local function item(f)
	return {
		id = f.id, kind = "film", title = f.title, year = f.year, runtime = f.runtime, genres = f.genres,
		overview = f.overview .. "\n\n" .. f.licence .. ". Streams from the Internet Archive.", rating = f.rating, director = f.director,
		cast = f.cast, poster = f.poster, backdrop = f.backdrop, subtitle = f.year,
	}
end

function addon.browse(ctx)
	local silent, open_movies = {}, {}
	for _, f in ipairs(catalogue) do
		if f.licence == "Public domain" then silent[#silent + 1] = item(f) else open_movies[#open_movies + 1] = item(f) end
	end
	local all = {}
	for _, f in ipairs(catalogue) do all[#all + 1] = item(f) end
	return {
		films = { { id = "silent", title = "Silent classics", items = silent }, { id = "open", title = "Open movies from Blender", items = open_movies } },
		home = { { id = "free", title = "Free to watch", items = all } },
	}
end

function addon.search(q, ctx)
	local out, ql = {}, string.lower(q)
	for _, f in ipairs(catalogue) do
		if string.find(string.lower(f.title), ql, 1, true) then out[#out + 1] = item(f) end
	end
	return { items = out }
end

-- Playing: ask the Internet Archive which files the film has.
function addon.play(item, ctx)
	local f = by_id[item.id]
	if not f then return { error = "unknown film" } end
	return { fetch = "https://archive.org/metadata/" .. f.archive, as = "json", next = "pick", state = f.archive }
end

local VIDEO = { mp4 = true, m4v = true, mkv = true, webm = true, ogv = true, mpeg = true, mpg = true, avi = true }

local function encode(s)
	return (s:gsub("[^%w%-%._~/]", function(c) return string.format("%%%02X", string.byte(c)) end))
end

-- The best video file: MP4 first (it plays without converting), then the
-- highest picture (up to 1080 lines), then the biggest file.
function addon.pick(meta, archive_id)
	local best, best_score = nil, -1
	for _, file in ipairs(meta.files or {}) do
		local ext = (file.name or ""):match("%.([%w]+)$")
		if ext and VIDEO[ext:lower()] and not (file.name:find("_512kb") or file.name:find("Documentary")) then
			local h = math.min(tonumber(file.height) or 0, 1080)
			local size = tonumber(file.size) or 0
			local mp4 = (ext:lower() == "mp4" or ext:lower() == "m4v") and 1 or 0
			local score = mp4 * 1e15 + h * 1e11 + math.min(size, 9e10)
			if score > best_score then best, best_score = file, score end
		end
	end
	if not best then return { error = "no video file in this Internet Archive item" } end
	return { url = "https://archive.org/download/" .. archive_id .. "/" .. encode(best.name) }
end

return addon
