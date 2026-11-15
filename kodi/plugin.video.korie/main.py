# Korie in Kodi: lists what the Korie server has (your library, add-ons, live TV) and
# plays it with Kodi's own player. All the work happens on the server; this only shows it.
import sys
import urllib.parse

import xbmc
import xbmcgui
import xbmcplugin

from resources.lib import korie, ui
from resources.lib.korie import KorieError, log

BASE = sys.argv[0]
HANDLE = int(sys.argv[1]) if len(sys.argv) > 1 else -1
ARGS = dict(urllib.parse.parse_qsl(sys.argv[2][1:])) if len(sys.argv) > 2 else {}
HOME_WINDOW = xbmcgui.Window(10000)

FOLDER_KINDS = {"series", "album", "page"}
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
    if c.get("runtime"):
        tag.setDuration(int(c["runtime"]) * 60)
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
    li.setProperty("korie.source", c.get("source", ""))
    li.setProperty("korie.subtitle", c.get("subtitle", ""))
    if context:
        menu = [("Mark as unwatched" if c.get("watched") else "Mark as watched",
                 "RunPlugin(%s)" % url(a="watched", id=c["id"], on="0" if c.get("watched") else "1")),
                ("Switch profile", "RunPlugin(%s)" % url(a="profile"))]
        li.addContextMenuItems(menu)
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
    d = server.get("/api/" + which, source=ARGS.get("source", ""))
    items = []
    cards = d.get("items") or []
    if not cards and d.get("rows"):
        # an add-on's films/series come as rows
        return rows_page(server, d["rows"])
    items += [card_item(server, c) for c in cards]
    if not items and d.get("status"):
        xbmcgui.Dialog().notification("Korie", d["status"].split("\n")[0], xbmcgui.NOTIFICATION_INFO, 5000)
    show(items, "movies" if which == "films" else "tvshows", title="Films" if which == "films" else "Series")


def item_page(server, id_):
    """A series (its seasons and episodes) or an album (its tracks)."""
    d = server.get("/api/item", id=id_)
    if d.get("error"):
        xbmcgui.Dialog().notification("Korie", d["error"], xbmcgui.NOTIFICATION_ERROR, 6000)
    if d.get("tracks") is not None:
        cards = [dict(t, kind="track", subtitle=t.get("artist") or d.get("artist", ""), poster=d.get("poster"),
                      thumb=d.get("poster"), backdrop=d.get("backdrop"), year=d.get("year", "")) for t in d["tracks"]]
        return show([card_item(server, c) for c in cards], "songs", title=d.get("title", ""))
    seasons = d.get("seasons") or []
    season = ARGS.get("season")
    if season is None and len(seasons) > 1:
        items = []
        for s in seasons:
            li = xbmcgui.ListItem(s.get("title") or "Season %s" % s.get("n"), offscreen=True)
            li.setArt({"poster": server.absolute(s.get("poster") or d.get("poster")), "fanart": server.absolute(d.get("backdrop"))})
            tag = li.getVideoInfoTag()
            tag.setMediaType("season")
            tag.setSeason(int(s.get("n") or 0))
            tag.setTvShowTitle(d.get("title", ""))
            items.append((url(a="item", id=id_, season=str(s.get("n"))), li, True))
        return show(items, "seasons", title=d.get("title", ""))
    chosen = seasons if season is None else [s for s in seasons if str(s.get("n")) == season]
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
    title = d.get("title", "")
    if season is not None and len(seasons) > 1:
        title += " · " + (chosen[0].get("title") or "Season %s" % season if chosen else "")
    show(items, "episodes", title=title)


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


# --- playing ----------------------------------------------------------------------------------

def play(server, id_, direct=False):
    """direct: started with RunPlugin (channels), so play it here instead of handing it back to Kodi."""
    def give_up():
        if not direct:
            xbmcplugin.setResolvedUrl(HANDLE, False, xbmcgui.ListItem())

    try:
        plan = server.call("/api/play", {"id": id_, "kodi": True})
    except KorieError as e:
        fail(e)
        return give_up()
    if plan.get("web"):
        give_up()
        open_web(plan["web"])
        return
    target = server.absolute(plan.get("url"))
    li = xbmcgui.ListItem(plan.get("title", ""), path=target, offscreen=True)
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
    tracker = Tracker(server, id_, 0, bool(plan.get("live")))
    if direct:
        tracker.play(target, li)
    else:
        xbmcplugin.setResolvedUrl(HANDLE, True, li)
    tracker.run()


class Tracker(xbmc.Player):
    """Watches the playback this add-on started: seeks to the resume point, and tells the
    server how far you got (so every screen in the house can carry on from there)."""

    def __init__(self, server, id_, resume, live):
        super().__init__()
        self.server, self.id, self.resume, self.live = server, id_, resume, live
        self.started = False
        self.done = False
        self.pos = 0.0
        self.total = 0.0

    def onAVStarted(self):
        self.started = True
        if self.resume > 0:
            self.seekTime(self.resume)

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


def sign_in_slot(n):
    pid = ui.HOME.getProperty("korie.p.%s.id" % n)
    server = korie.server_only()
    if not pid or server is None:
        return
    person = next((p for p in server.call("/api/people") if p["id"] == pid), None)
    if person:
        sign_in(server, person)


def addons_page(server):
    """Add-ons that are on, each one a folder of what it has."""
    items = []
    for a in server.call("/api/addons").get("addons", []):
        if a.get("installed") and a.get("enabled") and not a.get("games"):
            li = xbmcgui.ListItem(a["name"], offscreen=True)
            li.getVideoInfoTag().setPlot(a.get("description", ""))
            li.setProperty("korie.subtitle", "Add-on%s" % (" by " + a["author"] if a.get("author") else ""))
            items.append((url(a="addon", id=a["id"]), li, True))
    if not items:
        xbmcgui.Dialog().notification("Korie", "No add-ons are on. Get them in the Store on the Korie server's page.", xbmcgui.NOTIFICATION_INFO, 5000)
    show(items, "files", title="Add-ons")


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


# --- the router -------------------------------------------------------------------------------

def run():
    a = ARGS.get("a", "")
    try:
        if a == "people":
            return people()
        if a == "signin":
            return sign_in_slot(ARGS.get("n", "1"))
        if a == "settings":
            ui.show_server(korie.load_state())
            ui.show_theme()
            return
        if a == "theme":
            return ui.choose_theme()
        if a == "profile":
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
            cards = server.call("/api/music").get("items", [])
            show([card_item(server, c) for c in cards], "albums", sort=True)
        elif a == "item":
            item_page(server, ARGS["id"])
        elif a == "search":
            search(server)
        elif a == "addons":
            addons_page(server)
        elif a == "addon":
            addon_page(server, ARGS["id"])
        elif a == "addonrow":
            addon_row(server, ARGS["id"], int(ARGS.get("n", "0")))
        elif a == "play":
            play(server, ARGS["id"])
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
        if HANDLE >= 0 and a not in ("play", "watch", "watched"):
            xbmcplugin.endOfDirectory(HANDLE, succeeded=False)


run()
