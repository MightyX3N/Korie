# Korie in Kodi: lists what the Korie server has (your library, add-ons, live TV) and
# plays it with Kodi's own player. All the work happens on the server; this only shows it.
import sys
import urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

from resources.lib import korie, screens, ui
from resources.lib.korie import KorieError, log

BASE = sys.argv[0]
HANDLE = int(sys.argv[1]) if len(sys.argv) > 1 else -1
ARGS = dict(urllib.parse.parse_qsl(sys.argv[2][1:])) if len(sys.argv) > 2 else {}
HOME_WINDOW = xbmcgui.Window(10000)

FOLDER_KINDS = {"series", "album", "page"}
CAPTIONS = {"film": "Film", "series": "Series", "episode": "Episode", "album": "Music", "track": "Song", "live": "Channel",
            "game": "Game", "page": "Add-on", "playlist": "Playlist", "artist": "Artist", "genre": "Genre"}
CONTENT = {"film": "movies", "series": "tvshows", "episode": "episodes", "album": "albums", "track": "songs"}


def url(**kw):
    return BASE + "?" + urllib.parse.urlencode(kw)


def fail(e):
    xbmcgui.Dialog().notification("Korie", str(e), xbmcgui.NOTIFICATION_ERROR, 6000)
    log(e)


# --- list items ---------------------------------------------------------------------------

def info_tag(li, kind, c, server_pic=lambda u: u):
    """Title, year, plot and watched state, in Kodi's own fields (so skins can show them)."""
    if kind in ("album", "track"):
        tag = li.getMusicInfoTag()
        tag.setTitle(c.get("title", ""))
        if c.get("subtitle"):
            tag.setArtist(c["subtitle"])
        if str(c.get("year", "")).isdigit():
            tag.setYear(int(c["year"]))
        tag.setMediaType("song" if kind == "track" else "album")
        return
    tag = li.getVideoInfoTag()
    tag.setTitle(c.get("title", ""))
    tag.setMediaType({"film": "movie", "series": "tvshow", "episode": "episode"}.get(kind, "video"))
    if str(c.get("year", "")).isdigit():
        tag.setYear(int(c["year"]))
    if c.get("overview"):
        tag.setPlot(c["overview"])
    if c.get("genres"):
        tag.setGenres(list(c["genres"]))
    if c.get("rating"):
        tag.setRating(float(c["rating"]))
    if c.get("cert"):
        tag.setMpaa(c["cert"])
    if c.get("runtime"):
        tag.setDuration(int(c["runtime"]) * 60)
        li.setProperty("korie.runtime", duration_text(int(c["runtime"]) * 60))
    if c.get("director"):
        tag.setDirectors([c["director"]])
    if c.get("cast"):
        tag.setCast([xbmc.Actor(a.get("name", ""), a.get("role", ""), i, server_pic(a.get("photo"))) for i, a in enumerate(c["cast"])])
    if c.get("watched"):
        tag.setPlaycount(1)
    # where you got to: exact from the server when it has it, else worked out from the share watched
    total = float(c.get("duration") or 0) or float(c.get("runtime") or 0) * 60
    pos = float(c.get("position") or 0) or (c.get("progress") or 0) * total
    if total and 0 < pos < total:
        tag.setResumePoint(pos, total)
        li.setProperty("korie.left", duration_text(total - pos) + " left")
        li.setProperty("korie.resumeat", clock(pos))
        li.setProperty("korie.pos", str(int(pos)))


def duration_text(seconds):
    m = int(seconds // 60)
    h, m = divmod(m, 60)
    return ("%d h %d min" % (h, m)) if h else ("%d min" % max(m, 1))


def clock(seconds):
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return ("%d:%02d:%02d" % (h, m, s)) if h else ("%d:%02d" % (m, s))


def card_item(server, c, context=True):
    kind = c.get("kind", "")
    label = c.get("title", "")
    li = xbmcgui.ListItem(label, c.get("subtitle", ""), offscreen=True)
    def pic(u, width):
        """The server shrinks its pictures to the width asked for (w=); cards don't need big ones."""
        u = server.absolute(u)
        return u + ("&" if "?" in u else "?") + "w=%d" % width if "/img/" in u else u
    poster, thumb, backdrop = c.get("poster"), c.get("thumb"), c.get("backdrop")
    li.setArt({
        "poster": pic(poster, 342), "thumb": pic(thumb or poster, 500 if thumb else 342),
        "fanart": pic(backdrop, 1280), "landscape": pic(thumb or backdrop, 780),
        "icon": pic(poster or thumb, 342),
    })
    info_tag(li, kind, c, server.absolute)
    li.setProperty("korie.kind", kind)
    li.setProperty("korie.id", c.get("id", ""))
    li.setProperty("korie.source", c.get("source", ""))
    li.setProperty("korie.subtitle", c.get("subtitle", ""))
    # for Korie's options menu (the Menu button): what it can offer for this thing
    li.setProperty("korie.watched", "1" if c.get("watched") else "")
    li.setProperty("korie.fav", "1" if c.get("favourite") else "")
    li.setProperty("korie.disc", c.get("disc", ""))
    li.setProperty("korie.fixable", "1" if c.get("local") and kind in ("film", "series") else "")
    li.setProperty("korie.cert", c.get("cert") or "")
    # what it is, above its name on a Favourites tile ("Series", "From DRTV")
    li.setProperty("korie.caption", ("From " + c["source"]) if c.get("source") else CAPTIONS.get(kind, ""))
    if kind == "track":
        li.setProperty("korie.n", str(c.get("n") or ""))
        if c.get("length"):
            li.setProperty("korie.length", clock(c["length"]))
        # OK plays the album from this song on (Kodi runs it, like a channel)
        return url(a="song", id=c["id"], album=c.get("album", "")), li, False
    if kind == "artist":
        return url(a="music", artist=c.get("title", "")), li, True
    if kind == "genre":
        return url(a="music", genre=c.get("title", "")), li, True
    if kind == "playlist":
        return url(a="music", playlist=c["id"].split(":", 1)[1]), li, True
    if kind in FOLDER_KINDS:
        return url(a="page" if kind == "page" else "item", id=c["id"]), li, True
    if kind == "live":
        # a channel starts on OK: no film page in between (Kodi runs "watch", which plays it)
        return url(a="watch", id=c["id"]), li, False
    li.setProperty("IsPlayable", "true")
    return url(a="play", id=c["id"]), li, False


def folder(label, art_icon="", **target):
    li = xbmcgui.ListItem(label, offscreen=True)
    if art_icon:
        li.setArt({"icon": art_icon, "thumb": art_icon})
    return url(**target), li, True


def show(items, content="videos", sort=False, title=""):
    if title:
        xbmcplugin.setPluginCategory(HANDLE, title)
    xbmcplugin.setContent(HANDLE, content)
    xbmcplugin.addDirectoryItems(HANDLE, items, len(items))
    if sort:
        xbmcplugin.addSortMethod(HANDLE, xbmcplugin.SORT_METHOD_LABEL_IGNORE_THE)
    xbmcplugin.addSortMethod(HANDLE, xbmcplugin.SORT_METHOD_UNSORTED)
    xbmcplugin.endOfDirectory(HANDLE, succeeded=True, cacheToDisc=False)


def tabs(current, entries):
    """The tabs at the top of a list screen: (id, label, address), the current one marked."""
    on = [tid for tid, _, _ in entries[:8]].index(current) if current in [tid for tid, _, _ in entries[:8]] else 0
    xbmcplugin.setProperty(HANDLE, "korie.tabon", str(on))
    for n, (tid, label, address) in enumerate(entries[:8], 1):
        xbmcplugin.setProperty(HANDLE, "korie.tab%d.label" % n, label)
        xbmcplugin.setProperty(HANDLE, "korie.tab%d.url" % n, address)
        xbmcplugin.setProperty(HANDLE, "korie.tab%d.on" % n, "1" if tid == current else "")


def content_of(cards):
    kinds = {c.get("kind") for c in cards}
    return CONTENT.get(kinds.pop(), "videos") if len(kinds) == 1 else "videos"


def rows_page(server, rows, status=""):
    """A page of rows: one row shows its items, several show one folder per row."""
    rows = [r for r in rows if r.get("items")]
    if len(rows) == 1:
        cards = rows[0]["items"]
        return show([card_item(server, c) for c in cards], content_of(cards))
    if not rows and status:
        xbmcgui.Dialog().notification("Korie", status.split("\n")[0], xbmcgui.NOTIFICATION_INFO, 5000)
    items = []
    for i, r in enumerate(rows):
        li = xbmcgui.ListItem(r["title"], offscreen=True)
        first = r["items"][0]
        li.setArt({"thumb": server.absolute(first.get("poster") or first.get("thumb")), "fanart": server.absolute(first.get("backdrop"))})
        items.append((url(a="rows", path=ARGS.get("a", ""), id=ARGS.get("id", ""), source=ARGS.get("source", ""), n=str(i)), li, True))
    show(items)


# --- pages ------------------------------------------------------------------------------------

def root(server):
    if screens.korie_skin():
        # the Korie skin's menu is on the left of every screen: this list is only reached by going
        # back past a screen's first page, which means leaving the screen
        xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
        xbmc.executebuiltin("ReplaceWindow(Home)")
        return
    me = server.call("/api/me")
    name = me["person"]["name"]
    items = [
        folder("Home", a="home"),
        folder("Films", a="films"),
        folder("Series", a="series"),
        folder("Music", a="music"),
        folder("Live TV", a="live"),
    ]
    if me.get("games"):
        items.append(folder("Games", a="games"))
    items += [folder("Search", a="search"), folder("Switch profile (%s)" % name, a="profile")]
    xbmcplugin.setContent(HANDLE, "files")
    xbmcplugin.addDirectoryItems(HANDLE, items, len(items))
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=False)


