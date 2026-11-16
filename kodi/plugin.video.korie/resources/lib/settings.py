# Settings (the Settings artboard): categories on the left, the chosen one's settings on the
# right, and a search across all of them. Xml/Korie_Settings.xml is the screen; this fills it and
# does what each row says. People opens its own screen (people.py).
import json
import threading
import time

import xbmc
import xbmcgui

from resources.lib import screens, ui
from resources.lib.korie import KorieError, log, device_id, device_name, load_state

CATS = [("look", "Look"), ("playback", "Playback"), ("libraries", "Libraries"), ("people", "People"), ("server", "Server"),
        ("addons", "Add-ons"), ("device", "This device"), ("about", "About")]
LANGS = [("en-US", "English"), ("da-DK", "Dansk"), ("sv-SE", "Svenska"), ("nb-NO", "Norsk"), ("de-DE", "Deutsch"), ("fr-FR", "Français"), ("es-ES", "Español")]
# hardware decoding is a different Kodi setting on each kind of device: the first one this Kodi has
HW_DECODING = ["videoplayer.usemediacodecsurface", "videoplayer.usemediacodec", "videoplayer.usevaapi", "videoplayer.usedxva2",
               "videoplayer.usevideotoolbox", "videoplayer.usevdpau"]
SKIP = [("button", "Show a Skip button"), ("auto", "Skip by itself"), ("off", "Never")]
KIND_NAMES = {"films": "Films", "series": "Series", "music": "Music"}


def note(text):
    xbmcgui.Dialog().notification("Korie", text, xbmcgui.NOTIFICATION_INFO, 3000)


def kodi_setting(name):
    r = json.loads(xbmc.executeJSONRPC(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "Settings.GetSettingValue", "params": {"setting": name}})))
    return r["result"]["value"] if "result" in r else None


def set_kodi_setting(name, value):
    xbmc.executeJSONRPC(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "Settings.SetSettingValue", "params": {"setting": name, "value": value}}))


def row(label, help="", value="", kind="", on=False, do=None, colour="", words=""):
    return {"label": label, "help": help, "value": value, "kind": kind, "on": on, "do": do, "colour": colour, "words": words}