def fetch_rows(server, a, id_="", source=""):
    if a in ("films", "series"):
        return server.get("/api/" + a, source=source).get("rows", [])
    if a == "home":
        return server.call("/api/home").get("rows", [])
    if a == "live":
        return server.call("/api/live").get("rows", [])
    if a == "games":
        return server.call("/api/games").get("rows", [])
    if a == "page":
        return server.get("/api/page", id=id_).get("rows", [])
    return []


def section(server, which):
    """Films or series: your own, then one folder per add-on that has some."""
    source, shown, order = ARGS.get("source", ""), ARGS.get("show", "all"), ARGS.get("sort", "added")
    d = server.get("/api/" + which, source=source, show=shown, sort=order)
    if not source:
        # All / Unwatched / In progress, and the order (each press of it moves to the next one)
        orders = [("added", "Newest"), ("title", "A to Z"), ("year", "Year"), ("rating", "Rating")]
        names = dict(orders)
        after = orders[([o for o, _ in orders].index(order) + 1) % len(orders)][0] if order in names else "title"
        tabs(shown, [(t, label, url(a=which, show=t, sort=order)) for t, label in
                     (("all", "All"), ("unwatched", "Unwatched"), ("progress", "In progress"))] +
             [("", "Sort: " + names.get(order, "Newest"), url(a=which, show=shown, sort=after))])
    items = []
    cards = d.get("items") or []
    if not cards and d.get("rows"):
        # an add-on's films/series come as rows
        return rows_page(server, d["rows"])
    items += [card_item(server, c) for c in cards]
    if not items and d.get("status"):
        xbmcplugin.setProperty(HANDLE, "korie.empty", d["status"].split("\n")[0])
    show(items, "movies" if which == "films" else "tvshows", title="Films" if which == "films" else "Series")


def item_page(server, id_):
    """A series (its seasons and episodes) or an album (its tracks)."""
    d = server.get("/api/item", id=id_)
    if d.get("error"):
        xbmcgui.Dialog().notification("Korie", d["error"], xbmcgui.NOTIFICATION_ERROR, 6000)
    if d.get("tracks") is not None:
        cards = [dict(t, kind="track", subtitle=t.get("artist") or d.get("artist", ""), poster=d.get("poster"),
                      thumb=d.get("poster"), backdrop=d.get("backdrop"), year=d.get("year", ""),
                      album=id_, n=t.get("n"), length=t.get("duration")) for t in d["tracks"]]
        xbmcplugin.setProperty(HANDLE, "korie.note", "%s%s" % (d.get("artist", ""), " · %s" % d["year"] if d.get("year") else ""))
        return show([card_item(server, c) for c in cards], "songs", title=d.get("title", ""))
    seasons = d.get("seasons") or []
    if not seasons:
        return show([], "episodes", title=d.get("title", ""))
    series_page(server, id_, d, seasons)


def series_page(server, id_, d, seasons):
    """A series: what it is on the left, its seasons as tabs and the chosen season's episodes."""
    every = [(s, e) for s in seasons for e in s.get("episodes", [])]
    # where to carry on: an episode half watched, else the one after the last watched, else the first
    nxt = next(((s, e) for s, e in every if 0 < (e.get("progress") or 0) and not e.get("watched")), None)
    if nxt is None:
        last = max([i for i, (_, e) in enumerate(every) if e.get("watched")] or [-1])
        nxt = every[last + 1] if last + 1 < len(every) else (every[0] if every else None)
    # the season shown: one picked with the tabs (kept while Kodi runs), else the one to carry on in
    season = ARGS.get("season") or ui.HOME.getProperty("korie.season." + id_) or None
    if season is None:
        season = str(nxt[0].get("n")) if nxt else str(seasons[0].get("n"))
    chosen = [s for s in seasons if str(s.get("n")) == season] or seasons[:1]
    if len(seasons) > 1:
        tabs(season, [(str(s.get("n")), s.get("title") or "Season %s" % s.get("n"), url(a="season", id=id_, season=str(s.get("n"))))
                      for s in seasons])
    watched = sum(1 for _, e in every if e.get("watched"))
    n_eps = len(every)
    prop = lambda k, v: xbmcplugin.setProperty(HANDLE, "korie.series." + k, v)
    xbmcplugin.setProperty(HANDLE, "korie.series", "1")
    prop("title", d.get("title", ""))
    prop("meta", "  ·  ".join(x for x in [
        str(d.get("year") or ""), "1 season" if len(seasons) == 1 else "%d seasons" % len(seasons),
        "1 episode" if n_eps == 1 else "%d episodes" % n_eps, ("%.1f / 10" % float(d["rating"])) if d.get("rating") else ""] if x))
    prop("genres", ", ".join(d.get("genres") or []))
    prop("plot", d.get("overview", ""))
    prop("poster", server.absolute(d.get("poster")))
    prop("count", "%d of %d watched" % (watched, n_eps) if watched else "")
    if nxt:
        s, e = nxt
        verb = "Resume" if 0 < (e.get("progress") or 0) else ("Play" if not watched else "Next")
        prop("button", "%s S%s · E%s" % (verb, s.get("n"), e.get("n")))
        total = float(e.get("duration") or 0) or float(e.get("runtime") or 0) * 60
        start = int(float(e.get("position") or 0) or (e.get("progress") or 0) * total) if verb == "Resume" else 0
        prop("play", url(a="play", id=e["id"], **({"from": str(start)} if start else {})))
    items = []
    for s in chosen:
        for e in s.get("episodes", []):
            c = dict(e, kind="episode", backdrop=d.get("backdrop"), poster=d.get("poster"))
            target, li, isf = card_item(server, c)
            tag = li.getVideoInfoTag()
            tag.setSeason(int(s.get("n") or 0))
            tag.setEpisode(int(e.get("n") or 0))
            tag.setTvShowTitle(d.get("title", ""))
            li.setLabel("%s. %s" % (e.get("n"), e.get("title", "")))
            items.append((target, li, isf))
    show(items, "episodes", title=d.get("title", ""))


def search(server):
    q = ARGS.get("q") or xbmcgui.Dialog().input("Search")
    if not q:
        return xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
    groups = server.get("/api/search", q=q).get("groups", [])
    items = []
    for g in groups:
        for c in g.get("items", []):
            target, li, isf = card_item(server, c)
            if len(groups) > 1:
                li.setLabel2(g["title"])
            items.append((target, li, isf))
    if not items:
        xbmcgui.Dialog().notification("Korie", "Nothing found for \"%s\"." % q, xbmcgui.NOTIFICATION_INFO, 4000)
    show(items, title="Search: %s" % q)


def widget_row(server, n):
    """For the Korie skin's home screen: row n of Home, and its title as a window property."""
    rows = [r for r in server.call("/api/home").get("rows", []) if r.get("items")]
    r = rows[n - 1] if 0 < n <= len(rows) else None
    HOME_WINDOW.setProperty("korie.row.%d.title" % n, r["title"] if r else "")
    HOME_WINDOW.setProperty("korie.row.%d.kind" % n, r.get("kind", "poster") if r else "")
    HOME_WINDOW.setProperty("korie.rows", str(len(rows)))
    cards = r["items"] if r else []
    show([card_item(server, c) for c in cards], content_of(cards))


# --- music ------------------------------------------------------------------------------------

MUSIC_ORDERS = [("added", "Newest"), ("artist", "Artist A–Z"), ("title", "A to Z"), ("year", "Year")]


def music(server, by, artist="", genre="", playlist=""):
    """Music: albums, artists, songs, genres or playlists (the tabs at the top); or one artist's or
    genre's albums, or a playlist's songs."""
    if artist or genre:
        d = server.get("/api/music", artist=artist, genre=genre)
        cards = d.get("items", [])
        xbmcplugin.setProperty(HANDLE, "korie.note", "1 album" if len(cards) == 1 else "%d albums" % len(cards))
        return show([card_item(server, c) for c in cards], "albums", title=artist or genre)
    if playlist:
        d = server.get("/api/music", playlist=playlist)
        cards = d.get("items", [])
        xbmcplugin.setProperty(HANDLE, "korie.note", "1 song" if len(cards) == 1 else "%d songs" % len(cards))
        xbmcplugin.setProperty(HANDLE, "korie.playlist", playlist)
        if not cards:
            xbmcplugin.setProperty(HANDLE, "korie.empty", d.get("status", ""))
        # OK plays the playlist from that song on
        return show([card_item(server, dict(c, album="playlist:" + playlist)) for c in cards], "songs", title=d.get("title", "Playlist"))
    order = ARGS.get("sort", "added")
    names = dict(MUSIC_ORDERS)
    after = MUSIC_ORDERS[([o for o, _ in MUSIC_ORDERS].index(order) + 1) % len(MUSIC_ORDERS)][0] if order in names else "artist"
    d = server.get("/api/music", by=by, sort=order)
    cards = d.get("items", [])
    n = d.get("counts") or {}
    xbmcplugin.setProperty(HANDLE, "korie.section", "music")
    entries = [(t, label, url(a="music", by=t, sort=order)) for t, label in
               (("albums", "Albums"), ("artists", "Artists"), ("songs", "Songs"), ("genres", "Genres"), ("playlists", "Playlists"))]
    if by == "albums":
        entries.append(("", "Sort: " + names.get(order, "Newest"), url(a="music", by=by, sort=after)))
    tabs(by, entries)
    xbmcplugin.setProperty(HANDLE, "korie.note", "%s · %s" % (
        "1 album" if n.get("albums") == 1 else "%d albums" % n.get("albums", 0),
        "1 artist" if n.get("artists") == 1 else "%d artists" % n.get("artists", 0)))
    items = [card_item(server, c) for c in cards]
    if by == "playlists":
        li = xbmcgui.ListItem("New playlist", offscreen=True)
        li.setArt({"icon": "korie/add-tile.png", "thumb": "korie/add-tile.png"})
        li.setProperty("korie.kind", "newplaylist")
        items.append((url(a="newplaylist"), li, False))
    elif not cards and d.get("status"):
        xbmcplugin.setProperty(HANDLE, "korie.empty", d["status"])
    show(items, {"artists": "artists", "songs": "songs", "genres": "artists", "playlists": "albums"}.get(by, "albums"), title="Music")


def new_playlist(server, item=""):
    """A new playlist (with item on it already: from Add to playlist)."""
    name = xbmcgui.Dialog().input("Name of the playlist")
    if not name.strip():
        return None
    r = server.call("/api/playlists", {"name": name.strip(), **({"item": item} if item else {})})
    xbmcgui.Dialog().notification("Korie", "%s made." % r["name"], xbmcgui.NOTIFICATION_INFO, 2500)
    refresh()
    return r


def add_to_playlist(server, item):
    lists = server.get("/api/playlists").get("playlists", [])
    i = screens.menu("Add to playlist", [{"label": p["name"], "note": "%d songs" % p["count"]} for p in lists] +
                     [{"label": "New playlist", "icon": "plus", "gap": bool(lists)}])
    if i < 0:
        return
    if i == len(lists):
        return new_playlist(server, item)
    n = server.call("/api/playlists/" + lists[i]["id"], {"add": item}).get("added", 0)
    xbmcgui.Dialog().notification("Korie", "Added to %s." % lists[i]["name"] if n else "It's on %s already." % lists[i]["name"],
                                  xbmcgui.NOTIFICATION_INFO, 2500)


def playlist_menu(server, pid, name):
    i = screens.menu(name, [{"label": "Rename"}, {"label": "Delete %s…" % name, "danger": True}])
    if i == 0:
        t = xbmcgui.Dialog().input("Name of the playlist", name)
        if t.strip():
            server.call("/api/playlists/" + pid, {"name": t.strip()})
            refresh()
    elif i == 1 and xbmcgui.Dialog().yesno("Delete %s?" % name, "The songs stay in your music.", nolabel="Keep", yeslabel="Delete"):
        server.call("/api/playlists/" + pid, method="DELETE")
        refresh()


def play_album(server, album, track):
    """An album from one of its songs on: Kodi's music playlist, then Now playing."""
    d = server.get("/api/item", id=album) if album else {}
    tracks = d.get("tracks") or [{"id": track, "title": ""}]
    cover = server.absolute(d.get("poster")) if d.get("poster") else ""
    playlist = xbmc.PlayList(xbmc.PLAYLIST_MUSIC)
    playlist.clear()
    start = 0
    for i, t in enumerate(tracks):
        if t["id"] == track:
            start = i
        li = xbmcgui.ListItem(t.get("title", ""), offscreen=True)
        li.setProperty("IsPlayable", "true")
        tag = li.getMusicInfoTag()
        tag.setTitle(t.get("title", ""))
        tag.setArtist(t.get("artist") or d.get("artist", ""))
        tag.setAlbum(d.get("title", ""))
        tag.setTrack(int(t.get("n") or i + 1))
        if t.get("duration"):
            tag.setDuration(int(t["duration"]))
        if str(d.get("year", "")).isdigit():
            tag.setYear(int(d["year"]))
        tag.setMediaType("song")
        if cover:
            li.setArt({"thumb": cover, "fanart": server.absolute(d.get("backdrop")) if d.get("backdrop") else ""})
        playlist.add(url(a="play", id=t["id"], music="1", album=album, year=str(d.get("year") or ""),
                         n=str(t.get("n") or i + 1), cover=cover), li)
    # Korie's service opens Now playing once the music plays (Kodi won't open it before)
    HOME_WINDOW.setProperty("korie.music.show", "1")
    xbmc.Player().play(playlist, startpos=start)