class _Settings(xbmcgui.WindowXML):
    CATS, ROWS, SEARCH = 310, 300, 101

    def __init__(self, *args, **kwargs):
        self.server = kwargs["server"]
        self.cat = kwargs.get("cat") or "playback"
        self.query = ""
        self.rows = []
        self.me = {}
        self.stop = False
        self.go = ""          # where to go when this closes (a builtin)
        self.watcher = None
        self.ready = False
        self.busy = False     # People is open on top

    # --- the screen ---------------------------------------------------------------------------

    def onInit(self):
        if self.ready:
            return
        self.ready = True
        self.setProperty("korie.python", "1")
        ui.HOME.clearProperty("korie.go")
        self.refresh_me()
        self.fill_cats()
        self.show()
        self.watcher = threading.Thread(target=self.watch, daemon=True)
        self.watcher.start()
        self.setFocusId(self.CATS)

    def cats(self):
        return [(c, "You" if c == "people" and not self.person().get("admin") else n) for c, n in CATS]

    def fill_cats(self):
        lst = self.getControl(self.CATS)
        lst.reset()
        items = []
        for c, n in self.cats():
            li = xbmcgui.ListItem(n, offscreen=True)
            if c == self.cat:
                li.setProperty("on", "1")
            items.append(li)
        lst.addItems(items)
        lst.selectItem([c for c, _ in self.cats()].index(self.cat))

    def watch(self):
        """Moving up and down the categories shows each one's settings (and the menu's Go)."""
        monitor = xbmc.Monitor()
        while not self.stop and not monitor.abortRequested():
            if self.busy:
                monitor.waitForAbort(0.2)
                continue
            try:
                go = ui.HOME.getProperty("korie.go")
                if go:
                    ui.HOME.clearProperty("korie.go")
                    self.go = screens.MENU.get(go, "")
                    self.stop = True
                    self.close()
                    return
                if self.getFocusId() == self.CATS and not self.query:
                    n = self.getControl(self.CATS).getSelectedPosition()
                    cats = self.cats()
                    if 0 <= n < len(cats) and cats[n][0] != self.cat:
                        self.cat = cats[n][0]
                        self.mark_cat()
                        self.show()
            except RuntimeError:
                return
            monitor.waitForAbort(0.12)

    def mark_cat(self):
        lst = self.getControl(self.CATS)
        for i, (c, _) in enumerate(self.cats()):
            lst.getListItem(i).setProperty("on", "1" if c == self.cat else "")

    def refresh_me(self):
        try:
            self.me = self.server.call("/api/me")
        except KorieError as e:
            log(e)

    def person(self):
        return self.me.get("person") or {}

    def show(self, keep=False):
        """Fills the rows: the category's, or every match of the search."""
        if self.query:
            q = self.query.lower()
            rows = []
            for c, name in self.cats():
                # each row says which category it's from (a list can't put headings between rows)
                rows += [dict(r, help="%s · %s" % (name, r["help"]) if r["help"] else name)
                         for r in self.build(c) if q in ("%s %s %s" % (r["label"], r["help"], r["words"])).lower()]
            empty = "Nothing in Settings matches “%s”." % self.query if not rows else ""
        else:
            rows = self.build(self.cat)
            empty = "" if rows else self.empty
        self.rows = rows
        self.setProperty("korie.empty", empty)
        lst = self.getControl(self.ROWS)
        pos = lst.getSelectedPosition() if keep else 0
        lst.reset()
        items = []
        for r in rows:
            li = xbmcgui.ListItem(r["label"], r["value"], offscreen=True)
            li.setProperty("help", r["help"])
            li.setProperty("kind", r["kind"])
            li.setProperty("on", "1" if r["on"] else "")
            li.setProperty("colour", r["colour"])
            items.append(li)
        lst.addItems(items)
        if items:
            lst.selectItem(min(max(pos, 0), len(items) - 1))

    def onClick(self, cid):
        if cid == self.SEARCH:
            t = xbmcgui.Dialog().input("Search settings", self.query)
            self.query = (t or "").strip()
            self.setProperty("korie.query", self.query)
            self.show()
            if self.rows:
                self.setFocusId(self.ROWS)
        elif cid == self.CATS:
            if self.cat == "people" and self.person().get("admin"):
                return self.open_people()
            if self.rows:
                self.setFocusId(self.ROWS)
        elif cid == self.ROWS:
            n = self.getControl(self.ROWS).getSelectedPosition()
            if 0 <= n < len(self.rows) and self.rows[n]["do"]:
                try:
                    self.rows[n]["do"]()
                except KorieError as e:
                    xbmcgui.Dialog().notification("Korie", str(e), xbmcgui.NOTIFICATION_WARNING, 4000)
                if not self.stop:
                    self.refresh_me()
                    self.show(keep=True)

    def onAction(self, action):
        a = action.getId()
        if a in screens.BACK:
            if self.query and self.getFocusId() != screens_menu_id():
                self.query = ""
                self.setProperty("korie.query", "")
                self.show()
                self.setFocusId(self.CATS)
                return
            self.stop = True
            self.close()

    def leave(self, builtin):
        """Closes Settings, then does this (opening another screen)."""
        self.go = builtin
        self.stop = True
        self.close()

    # --- what each category has -----------------------------------------------------------------

    empty = ""

    def build(self, cat):
        self.empty = ""
        try:
            return getattr(self, "cat_" + cat)()
        except KorieError as e:
            self.empty = str(e)
            return []

    def may_settings(self):
        if self.person().get("canSettings"):
            return True
        self.empty = "Ask an admin to let you change settings."
        return False

    def cat_look(self):
        return [row("Theme", "Colours and fonts of Korie on this screen", HOME_prop("korie.theme.name") or "Korie Classic", "sel",
                    do=lambda: ui.choose_theme(self.server), words="colours fonts look")]

    def cat_playback(self):
        names = dict(self.me.get("languages") or [])
        p = self.person()
        audio, subs = p.get("audio", ""), p.get("subs", "")
        out = [
            row("Audio language", "Picked first when a film has several", names.get(audio, audio) if audio else "Original language", "sel",
                do=lambda: ui.choose_language(self.server, "audio")),
            row("Subtitles", "Shown when the audio isn't in your language", "Off" if subs == "off" else names.get(subs, subs) if subs else "As the film says", "sel",
                do=lambda: ui.choose_language(self.server, "subs")),
            row("Start DVDs with the disc's menu", "Off: go straight to the film", kind="tick", on=ui.disc_menu(), do=ui.toggle_disc_menu, words="dvd disc"),
            row("Skip intros", "For series where Korie found the intro", dict(SKIP).get(p.get("skipIntro", "button"), "Show a Skip button"), "sel",
                do=self.choose_skip, words="intro series episode"),
        ]
        rate = kodi_setting("videoplayer.adjustrefreshrate")
        if rate is not None:
            out.append(row("Match the TV to the film's frame rate", "Smoother motion; the screen may go dark for a moment", kind="tick", on=rate != 0,
                           do=lambda: set_kodi_setting("videoplayer.adjustrefreshrate", 0 if rate else 1), words="refresh hz"))
        hw = next((s for s in HW_DECODING if kodi_setting(s) is not None), None)
        if hw:
            on = bool(kodi_setting(hw))
            out.append(row("Hardware video decoding", "Faster and cooler; turn off if a film shows errors", kind="tick", on=on,
                           do=lambda: set_kodi_setting(hw, not on), words="decode"))
        return out

    def choose_skip(self):
        now = self.person().get("skipIntro", "button")
        i = screens.menu("Skip intros", [{"label": n, "on": k == now} for k, n in SKIP], start=[k for k, _ in SKIP].index(now) if now in dict(SKIP) else 0)
        if i >= 0:
            self.server.call("/api/me/playback", {"skipIntro": SKIP[i][0]})

    def cat_libraries(self):
        if not self.may_settings():
            return []
        d = self.server.call("/api/settings")
        out = []
        for f in d.get("folders", []):
            when = time.strftime("%d %b %Y %H:%M", time.localtime(f["scanned"])) if f.get("scanned") else ""
            out.append(row(f["path"], f.get("error") or ("Looked through %s" % when if when else "Looking through it…"),
                           KIND_NAMES.get(f.get("kind"), f.get("kind", "")), "val", do=lambda f=f: self.folder(f), words="folder library"))
        if self.person().get("admin"):
            out.append(row("Add a folder", "A folder on the server with films, series or music", do=self.add_folder, words="library"))
        c = d.get("counts", {})
        st = d.get("status", {})
        out.append(row("Look for new files now", (st.get("text") or "Looking…") if st.get("scanning") else
                       "%d films, %d series, %d albums" % (c.get("film", 0), c.get("series", 0), c.get("album", 0)),
                       do=self.scan, words="scan library"))
        out.append(row("Removed from the library", "Films and series removed with the options menu; bring them back here", do=self.removed))
        return out

    def folder(self, f):
        i = screens.menu(f["path"], [{"label": "Look through it again"}, {"label": "Remove from the library", "danger": True}])
        if i == 0:
            self.scan()
        elif i == 1 and xbmcgui.Dialog().yesno("Remove this folder?", "%s[CR]Its films, series or music leave Korie. The files themselves stay where they are." % f["path"],
                                               nolabel="Keep it", yeslabel="Remove"):
            self.server.call("/api/folders/%s" % f["id"], method="DELETE")

    def add_folder(self):
        path = ""
        while True:
            d = self.server.get("/api/dirs", path=path)
            opts = ([("@use", "Use this folder")] if d["path"] != "/" else []) + [("@type", "Type a path")] + \
                   ([("@up", "‹ Up one level")] if d.get("parent") else []) + [(n, n) for n in d.get("dirs", [])]
            i = screens.menu(d["path"], [{"label": l, "icon": "" if v.startswith("@") else "disc"} for v, l in opts])
            if i < 0:
                return
            v = opts[i][0]
            if v == "@use":
                break
            if v == "@up":
                path = d.get("parent") or "/"
            elif v == "@type":
                t = xbmcgui.Dialog().input("The folder's path on the server", d["path"])
                if t:
                    path = t.strip()
            else:
                path = d["path"].rstrip("/") + "/" + v
        kinds = ["films", "series", "music"]
        k = screens.menu("What's in %s?" % path, [{"label": KIND_NAMES[x]} for x in kinds])
        if k < 0:
            return
        self.server.call("/api/folders", {"path": path, "kind": kinds[k]})
        note("Added. Korie is looking through it.")

    def scan(self):
        self.server.call("/api/scan", {})
        note("Looking for new files…")

    def removed(self):
        items = self.server.call("/api/removed").get("items", [])
        if not items:
            return note("Nothing has been removed.")
        i = screens.menu("Bring back to the library", [{"label": "%s%s" % (x["title"], " (%s)" % x["year"] if x.get("year") else "")} for x in items])
        if i >= 0:
            self.server.call("/api/remove", {"id": items[i]["id"], "restore": True})
            note("It's back in the library.")

    def cat_people(self):
        p = self.person()
        if not p.get("admin"):
            return [
                row("Your name", "", p.get("name", ""), "sel", do=self.rename_me),
                row("Change your PIN" if p.get("hasPin") else "Set a PIN", "Asked for when you pick yourself in Who's watching", do=self.my_pin, words="pin"),
            ]
        from resources.lib import people
        d = self.server.call("/api/people/all")
        out = [row(x["name"], people.note(x), x["name"][:1].upper(), "face", colour=ui.colour(x.get("color")),
                   do=lambda x=x: self.open_people(x["id"]), words="people person pin") for x in d.get("people", [])]
        out.append(row("Add person", "", do=self.add_person, words="people new"))
        return out

    def rename_me(self):
        p = self.person()
        t = xbmcgui.Dialog().input("Your name", p.get("name", ""))
        if t.strip():
            self.server.call("/api/people/" + p["id"], {"name": t.strip()}, method="PATCH")

    def my_pin(self):
        pin = xbmcgui.Dialog().numeric(0, "A new four-digit PIN", "", True)
        if pin:
            self.server.call("/api/people/%s/pin" % self.person()["id"], {"pin": pin})
            note("PIN set")

    def add_person(self):
        t = xbmcgui.Dialog().input("Name of the new person")
        if t.strip():
            p = self.server.call("/api/people", {"name": t.strip()})
            self.open_people(p["id"])

    def open_people(self, pid=""):
        from resources.lib import people
        self.busy = True
        try:
            go = people.show(self.server, pid, go_now=False)
        finally:
            self.busy = False
        if go:
            self.leave(go)

    def cat_server(self):
        state_url = HOME_prop("korie.server")
        out = [row("Korie server", "Where this screen gets everything from", state_url, "val", words="address connect",
                   do=lambda: self.leave("RunPlugin(plugin://plugin.video.korie/?a=server)"))]
        if not self.person().get("canSettings"):
            return out
        d = self.server.call("/api/settings")
        s = d.get("settings", {})
        lang = dict(LANGS).get(s.get("language"), s.get("language", ""))
        out += [
            row("Server name", "What devices show when they find it", s.get("server_name", ""), "sel", do=lambda: self.set_text("server_name", "The server's name", s.get("server_name", ""))),
            row("Language of film and series details", "Titles and descriptions from TMDb", lang, "sel", do=lambda: self.set_lang(s.get("language"))),
            row("TMDb key", "Details and pictures come from TMDb" if d.get("tmdb") else "No key: Korie can't fetch details", "Your own" if s.get("tmdb_key") else "Korie's", "sel",
                do=self.set_key),
            row("Look for new files when the server starts", "Off: only when you ask, or when a folder is added", kind="tick", on=bool(s.get("scan_on_start")),
                do=lambda: self.server.call("/api/settings", {"key": "scan_on_start", "value": not s.get("scan_on_start")})),
        ]
        return out

    def set_text(self, key, title, now):
        t = xbmcgui.Dialog().input(title, now)
        if t.strip():
            self.server.call("/api/settings", {"key": key, "value": t.strip()})

    def set_lang(self, now):
        i = screens.menu("Language for details from TMDb", [{"label": n, "on": c == now} for c, n in LANGS],
                         start=next((n for n, (c, _) in enumerate(LANGS) if c == now), 0))
        if i >= 0:
            self.server.call("/api/settings", {"key": "language", "value": LANGS[i][0]})

    def set_key(self):
        t = xbmcgui.Dialog().input("Your own TMDb API key (empty: Korie's)", option=xbmcgui.ALPHANUM_HIDE_INPUT)
        self.server.call("/api/settings", {"key": "tmdb_key", "value": (t or "").strip()})

    def cat_addons(self):
        d = self.server.call("/api/addons")
        out = [row(a["name"], a.get("error") or a.get("description", ""), "On" if a.get("enabled") else "Off", "val", words="add-on addon",
                   do=lambda a=a: self.leave("ReplaceWindow(Videos,plugin://plugin.video.korie/?a=addon&id=%s,return)" % a["id"]))
               for a in d.get("addons", []) if a.get("installed")]
        out.append(row("Get more add-ons", "Radio, podcasts, online catalogues and more from the Store", words="store install",
                       do=lambda: self.leave("ReplaceWindow(Videos,plugin://plugin.video.korie/?a=addons&tab=store,return)")))
        return out

    def cat_device(self):
        p = self.person()
        out = [row("Switch person", "Back to Who's watching", p.get("name", ""), "val", words="profile sign out",
                   do=lambda: self.leave("ActivateWindow(1190)"))]
        if p.get("admin"):
            everyone = self.server.call("/api/people/all").get("people", [])
            me = device_id()
            auto = next((x for x in everyone if x.get("autoDevice") == me), None)
            out.append(row("Signs in by itself as", "%s skips Who's watching and starts as one person" % device_name(),
                           auto["name"] if auto else "Nobody", "sel", do=lambda: self.choose_auto(everyone, auto), words="automatic"))
        out += [
            row("Check for updates", "Gets the newest Korie from your server now (it also does this by itself)", xbmc.getInfoLabel("System.AddonVersion(plugin.video.korie)"), "val",
                do=lambda: (xbmc.executebuiltin("UpdateAddonRepos"), note("Looking for updates…")), words="version"),
            row("Kodi's own settings", "Only if something needs fixing: Kodi's menus, as they are without Korie",
                do=lambda: self.leave("ActivateWindow(settings)")),
        ]
        return out

    def choose_auto(self, everyone, auto):
        opts = [None] + everyone
        i = screens.menu("This screen signs in by itself as", [{"label": "Nobody: ask who's watching" if x is None else x["name"], "on": x is auto or (x and auto and x["id"] == auto["id"])} for x in opts])
        if i < 0:
            return
        if opts[i] is None:
            if auto:
                self.server.call("/api/people/" + auto["id"], {"autoDevice": None}, method="PATCH")
        else:
            self.server.call("/api/people/" + opts[i]["id"], {"autoDevice": device_id()}, method="PATCH")

    def cat_about(self):
        sv = self.me.get("server") or {}
        return [
            row("Korie %s" % sv.get("version", ""), "Server “%s”" % sv.get("name", ""), "", words="version"),
            row("Korie for Kodi %s" % xbmc.getInfoLabel("System.AddonVersion(plugin.video.korie)"), xbmc.getInfoLabel("System.BuildVersionShort") and "Kodi " + xbmc.getInfoLabel("System.BuildVersionShort"), words="version"),
            row("Details and pictures from TMDb", "Uses the TMDb API; not endorsed or certified by TMDb", words="tmdb"),
        ]


def HOME_prop(name):
    return ui.HOME.getProperty(name)


def screens_menu_id():
    return 9000


def show(server, cat=""):
    """Opens Settings (on this category); False when the Korie skin isn't there."""
    if not screens.korie_skin():
        return False
    ui.show_theme()
    ui.show_server(load_state())
    try:
        w = _Settings("Korie_Settings.xml", screens.PATH, "Default", "1080i", server=server, cat=cat)
        w.doModal()
        w.stop = True
        if w.watcher:
            w.watcher.join(2)
        go = w.go
        del w
    except RuntimeError as e:
        log("Korie_Settings.xml: %s" % e)
        return False
    if go:
        xbmc.executebuiltin(go)
    return True