# --- playing ----------------------------------------------------------------------------------

def play(server, id_, direct=False, start=0):
    """direct: started with RunPlugin (channels), so play it here instead of handing it back to Kodi.
    start: where to begin, in seconds (Resume in Korie's options menu)."""
    def give_up():
        if not direct:
            xbmcplugin.setResolvedUrl(HANDLE, False, xbmcgui.ListItem())

    try:
        body = {"id": id_, "kodi": True}
        if ARGS.get("menu") in ("0", "1"):
            body["menu"] = ARGS["menu"] == "1"
        elif not ui.disc_menu():
            body["menu"] = False
        plan = server.call("/api/play", body)
    except KorieError as e:
        fail(e)
        return give_up()
    if plan.get("web"):
        give_up()
        open_web(plan["web"])
        return
    target = server.absolute(plan.get("url"))
    if ARGS.get("music") == "1":
        li = xbmcgui.ListItem(plan.get("title", ""), path=target, offscreen=True)
        tag = li.getMusicInfoTag()
        tag.setTitle(plan.get("title", ""))
        bits = (plan.get("subtitle") or "").split(" · ")
        if bits and bits[0]:
            tag.setArtist(bits[0])
        if len(bits) > 1:
            tag.setAlbum(bits[1])
        if ARGS.get("year", "").isdigit():
            tag.setYear(int(ARGS["year"]))
        if ARGS.get("n", "").isdigit():
            tag.setTrack(int(ARGS["n"]))
        tag.setMediaType("song")
        if ARGS.get("cover"):
            li.setArt({"thumb": ARGS["cover"]})
        if plan.get("mode") != "kodi":
            li.setContentLookup(False)
        xbmcplugin.setResolvedUrl(HANDLE, True, li)
        return
    li = xbmcgui.ListItem(plan.get("title", ""), path=target, offscreen=True)
    # what the player shows at the top: the title, or the series, season and episode
    tag = li.getVideoInfoTag()
    tag.setTitle(plan.get("title", ""))
    ep = plan.get("episode")
    if ep:
        tag.setMediaType("episode")
        tag.setTvShowTitle(ep.get("show", ""))
        tag.setSeason(int(ep.get("season") or 0))
        tag.setEpisode(int(ep.get("episode") or 0))
    elif not plan.get("live"):
        tag.setMediaType("movie")
    if plan.get("mode") != "kodi":
        # the server converts it (a disc folder, say): it arrives as MP4
        li.setMimeType("video/mp4")
        li.setContentLookup(False)
    if plan.get("subs"):
        li.setSubtitles([server.absolute(s) for s in plan["subs"]])
    if plan.get("live") and ".m3u8" in target.split("|")[0]:
        li.setProperty("inputstream", "inputstream.adaptive") if xbmc.getCondVisibility("System.HasAddon(inputstream.adaptive)") else None
        li.setMimeType("application/vnd.apple.mpegurl")
        li.setContentLookup(False)
    if plan.get("discMenu"):
        # the disc's own menu comes first; remembered so "Skip the menu, play the film" knows what to play
        start = 0
        HOME_WINDOW.setProperty("korie.disc.id", id_)
    else:
        HOME_WINDOW.clearProperty("korie.disc.id")
    tracker = Tracker(server, id_, start, bool(plan.get("live")), plan.get("languages"))
    if direct:
        tracker.play(target, li)
    else:
        xbmcplugin.setResolvedUrl(HANDLE, True, li)
    tracker.run()


class Tracker(xbmc.Player):
    """Watches the playback this add-on started: seeks to the resume point, and tells the
    server how far you got (so every screen in the house can carry on from there)."""

    def __init__(self, server, id_, resume, live, languages=None):
        super().__init__()
        self.server, self.id, self.resume, self.live = server, id_, resume, live
        self.languages = languages or {}
        self.started = False
        self.done = False
        self.pos = 0.0
        self.total = 0.0

    def onAVStarted(self):
        self.started = True
        if self.resume > 0:
            self.seekTime(self.resume)
        try:
            pick_tracks(self.languages.get("audio", ""), self.languages.get("subs", ""))
        except Exception as e:  # noqa: BLE001 - the film plays anyway, in Kodi's own choice
            log("couldn't pick the tracks: %s" % e)

    def onPlayBackEnded(self):
        self.report(ended=True)
        self.done = True

    def onPlayBackStopped(self):
        self.report()
        self.done = True

    def onPlayBackError(self):
        self.done = True

    def report(self, ended=False):
        if self.live or (not ended and self.pos < 5):
            return
        try:
            self.server.call("/api/progress", {"id": self.id, "position": self.total if ended else self.pos,
                                               "duration": self.total or self.pos, "ended": ended}, timeout=5)
        except KorieError as e:
            log(e)

    def run(self):
        monitor = xbmc.Monitor()
        waited = 0.0
        last = 0.0
        while not self.done and not monitor.abortRequested():
            if monitor.waitForAbort(1):
                break
            waited += 1
            if not self.started:
                if waited > 60:
                    break
                continue
            try:
                if self.isPlaying():
                    self.pos = self.getTime()
                    self.total = self.getTotalTime() or self.total
            except RuntimeError:
                pass
            if self.pos - last >= 15 or last - self.pos >= 15:
                last = self.pos
                self.report()


def _same_language(a, b):
    """eng / en / English are the same language."""
    if not a or not b:
        return False
    norm = lambda x: (xbmc.convertLanguage(x, xbmc.ISO_639_2) or x).lower()  # noqa: E731
    return a.lower() == b.lower() or norm(a) == norm(b)


def pick_tracks(audio, subs):
    """The person's languages: their audio when the film has it; subtitles in their language when
    the audio isn't in it, none for "off", the film's own choice for "" (as the server's plan does)."""
    rpc = screens.rpc
    players = [p["playerid"] for p in rpc("Player.GetActivePlayers") or [] if p.get("type") == "video"]
    if not players:
        return
    pid = players[0]
    props = rpc("Player.GetProperties", playerid=pid,
                properties=["audiostreams", "currentaudiostream", "subtitles"]) or {}
    current = props.get("currentaudiostream") or {}
    if audio:
        mine = next((a for a in props.get("audiostreams") or [] if _same_language(a.get("language"), audio)), None)
        if mine and mine.get("index") != current.get("index"):
            rpc("Player.SetAudioStream", playerid=pid, stream=mine["index"])
            current = mine
    if not subs:
        return
    if subs == "off" or _same_language(current.get("language"), subs):
        rpc("Player.SetSubtitle", playerid=pid, subtitle="off")
        return
    mine = next((s for s in props.get("subtitles") or [] if _same_language(s.get("language"), subs) and not s.get("isforced")), None)
    if mine:
        rpc("Player.SetSubtitle", playerid=pid, subtitle=mine["index"], enable=True)
    else:
        rpc("Player.SetSubtitle", playerid=pid, subtitle="off")


def open_web(address):
    """Games (RomM) and other web pages: Kodi can't show web pages, so hand them to the device."""
    if xbmc.getCondVisibility("System.Platform.Android"):
        xbmc.executebuiltin('StartAndroidActivity("","android.intent.action.VIEW","","%s")' % address)
    elif xbmc.getCondVisibility("System.Platform.Windows") or xbmc.getCondVisibility("System.Platform.OSX") or xbmc.getCondVisibility("System.Platform.Linux"):
        import webbrowser
        if not webbrowser.open(address):
            xbmcgui.Dialog().ok("Korie", "Open this in a browser:\n" + address)
    else:
        xbmcgui.Dialog().ok("Korie", "Open this in a browser:\n" + address)


# --- the skin's screens ------------------------------------------------------------------------

def people(force_switch=False):
    """For "Who's watching?": the server's people as properties; with one person and no PIN,
    straight Home."""
    try:
        server = korie.server_only()
    except KorieError as e:
        ui.show_people([], str(e))
        return
    if server is None:
        ui.show_people([], "No Korie server yet. Choose Settings, then Korie server.")
        return
    ui.show_server(korie.load_state())
    # once per start: a TV that signs in as someone by itself (Settings, People) goes straight Home
    if not ui.HOME.getProperty("korie.autotried") and not ui.HOME.getProperty("korie.person.name"):
        ui.HOME.setProperty("korie.autotried", "1")
        person = korie.auto_sign_in(server)
        if person:
            ui.set_person(person)
            ui.show_home(server)
            xbmc.executebuiltin("ReplaceWindow(Home)")
            return
    ui.HOME.setProperty("korie.autotried", "1")
    try:
        found = server.call("/api/people")
    except KorieError as e:
        ui.show_people([], str(e))
        return
    ui.show_people(found, "" if found else "This server has no people yet.")
    if len(found) == 1 and not found[0].get("hasPin") and not ui.HOME.getProperty("korie.person.name"):
        sign_in(server, found[0])


def sign_in(server, person):
    if korie.sign_in(server, person):
        ui.set_person(person)
        ui.show_home(server)
        xbmc.executebuiltin("ReplaceWindow(Home)")


def as_admin():
    """For Add person and Manage people on Who's watching: an admin says who they are (their PIN),
    without this screen signing in as them. A Server with their session, or None."""
    server = korie.server_only()
    if server is None:
        return None
    admins = [p for p in server.call("/api/people") if p.get("admin")]
    if not admins:
        return None
    who = admins[0]
    if len(admins) > 1:
        i = screens.menu("Which admin are you?", [{"label": p["name"]} for p in admins])
        if i < 0:
            return None
        who = admins[i]
    temp = korie.Server(server.url)
    return temp if korie.sign_in(temp, who, keep=False) else None


def add_person():
    server = as_admin()
    if server is None:
        return
    try:
        name = xbmcgui.Dialog().input("Name of the new person")
        if name.strip():
            server.call("/api/people", {"name": name.strip()})
    finally:
        server.call("/api/logout", {})
    people()


def manage_people_signed_out():
    server = as_admin()
    if server is None:
        return
    from resources.lib import people as people_screen
    try:
        people_screen.show(server, go_now=False, signed_out=True)
    finally:
        server.call("/api/logout", {})
    people()


def sign_in_slot(n):
    pid = ui.HOME.getProperty("korie.p.%s.id" % n)
    server = korie.server_only()
    if not pid or server is None:
        return
    person = next((p for p in server.call("/api/people") if p["id"] == pid), None)
    if person:
        sign_in(server, person)


def apps_page(server, tab="all"):
    """Android apps (on Android only): the ones this person may open, as tiles."""
    from resources.lib import apps
    person = server.call("/api/me").get("person") or {}
    shown, hidden, note, total = apps.listing(server, person, tab)
    entries = [("all", "All", url(a="apps", tab="all")), ("recent", "Recently used", url(a="apps", tab="recent"))]
    if hidden or tab == "hidden":
        entries.append(("hidden", "Hidden · %d" % hidden, url(a="apps", tab="hidden")))
    tabs(tab, entries)
    xbmcplugin.setProperty(HANDLE, "korie.section", "apps")
    xbmcplugin.setProperty(HANDLE, "korie.note", note or ("1 Android app on this TV" if total == 1 else "%d Android apps on this TV" % total))
    xbmcplugin.setProperty(HANDLE, "korie.empty", {"recent": "Apps you open show up here.", "hidden": "No hidden apps."}.get(tab, "No apps you may open."))
    items = []
    for a in shown:
        li = xbmcgui.ListItem(a["label"], "Android app", offscreen=True)
        li.setArt({"icon": a.get("icon") or "korie/icon-apps.png", "thumb": a.get("icon") or ""})
        li.setProperty("korie.kind", "app")
        li.setProperty("korie.id", a["pkg"])
        li.setProperty("korie.letter", a["label"][:1].upper())
        items.append((url(a="app", pkg=a["pkg"]), li, False))
    show(items, "files", title="Apps")


def app_options(pkg, label):
    from resources.lib import apps
    hidden = apps.is_hidden(pkg)
    choices = [
        ({"label": "Open", "icon": "play"}, lambda: apps.start(pkg)),
        ({"label": "Show again" if hidden else "Hide on this TV"}, lambda: (apps.set_hidden(pkg, not hidden), refresh())),
        ({"label": "App info", "gap": True}, lambda: apps.info(pkg)),
        ({"label": "Uninstall…", "danger": True}, lambda: apps.uninstall(pkg)),
    ]
    i = screens.menu(label, [o for o, _ in choices])
    if i >= 0:
        choices[i][1]()


def addons_page(server, tab="mine"):
    """Add-ons: the ones you have (each a folder of what it has), more from the Store, themes,
    and updates. Getting and turning them on is for admins and those allowed to (People)."""
    d = server.call("/api/addons")
    addons = [a for a in d.get("addons", []) if not a.get("games")]
    mine = [a for a in addons if a.get("installed")]
    try:
        th = server.call("/api/themes")
    except KorieError as e:
        log(e)
        th = {"themes": [], "store": []}
    themes = th.get("themes", []) + th.get("store", [])
    updates = [a for a in mine if a.get("status") == "update"] + [t for t in th.get("themes", []) if t.get("update")]
    entries = [("mine", "Installed · %d" % len(mine), url(a="addons", tab="mine")),
               ("store", "Get more", url(a="addons", tab="store")),
               ("themes", "Themes", url(a="addons", tab="themes"))]
    if updates or tab == "updates":
        entries.append(("updates", "Updates · %d" % len(updates), url(a="addons", tab="updates")))
    tabs(tab, entries)
    xbmcplugin.setProperty(HANDLE, "korie.section", "addons")
    if d.get("store", {}).get("error"):
        xbmcplugin.setProperty(HANDLE, "korie.note", d["store"]["error"])
    elif not d.get("canInstall"):
        xbmcplugin.setProperty(HANDLE, "korie.note", "Ask an admin to let you get add-ons")
    items = []
    if tab == "themes":
        items = [theme_item(t) for t in themes]
    elif tab == "updates":
        items = [addon_item(a) if "status" in a else theme_item(a) for a in updates]
    else:
        for a in (mine if tab == "mine" else [a for a in addons if not a.get("installed")]):
            items.append(addon_item(a))
    if not items:
        xbmcplugin.setProperty(HANDLE, "korie.empty", {
            "mine": "No add-ons yet. Get them under Get more.",
            "store": "Loading the Store…" if d.get("store", {}).get("loading") else "Nothing more in the Store.",
            "updates": "Everything is up to date.", "themes": "No themes."}.get(tab, ""))
    show(items, "files", title="Add-ons")


ADDON_STATE = {"builtin": "comes with Korie", "update": "update ready", "installed": "installed"}


def addon_item(a):
    on = a.get("installed") and a.get("enabled")
    state = "off" if a.get("installed") and not a.get("enabled") else ADDON_STATE.get(a.get("status", ""), "")
    li = xbmcgui.ListItem(a["name"], "Add-on" + (" · " + state if state else ""), offscreen=True)
    li.getVideoInfoTag().setPlot(a.get("error") or a.get("description", ""))
    li.setArt({"icon": "korie/icon-addons.png", "thumb": "korie/icon-addons.png"})
    li.setProperty("korie.kind", "addon")
    li.setProperty("korie.id", a["id"])
    li.setProperty("korie.subtitle", li.getLabel2())
    may = ui.HOME.getProperty("korie.may.install")
    li.setProperty("korie.button", "" if not may else "Install" if not a.get("installed") else "Update" if a.get("status") == "update"
                   else "Turn on" if not on else "")
    if on:
        return url(a="addon", id=a["id"]), li, True
    # not on yet: OK does what its button says (Menu shows everything that can be done with it)
    return url(a="addonmenu", id=a["id"], go="1"), li, False


def theme_item(t):
    tid = ui.current_theme()
    state = "in use" if t["id"] == tid else "update ready" if t.get("update") else "on the server" if t.get("installed") else ""
    li = xbmcgui.ListItem(t["name"], "Theme" + (" · " + state if state else ""), offscreen=True)
    li.getVideoInfoTag().setPlot(t.get("description") or ("By %s" % t["author"] if t.get("author") else ""))
    li.setArt({"icon": "korie/icon-palette.png", "thumb": "korie/icon-palette.png"})
    li.setProperty("korie.kind", "theme")
    li.setProperty("korie.id", t["id"])
    li.setProperty("korie.subtitle", li.getLabel2())
    li.setProperty("korie.button", "In use" if t["id"] == tid else "Use it" if t.get("installed")
                   else "Install" if ui.HOME.getProperty("korie.may.install") else "")
    return url(a="thememenu", id=t["id"], go="1"), li, False


def addon_menu(server, aid):
    """What can be done with an add-on: get it, update it, turn it on or off, remove it."""
    a = server.get("/api/addon", id=aid)
    may = ui.HOME.getProperty("korie.may.install")
    choices = []
    if a.get("installed") and a.get("enabled"):
        choices.append(({"label": "Open", "icon": "play"},
                        lambda: xbmc.executebuiltin("Container.Update(%s)" % url(a="addon", id=aid))))
    if may and not a.get("error"):
        if not a.get("installed"):
            choices.append(({"label": "Install", "icon": "" if choices else "play"}, lambda: addon_action(server, a, "install")))
        else:
            if a.get("status") == "update":
                choices.append(({"label": "Update to %s" % a.get("storeVersion")}, lambda: addon_action(server, a, "install")))
            choices.append(({"label": "Turn off" if a.get("enabled") else "Turn on"},
                            lambda: addon_action(server, a, "disable" if a.get("enabled") else "enable")))
            if not a.get("builtin"):
                choices.append(({"label": "Remove…", "danger": True, "gap": True}, lambda: addon_action(server, a, "remove")))
    if not choices:
        xbmcgui.Dialog().ok(a["name"], a.get("error") or ("Ask an admin to get %s for Korie.\n\n%s" % (a["name"], a.get("description", ""))))
        return
    if ARGS.get("go") and may:
        return choices[0][1]()
    i = screens.menu(a["name"], [o for o, _ in choices])
    if i >= 0:
        choices[i][1]()


def addon_action(server, a, action):
    name = a["name"]
    if action == "remove" and not xbmcgui.Dialog().yesno("Remove %s?" % name, "It goes from Korie on every screen.", nolabel="Keep it", yeslabel="Remove"):
        return
    body = {"id": a["id"]}
    if action == "enable" and a.get("internet"):
        hosts = ", ".join(a.get("hosts") or []) or "the addresses in its settings"
        if not xbmcgui.Dialog().yesno("Turn on %s?" % name, "It fetches things from %s. It can't open the server's files." % hosts,
                                      nolabel="Not now", yeslabel="Turn on"):
            return
        body["internet"] = True
    if action == "install":
        xbmcgui.Dialog().notification("Korie", "Getting %s…" % name, xbmcgui.NOTIFICATION_INFO, 2500)
    try:
        r = server.call("/api/addon/" + action, body, timeout=120)
    except KorieError as e:
        return fail(e)
    if r.get("needsInternet"):
        a = dict(a, internet=True, hosts=r.get("hosts"))
        return addon_action(server, a, "enable")
    done = {"install": "%s is on the server. Turn it on to use it." if not a.get("installed") else "%s is updated.",
            "enable": "%s is on.", "disable": "%s is off.", "remove": "%s is removed."}[action]
    xbmcgui.Dialog().notification("Korie", done % name, xbmcgui.NOTIFICATION_INFO, 3000)
    refresh()


def theme_menu(server, tid):
    th = server.call("/api/themes")
    t = next((x for x in th.get("themes", []) + th.get("store", []) if x["id"] == tid), None)
    if not t:
        return
    may = ui.HOME.getProperty("korie.may.install")
    choices = []
    if t.get("installed") and t["id"] != ui.current_theme():
        choices.append(({"label": "Use on this screen", "icon": "play"}, lambda: use_theme(server, t)))
    if may and (not t.get("installed") or t.get("update")):
        choices.append(({"label": "Update" if t.get("installed") else "Install"}, lambda: theme_get(server, t)))
    if may and t.get("installed") and not t.get("builtin"):
        choices.append(({"label": "Remove from the server…", "danger": True, "gap": True}, lambda: theme_remove(server, t)))
    if not choices:
        if t["id"] == ui.current_theme():
            xbmcgui.Dialog().notification("Korie", "%s is the theme on this screen." % t["name"], xbmcgui.NOTIFICATION_INFO, 3000)
        else:
            xbmcgui.Dialog().notification("Korie", "Ask an admin to get %s." % t["name"], xbmcgui.NOTIFICATION_INFO, 3000)
        return
    if ARGS.get("go") and t["id"] != ui.current_theme():
        return choices[0][1]()
    i = screens.menu(t["name"], [o for o, _ in choices])
    if i >= 0:
        choices[i][1]()


def use_theme(server, t):
    ui.sync_themes(server)
    ui.apply_theme(t["id"])


def theme_get(server, t):
    xbmcgui.Dialog().notification("Korie", "Getting %s…" % t["name"], xbmcgui.NOTIFICATION_INFO, 2500)
    try:
        server.call("/api/theme/install", {"id": t["id"]}, timeout=120)
    except KorieError as e:
        return fail(e)
    if xbmcgui.Dialog().yesno(t["name"], "%s is on the server. Use it on this screen now?" % t["name"], nolabel="Not now", yeslabel="Use it"):
        use_theme(server, t)
    else:
        refresh()


def theme_remove(server, t):
    if not xbmcgui.Dialog().yesno("Remove %s?" % t["name"], "Screens that use it keep it until they choose another.", nolabel="Keep it", yeslabel="Remove"):
        return
    try:
        server.call("/api/theme/remove", {"id": t["id"]})
    except KorieError as e:
        return fail(e)
    refresh()


def addon_rows(server, aid):
    """One add-on's rows from every part of Korie (films, series, live TV, Home), each once."""
    rows, seen = [], set()

    def add(r, title=None):
        r = dict(r, title=title or r.get("title", ""))
        key = (r["title"], len(r.get("items", [])))
        if r.get("items") and key not in seen:
            seen.add(key)
            rows.append(r)

    for which in ("films", "series"):
        for r in server.get("/api/" + which, source=aid).get("rows") or []:
            add(r)
    for r in server.call("/api/live").get("rows", []):
        if r.get("id") == aid:
            add(r, "Live TV")
    for r in server.call("/api/home").get("rows", []):
        if r.get("source") == aid:
            add(r, r["title"].split(": ", 1)[-1])
    return rows


def addon_page(server, aid):
    rows = addon_rows(server, aid)
    name = next((a["name"] for a in server.call("/api/addons").get("addons", []) if a["id"] == aid), "Add-on")
    if len(rows) == 1:
        cards = rows[0]["items"]
        return show([card_item(server, c) for c in cards], content_of(cards), title=name)
    items = []
    for i, r in enumerate(rows):
        li = xbmcgui.ListItem(r["title"], offscreen=True)
        first = r["items"][0]
        li.setArt({"thumb": server.absolute(first.get("thumb") or first.get("poster")), "fanart": server.absolute(first.get("backdrop"))})
        li.setProperty("korie.subtitle", "%d things" % len(r["items"]))
        items.append((url(a="addonrow", id=aid, n=str(i)), li, True))
    if not items:
        xbmcgui.Dialog().notification("Korie", "%s has nothing to show yet." % name, xbmcgui.NOTIFICATION_INFO, 4000)
    show(items, title=name)


def addon_row(server, aid, n):
    rows = addon_rows(server, aid)
    r = rows[n] if n < len(rows) else {"title": "", "items": []}
    show([card_item(server, c) for c in r["items"]], content_of(r["items"]), title=r["title"])


# --- Korie's options menu (the remote's Menu button, holding OK, right-click) --------------------

def refresh():
    """After a change: the list you're on, and Home's rows."""
    xbmc.executebuiltin("Container.Refresh")
    xbmc.executebuiltin("NotifyAll(plugin.video.korie,home)")
    if not xbmc.getCondVisibility("Window.IsActive(videos)"):
        return
    # when the focused thing left the list (removed, say) Kodi focuses nothing, and the next key
    # only brings focus back: put it on the list once the list is back
    xbmc.sleep(300)
    for _ in range(30):
        if not xbmc.getCondVisibility("Container.IsUpdating"):
            break
        xbmc.sleep(100)
    if not xbmc.getInfoLabel("System.CurrentControlId"):
        xbmc.executebuiltin("SetFocus(5100)")


def skip_disc_menu():
    """In a DVD's own menu: stops it and plays the film itself (the server sends the main title)."""
    id_ = HOME_WINDOW.getProperty("korie.disc.id")
    if not id_:
        return
    xbmc.executebuiltin("PlayerControl(Stop)")
    xbmc.sleep(400)
    xbmc.executebuiltin("PlayMedia(%s)" % url(a="play", id=id_, menu="0"))


def options(server):
    get = xbmc.getInfoLabel
    id_ = get("ListItem.Property(korie.id)")
    if not id_:
        return
    kind = get("ListItem.Property(korie.kind)")
    title = get("ListItem.Title") or get("ListItem.Label")
    if kind == "app":
        return app_options(id_, get("ListItem.Label"))
    if kind == "addon":
        return addon_menu(server, id_)
    if kind == "theme":
        return theme_menu(server, id_)
    if kind == "playlist":
        return playlist_menu(server, id_.split(":", 1)[1], title)
    if kind == "newplaylist":
        return new_playlist(server)
    pos = float(get("ListItem.Property(korie.pos)") or 0)
    watched = bool(get("ListItem.Property(korie.watched)"))
    fav = bool(get("ListItem.Property(korie.fav)"))
    choices = []  # (option, what it does)

    def add(option, fn):
        choices.append((option, fn))

    if kind in ("film", "episode", "track", "game", "video", ""):
        if pos > 0:
            add({"label": "Resume · %s" % get("ListItem.Property(korie.left)"), "icon": "play"},
                lambda: xbmc.executebuiltin("PlayMedia(%s)" % url(a="play", id=id_, menu="0", **{"from": str(int(pos))})))
        if get("ListItem.Property(korie.disc)") == "dvd":
            # a DVD: with the disc's own menu (as from the drive), or straight into the film
            menu_first = ui.disc_menu()
            both = [({"label": "Play with the disc's menu"}, "1"), ({"label": "Play the film only"}, "0")]
            if not menu_first:
                both.reverse()
            for n, (o, m) in enumerate(both):
                o["icon"] = "play" if n == 0 and pos <= 0 else ""
                add(o, lambda m=m: xbmc.executebuiltin("PlayMedia(%s)" % url(a="play", id=id_, menu=m)))
        else:
            add({"label": "Play" if kind == "track" else "Play from the start", "icon": "" if pos > 0 else "play"},
                lambda: xbmc.executebuiltin("PlayMedia(%s)" % url(a="play", id=id_)))
    elif kind == "live":
        add({"label": "Watch", "icon": "play"}, lambda: xbmc.executebuiltin("RunPlugin(%s)" % url(a="watch", id=id_)))
    else:
        add({"label": "Open"}, lambda: xbmc.executebuiltin("Action(Select)"))
    if kind in ("film", "episode", "series"):
        add({"label": "Information"}, lambda: information(server, id_))
    if kind in ("film", "episode", "series"):
        def mark():
            server.call("/api/watched", {"id": id_, "watched": not watched})
            refresh()
        add({"label": "Mark as not watched" if watched else "Mark as watched"}, mark)

    if kind in ("track", "album"):
        add({"label": "Add to playlist"}, lambda: add_to_playlist(server, id_))
        in_list = get("Container.Property(korie.playlist)")
        if kind == "track" and in_list:
            def take():
                server.call("/api/playlists/" + in_list, {"take": id_})
                refresh()
            add({"label": "Remove from this playlist"}, take)

    def favourite():
        on = server.call("/api/favourite", {"id": id_}).get("favourite")
        xbmcgui.Dialog().notification("Korie", "Added to your favourites." if on else "Removed from your favourites.",
                                      xbmcgui.NOTIFICATION_INFO, 2500)
        refresh()
    add({"label": "Remove from favourites" if fav else "Add to favourites"}, favourite)

    me = server.call("/api/me")["person"] if get("ListItem.Property(korie.fixable)") else {}
    if me.get("canSettings"):
        add({"label": "Choose another poster", "gap": True}, lambda: choose_poster(server, id_, title))
        add({"label": "Fix details (wrong %s?)" % ("film" if kind == "film" else "series")},
            lambda: fix_details(server, id_, title))
    if me.get("admin"):
        add({"label": "Age rating", "note": get("ListItem.Property(korie.cert)") or "None"}, lambda: set_age(server, id_, title))
    if me.get("canDelete"):
        add({"label": "Remove from the library…", "danger": True}, lambda: remove(server, id_, title))

    i = screens.menu(title, [o for o, _ in choices])
    if i >= 0:
        choices[i][1]()


def set_age(server, id_, title):
    """An admin rates a film or series (a home video has none, so people with an age limit don't see it)."""
    from resources.lib.manage import AGES, age_label
    ages = [a for a in AGES if a is not None] + [None]
    labels = [{"label": age_label(a) if a is not None else "No age rating", "note": "" if a is not None else "Hidden from people with an age limit"} for a in ages]
    i = screens.menu("Age rating for %s" % title, labels)
    if i < 0:
        return
    try:
        server.call("/api/age", {"id": id_, "age": ages[i]})
    except KorieError as e:
        return xbmcgui.Dialog().notification("Korie", str(e), xbmcgui.NOTIFICATION_WARNING, 4000)
    refresh()


def information(server, id_):
    """A film's page. Kodi opens it for its lists (Videos); Home's rows aren't one of those, so
    there it's opened with the card from Home."""
    if xbmc.getCondVisibility("Window.IsActive(videos)"):
        xbmc.executebuiltin("Action(Info)")
        return
    for r in server.call("/api/home").get("rows", []):
        for c in r.get("items", []):
            if c.get("id") == id_:
                target, li, is_folder = card_item(server, c)
                li.setPath(target)
                if is_folder:
                    xbmc.executebuiltin("ActivateWindow(Videos,%s,return)" % target)
                else:
                    xbmcgui.Dialog().info(li)
                return


def choose_poster(server, id_, title):
    """The posters TMDb has for it; the one picked is shown everywhere."""
    found = server.get("/api/posters", id=id_).get("posters", [])
    if not found:
        xbmcgui.Dialog().notification("Korie", "TMDb has no other posters for %s." % title, xbmcgui.NOTIFICATION_INFO, 4000)
        return
    names = {"en": "English", "da": "Danish", "": "No text"}
    pics = [{"label": names.get(p.get("lang", ""), p.get("lang", "").upper()),
             "picture": server.absolute(p.get("picture")) + "&w=342"} for p in found]
    i = screens.pictures("Poster for %s" % title, pics)
    if i < 0:
        return
    server.call("/api/poster", {"id": id_, "url": found[i]["url"]})
    xbmcgui.Dialog().notification("Korie", "Poster changed.", xbmcgui.NOTIFICATION_INFO, 2500)
    refresh()


def remove(server, id_, title):
    if not xbmcgui.Dialog().yesno("Remove %s?" % title,
                                  "It leaves Korie on every screen. The files stay where they are, and it can be "
                                  "brought back in the Korie server's settings (Libraries).",
                                  nolabel="Keep it", yeslabel="Remove"):
        return
    server.call("/api/remove", {"id": id_})
    xbmcgui.Dialog().notification("Korie", "%s was removed from the library." % title, xbmcgui.NOTIFICATION_INFO, 3000)
    refresh()


def fix_details(server, id_, title):
    """The film or series picked the wrong TMDb match: choose the right one."""
    q = title
    while True:
        found = server.get("/api/match", id=id_, q=q)
        results = found.get("results", [])
        opts = [{"label": "%s%s" % (r["title"], " (%s)" % r["year"] if r.get("year") else ""),
                 "note": r.get("original") if r.get("original") and r["original"] != r["title"] else "",
                 "thumb": server.absolute(r.get("poster"))} for r in results]
        opts.append({"label": "Search for another title…", "icon": "search", "gap": bool(results)})
        i = screens.menu("Which is it?" if results else "Nothing found for “%s”" % q, opts)
        if i < 0:
            return
        if i == len(results):
            q = xbmcgui.Dialog().input("Title to look for", q)
            if not q:
                return
            continue
        server.call("/api/match", {"id": id_, "tmdb": results[i]["id"]})
        xbmcgui.Dialog().notification("Korie", "Changed to %s." % results[i]["title"], xbmcgui.NOTIFICATION_INFO, 3000)
        refresh()
        return


# --- search ------------------------------------------------------------------------------------

def find(server):
    """Korie's search screen: the letters on the left, what's found on the right as you type."""
    def build(c):
        return card_item(server, c)

    def open_item(c, target, is_folder, li):
        kind = c.get("kind", "")
        if kind == "live":
            xbmc.executebuiltin("RunPlugin(%s)" % target)
        elif is_folder:
            xbmc.executebuiltin("ActivateWindow(Videos,%s,return)" % target)
        elif kind in ("film", "episode"):
            xbmcgui.Dialog().info(li)
        else:
            xbmc.executebuiltin("PlayMedia(%s)" % target)

    if not screens.search(server, build, open_item):
        xbmc.executebuiltin("ActivateWindow(Videos,%s,return)" % url(a="search"))


# --- the router -------------------------------------------------------------------------------

def run():
    a = ARGS.get("a", "")
    try:
        if a == "people":
            return people()
        if a == "signin":
            return sign_in_slot(ARGS.get("n", "1"))
        if a == "addperson":
            return add_person()
        if a == "managepeople" and ARGS.get("signedout"):
            return manage_people_signed_out()
        if a == "settings":
            ui.show_server(korie.load_state())
            ui.show_theme()
            ui.show_disc_menu()
            try:
                server = korie.connect()
                me = server.call("/api/me")
                ui.language_names(me)
                if (me.get("person") or {}).get("admin"):
                    n = len(server.call("/api/people"))
                    ui.HOME.setProperty("korie.people.count", "1 person" if n == 1 else "%d people" % n)
            except (KorieError, AttributeError) as e:
                log(e)
            return
        if a == "language":
            return ui.choose_language(korie.connect(), ARGS.get("which", "audio"))
        if a == "theme":
            return ui.choose_theme(korie.connect())
        if a == "discmenu":
            return ui.toggle_disc_menu()
        if a == "skipmenu":
            return skip_disc_menu()
        if a == "season":
            # a series' season tab: same page, other season (so Back still goes to where the series was opened from)
            ui.HOME.setProperty("korie.season." + ARGS["id"], ARGS["season"])
            xbmc.executebuiltin("Container.Refresh")
            return
        if a == "streams":
            return screens.streams()
        if a == "profile":
            if screens.korie_skin():
                # the Korie skin has its own "Who's watching?" screen
                if HANDLE >= 0:
                    xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
                xbmc.executebuiltin("ActivateWindow(1190)")
                return
            korie.connect(force_profile=True)
            xbmc.executebuiltin("Container.Refresh")
            return
        if a == "server":
            if korie.server_only(force=True):
                ui.HOME.clearProperty("korie.person.name")
                xbmc.executebuiltin("ActivateWindow(1190)")
            return
        server = korie.connect()
        if server is None:
            if HANDLE >= 0:
                xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
            return
        if a == "":
            root(server)
        elif a == "row":
            widget_row(server, int(ARGS.get("n", "1")))
        elif a == "live":
            rows = [r for r in fetch_rows(server, a) if r.get("items")]
            cards = [c for r in rows for c in r["items"]]
            show([card_item(server, c) for c in cards], "videos", title="Live TV")
        elif a in ("home", "games", "page"):
            rows_page(server, fetch_rows(server, a, ARGS.get("id", "")), "")
        elif a == "rows":
            rows = [r for r in fetch_rows(server, ARGS.get("path", ""), ARGS.get("id", ""), ARGS.get("source", "")) if r.get("items")]
            n = int(ARGS.get("n", "0"))
            cards = rows[n]["items"] if n < len(rows) else []
            show([card_item(server, c) for c in cards], content_of(cards))
        elif a in ("films", "series"):
            section(server, a)
        elif a == "music":
            music(server, ARGS.get("by", "albums"), ARGS.get("artist", ""), ARGS.get("genre", ""), ARGS.get("playlist", ""))
        elif a == "newplaylist":
            new_playlist(server)
        elif a == "song":
            play_album(server, ARGS.get("album", ""), ARGS["id"])
        elif a == "item":
            item_page(server, ARGS["id"])
        elif a == "search":
            search(server)
        elif a == "find":
            find(server)
        elif a == "options":
            options(server)
        elif a == "addons":
            addons_page(server, ARGS.get("tab", "mine"))
        elif a == "apps":
            apps_page(server, ARGS.get("tab", "all"))
        elif a == "app":
            from resources.lib import apps
            apps.start(ARGS["pkg"])
        elif a == "managepeople":
            from resources.lib import people as people_screen
            people_screen.show(server, ARGS.get("id", ""))
        elif a == "prefs":
            from resources.lib import settings as settings_screen
            if not settings_screen.show(server, ARGS.get("cat", "")):
                xbmc.executebuiltin("ActivateWindow(settings)")
        elif a == "addonmenu":
            addon_menu(server, ARGS["id"])
        elif a == "thememenu":
            theme_menu(server, ARGS["id"])
        elif a == "addon":
            addon_page(server, ARGS["id"])
        elif a == "addonrow":
            addon_row(server, ARGS["id"], int(ARGS.get("n", "0")))
        elif a == "play":
            play(server, ARGS["id"], start=float(ARGS.get("from") or 0))
        elif a == "watch":
            play(server, ARGS["id"], direct=True)
        elif a == "watched":
            server.call("/api/watched", {"id": ARGS["id"], "watched": ARGS.get("on") == "1"})
            xbmc.executebuiltin("Container.Refresh")
    except KorieError as e:
        if a == "row":
            log(e)  # Home's rows: the Korie service says it once on Home, not once per row
        else:
            fail(e)
        if HANDLE >= 0 and a not in ("play", "watch", "watched", "app", "addonmenu", "thememenu", "managepeople", "prefs", "newplaylist"):
            xbmcplugin.endOfDirectory(HANDLE, succeeded=False)


run()
