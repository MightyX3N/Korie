# Korie's own screens for the things Kodi would otherwise draw itself: the options menu, the
# PIN pad, the audio and subtitles panel while something plays, and search. Each is a skin file
# (xml/Korie_*.xml in the Korie skin) driven from here. Outside the Korie skin they aren't there,
# so every one falls back to Kodi's own dialog.
import re
import json
import threading
import time

import xbmc
import xbmcaddon
import xbmcgui

from resources.lib.korie import log

PATH = xbmcaddon.Addon("plugin.video.korie").getAddonInfo("path")

BACK = (9, 10, 92, 110)          # previous menu, parent folder, back, backspace
OPTIONS = 117                    # the options (context menu) button
NUMBERS = {58 + n: str(n) for n in range(10)}   # the remote's number keys
ROW = 63                         # one line in a menu


def rpc(method, **params):
    return json.loads(xbmc.executeJSONRPC(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}))).get("result")


def korie_skin():
    return xbmc.getSkinDir() == "skin.korie"


# --- a menu: options for a film, a list to choose from --------------------------------------------

class _Menu(xbmcgui.WindowXMLDialog):
    def __init__(self, *args, **kwargs):
        self.title = kwargs["title"]
        self.options = kwargs["options"]
        self.start = kwargs.get("start", 0)
        self.chosen = -1

    def onInit(self):
        self.setProperty("korie.title", self.title)
        lst = self.getControl(100)
        lst.reset()
        items = []
        for o in self.options:
            li = xbmcgui.ListItem(o["label"], o.get("note", ""), offscreen=True)
            if o.get("icon"):
                li.setArt({"icon": "korie/icon-%s.png" % o["icon"]})
            if o.get("thumb"):
                li.setArt({"thumb": o["thumb"]})
            if o.get("danger"):
                li.setProperty("danger", "1")
            if o.get("gap"):
                li.setProperty("gap", "1")
            if o.get("on"):
                li.setProperty("on", "1")
            items.append(li)
        lst.addItems(items)
        shown = min(len(items), 12)
        lst.setHeight(shown * ROW)
        panel = 30 + (72 if self.title else 0) + shown * ROW + 24
        self.getControl(90).setHeight(panel)
        self.getControl(80).setPosition(self.getControl(80).getX(), max(40, (1080 - panel) // 2))
        self.setFocusId(100)
        lst.selectItem(self.start)

    def onClick(self, cid):
        if cid == 100:
            self.chosen = self.getControl(100).getSelectedPosition()
            self.close()

    def onAction(self, action):
        if action.getId() in BACK or action.getId() == OPTIONS:
            self.close()


def menu(title, options, start=0):
    """options: dicts with label, and maybe note, icon, thumb, danger, gap (a line above), on (a tick).
    Returns the chosen one's index, or -1."""
    if korie_skin():
        try:
            d = _Menu("Korie_Menu.xml", PATH, "Default", "1080i", title=title, options=options, start=start)
            d.doModal()
            chosen = d.chosen
            del d
            return chosen
        except RuntimeError as e:
            log("Korie_Menu.xml: %s" % e)
    return xbmcgui.Dialog().select(title, [o["label"] + ("  (%s)" % o["note"] if o.get("note") else "") for o in options], preselect=start)


# --- pick a picture (another poster) -----------------------------------------------------------

class _Pictures(xbmcgui.WindowXMLDialog):
    def __init__(self, *args, **kwargs):
        self.title = kwargs["title"]
        self.pictures = kwargs["pictures"]
        self.chosen = -1

    def onInit(self):
        self.setProperty("korie.title", self.title)
        panel = self.getControl(100)
        panel.reset()
        items = []
        for p in self.pictures:
            li = xbmcgui.ListItem(p.get("label", ""), offscreen=True)
            li.setArt({"thumb": p["picture"]})
            items.append(li)
        panel.addItems(items)
        self.setFocusId(100)

    def onClick(self, cid):
        if cid == 100:
            self.chosen = self.getControl(100).getSelectedPosition()
            self.close()

    def onAction(self, action):
        if action.getId() in BACK or action.getId() == OPTIONS:
            self.close()


def pictures(title, pics):
    """pics: dicts with picture (an address) and label. The chosen one's index, or -1."""
    if korie_skin():
        try:
            d = _Pictures("Korie_Pictures.xml", PATH, "Default", "1080i", title=title, pictures=pics)
            d.doModal()
            chosen = d.chosen
            del d
            return chosen
        except RuntimeError as e:
            log("Korie_Pictures.xml: %s" % e)
    return menu(title, [{"label": p.get("label", ""), "thumb": p["picture"]} for p in pics])


# --- the PIN pad ------------------------------------------------------------------------------

class _Pin(xbmcgui.WindowXMLDialog):
    KEYS = {200 + n: str(n) for n in range(10)}
    DELETE, DONE, BACK_BUTTON = 210, 211, 10

    def __init__(self, *args, **kwargs):
        self.person = kwargs["person"]
        self.check = kwargs["check"]
        self.digits = ""
        self.ok = False
        self.busy = False

    def onInit(self):
        p = self.person
        self.setProperty("korie.name", p.get("name", ""))
        self.setProperty("korie.letter", p.get("name", "?")[:1].upper())
        c = (p.get("color") or "#4f8fe6").lstrip("#")
        self.setProperty("korie.colour", ("FF" + c).upper() if len(c) == 6 else "FF4F8FE6")
        self.show_digits()
        self.setFocusId(205)

    def show_digits(self):
        self.setProperty("korie.n", str(len(self.digits)))

    def press(self, d):
        if self.busy or len(self.digits) >= 4:
            return
        self.digits += d
        self.setProperty("korie.error", "")
        self.show_digits()
        if len(self.digits) == 4:
            self.submit()

    def submit(self):
        if len(self.digits) != 4:
            self.setProperty("korie.error", "The PIN has four digits.")
            return
        self.busy = True
        try:
            error = self.check(self.digits)
        except Exception as e:  # the server went away: say so here instead of losing the screen
            error = str(e)
        self.busy = False
        if error is None:
            self.ok = True
            self.close()
            return
        self.digits = ""
        self.show_digits()
        self.setProperty("korie.error", error)

    def onClick(self, cid):
        if cid in self.KEYS:
            self.press(self.KEYS[cid])
        elif cid == self.DELETE:
            self.digits = self.digits[:-1]
            self.show_digits()
        elif cid == self.DONE:
            self.submit()
        elif cid == self.BACK_BUTTON:
            self.close()

    def onAction(self, action):
        a = action.getId()
        if a in NUMBERS:
            self.press(NUMBERS[a])
        elif a in BACK:
            self.close()


def pin(person, check):
    """Asks for a person's PIN until check(pin) returns None (signed in). check returns the
    message to show when the PIN is wrong. True when signed in."""
    if korie_skin():
        try:
            d = _Pin("Korie_Pin.xml", PATH, "Default", "1080i", person=person, check=check)
            d.doModal()
            ok = d.ok
            del d
            return ok
        except RuntimeError as e:
            log("Korie_Pin.xml: %s" % e)
    while True:
        p = xbmcgui.Dialog().numeric(0, "PIN for %s" % person.get("name", ""), "", True)
        if not p:
            return False
        error = check(p)
        if error is None:
            return True
        xbmcgui.Dialog().notification("Korie", error, xbmcgui.NOTIFICATION_WARNING, 4000)


# --- audio and subtitles, while something plays ---------------------------------------------------

def _language(code):
    if not code:
        return ""
    name = xbmc.convertLanguage(code, xbmc.ENGLISH_NAME)
    return name or code


def _channels(n):
    return {1: "Mono", 2: "Stereo", 6: "5.1", 8: "7.1"}.get(int(n or 0), "")


# Kodi adds the format to a track's name ("English - AAC-LC stereo"); the menu says channels itself
_CODEC_TAIL = re.compile(r"\s+-\s+(aac|ac-?3|e-?ac-?3|dts|truehd|flac|opus|mp3|mp2|pcm|vorbis|alac|srt|subrip|ass|ssa|pgs|vobsub|dvd|webvtt|mov_text)\b.*$", re.I)


def _named(language, name, fallback):
    """A track's label: its language, and its own name when that says more (a name that already
    has the language in it stands alone)."""
    name = _CODEC_TAIL.sub("", (name or "").strip())
    if not language:
        return [name or fallback]
    if not name or name.lower() == language.lower():
        return [language]
    if language.lower() in name.lower():
        return [name]
    return [language, name]


def _video_player():
    for p in rpc("Player.GetActivePlayers") or []:
        if p.get("type") == "video":
            return p["playerid"]
    return None


class _Streams(xbmcgui.WindowXMLDialog):
    AUDIO, SUBS, AUDIO_HEAD, SUBS_HEAD, PANEL = 200, 300, 199, 299, 90

    def __init__(self, *args, **kwargs):
        self.player = kwargs["player"]
        self.audio = []
        self.subs = []
        self.finder = kwargs.get("finder", False)

    def onInit(self):
        self.fill()
        self.setFocusId(self.SUBS if not self.audio else self.AUDIO)

    def fill(self, keep=None):
        props = rpc("Player.GetProperties", playerid=self.player,
                    properties=["audiostreams", "currentaudiostream", "subtitles", "currentsubtitle", "subtitleenabled"]) or {}
        cur_a = (props.get("currentaudiostream") or {}).get("index", -1)
        cur_s = (props.get("currentsubtitle") or {}).get("index", -1) if props.get("subtitleenabled") else None
        self.audio, self.subs = [], [("off", "Off", cur_s is None)]
        for a in props.get("audiostreams") or []:
            bits = _named(_language(a.get("language")), a.get("name"), "Track %d" % (a["index"] + 1))
            if _channels(a.get("channels")):
                bits.append(_channels(a.get("channels")))
            self.audio.append((a["index"], " · ".join(bits), a["index"] == cur_a))
        for s in props.get("subtitles") or []:
            bits = _named(_language(s.get("language")), s.get("name"), "Subtitles %d" % (s["index"] + 1))
            if s.get("isforced"):
                bits.append("Forced")
            if s.get("isimpaired"):
                bits.append("For the hard of hearing")
            self.subs.append((s["index"], " · ".join(bits), s["index"] == cur_s))
        if self.finder:
            self.subs.append(("find", "Find more subtitles…", False))

        def put(cid, rows):
            lst = self.getControl(cid)
            pos = lst.getSelectedPosition()
            lst.reset()
            items = []
            for _, label, on in rows:
                li = xbmcgui.ListItem(label, offscreen=True)
                if on:
                    li.setProperty("on", "1")
                items.append(li)
            lst.addItems(items)
            if keep == cid and pos >= 0:
                lst.selectItem(pos)

        put(self.AUDIO, self.audio)
        put(self.SUBS, self.subs)
        # lay the two lists out one under the other, inside the panel
        y = 28
        if self.audio:
            self.getControl(self.AUDIO_HEAD).setPosition(30, y)
            ah = min(len(self.audio), 5) * 59
            self.getControl(self.AUDIO).setPosition(14, y + 46)
            self.getControl(self.AUDIO).setHeight(ah)
            y += 46 + ah + 20
        self.getControl(self.AUDIO_HEAD).setVisible(bool(self.audio))
        self.getControl(self.AUDIO).setVisible(bool(self.audio))
        sh = min(len(self.subs), 13 - min(len(self.audio), 5)) * 59
        self.getControl(self.SUBS_HEAD).setPosition(30, y)
        self.getControl(self.SUBS).setPosition(14, y + 46)
        self.getControl(self.SUBS).setHeight(sh)
        self.getControl(self.PANEL).setHeight(y + 46 + sh + 24)

    def onClick(self, cid):
        if cid == self.AUDIO:
            idx = self.audio[self.getControl(cid).getSelectedPosition()][0]
            rpc("Player.SetAudioStream", playerid=self.player, stream=idx)
        elif cid == self.SUBS:
            idx = self.subs[self.getControl(cid).getSelectedPosition()][0]
            if idx == "find":
                self.close()
                xbmc.executebuiltin("ActivateWindow(SubtitleSearch)")
                return
            if idx == "off":
                rpc("Player.SetSubtitle", playerid=self.player, subtitle="off")
            else:
                rpc("Player.SetSubtitle", playerid=self.player, subtitle=idx, enable=True)
        else:
            return
        xbmc.sleep(250)  # the player takes a moment to switch
        self.fill(keep=cid)

    def onAction(self, action):
        if action.getId() in BACK or action.getId() == OPTIONS:
            self.close()


def streams():
    player = _video_player()
    if player is None:
        return
    finder = bool((rpc("Addons.GetAddons", type="xbmc.subtitle.module", enabled=True) or {}).get("addons"))
    if korie_skin():
        try:
            d = _Streams("Korie_Streams.xml", PATH, "Default", "1080i", player=player, finder=finder)
            d.doModal()
            del d
            return
        except RuntimeError as e:
            log("Korie_Streams.xml: %s" % e)
    xbmc.executebuiltin("ActivateWindow(osdaudiosettings)")


# --- search ----------------------------------------------------------------------------------

HOME = xbmcgui.Window(10000)
# where the menu on the left goes (as in Korie_Includes.xml's KorieRail)
MENU = {
    "home": "ReplaceWindow(Home)",
    "films": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=films,return)",
    "series": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=series,return)",
    "music": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=music,return)",
    "live": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=live,return)",
    "addons": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=addons,return)",
    "apps": "ReplaceWindow(Videos,plugin://plugin.video.korie/?a=apps,return)",
    "settings": "RunPlugin(plugin://plugin.video.korie/?a=prefs)",
    "person": "ActivateWindow(1190)",
}
KEYS = list("abcdefghijklmnopqrstuvwxyz1234567890")
FILTERS = [("all", "Everything"), ("film", "Films"), ("series", "Series"), ("album", "Music"), ("addons", "Add-ons")]


class _Search(xbmcgui.WindowXML):
    TEXT, KEYPAD, SPACE, DELETE, CLEAR, CHIPS, RESULTS = 101, 200, 210, 211, 212, 300, 500  # 101: the search box (a button)
    GRIDS = range(501, 509)        # a grid per kind in 500 (a column), each under its heading (+10)

    def __init__(self, *args, **kwargs):
        self.server = kwargs["server"]
        self.build = kwargs["build"]          # a card from the server -> (url, ListItem, is folder)
        self.open_item = kwargs["open_item"]  # what OK on a result does
        self.text = kwargs.get("text", "")
        self.filter = "all"
        self.groups = []
        self.asked = None
        self.changed = 0.0
        self.stop = False
        self.ready = False
        self.go = ""
        self.watcher = None
        self.failed = False
        self.apps = None       # the Android apps this person may open (on Android), found once
        self.grids = {}        # grid id -> [(card, url, is folder)]

    def filters(self):
        """The chips: no Music for someone who doesn't have music; Apps on Android."""
        return [f for f in FILTERS if not (f[0] == "album" and HOME.getProperty("korie.music.off"))] + \
               ([("apps", "Apps")] if self.my_apps() else [])

    def my_apps(self):
        if self.apps is None:
            self.apps = []
            try:
                from resources.lib import apps
                if apps.installed():
                    person = self.server.call("/api/me").get("person") or {}
                    self.apps = apps.listing(self.server, person, "all")[0]
            except Exception as e:  # noqa: BLE001 - search works without them
                log("search apps: %s" % e)
        return self.apps

    # what you've typed
    def onInit(self):
        try:
            self.start()
        except RuntimeError as e:
            # the screen didn't load (its controls aren't there): don't leave an empty screen up
            log("search screen: %s" % e)
            self.failed = True
            self.stop = True
            self.close()

    def start(self):
        if not self.ready:
            self.setProperty("korie.python", "1")
            HOME.clearProperty("korie.go")
            pad = self.getControl(self.KEYPAD)
            pad.addItems([xbmcgui.ListItem(k, offscreen=True) for k in KEYS])
            self.ready = True
            self.watcher = threading.Thread(target=self.watch, daemon=True)
            self.watcher.start()
            self.show_text()
            self.show_results()
            self.setFocusId(self.KEYPAD)

    def show_text(self):
        self.setProperty("korie.text", self.text)
        self.changed = time.time()

    def type(self, s):
        self.text = (self.text + s)[:60]
        self.show_text()

    def watch(self):
        """Asks the server once you stop typing for a moment; again while add-ons are still searching."""
        monitor = xbmc.Monitor()
        again = 0
        while not self.stop and not monitor.abortRequested():
            if monitor.waitForAbort(0.15):
                break
            # the menu on the left, on this screen, only says where to go (korie.go): close, then go
            go = HOME.getProperty("korie.go")
            if go:
                HOME.clearProperty("korie.go")
                self.go = go
                # close it the way Back does: closing from this thread lets Kodi free the window
                # while this thread still uses it (that crashes Kodi on Android)
                xbmc.executebuiltin("Action(Back)")
                break
            q = self.text.strip()
            waiting = any(g.get("loading") for g in self.groups)
            if q != self.asked and time.time() - self.changed > 0.35:
                again = 0
                self.ask(q)
            elif q and waiting and again < 6 and time.time() - self.changed > 1.5 * (again + 1):
                again += 1
                self.ask(q)

    def ask(self, q):
        self.asked = q
        if not q:
            self.groups = []
        else:
            self.setProperty("korie.busy", "1")
            try:
                self.groups = self.server.get("/api/search", q=q).get("groups", [])
            except Exception as e:  # noqa: BLE001 - shown on the screen
                self.groups = []
                self.setProperty("korie.note", str(e))
            found = [a for a in self.my_apps() if q.lower() in a["label"].lower()]
            if found:
                # after the library's kinds, before the add-ons (as in the design)
                at = sum(1 for g in self.groups if g["id"] in ("film", "series", "album"))
                self.groups.insert(at, {"id": "apps", "title": "Apps", "items": [
                    {"id": a["pkg"], "kind": "app", "title": a["label"], "subtitle": "Android app", "poster": a.get("icon", ""), "thumb": a.get("icon", "")} for a in found]})
            self.setProperty("korie.busy", "")
        if q == self.text.strip():
            self.show_results()

    def kind_of(self, g):
        return g["id"] if g["id"] in ("film", "series", "album", "apps") else "addons"

    def show_results(self):
        q = self.text.strip()
        counts = {"all": 0}
        for g in self.groups:
            n = len(g.get("items", []))
            counts["all"] += n
            counts[self.kind_of(g)] = counts.get(self.kind_of(g), 0) + n
        chips = self.getControl(self.CHIPS)
        chips.reset()
        chip_items = []
        for fid, name in self.filters():
            li = xbmcgui.ListItem(name, offscreen=True)
            li.setProperty("id", fid)
            if fid == self.filter:
                li.setProperty("on", "1")
            if fid != "all" and q and not counts.get(fid):
                li.setProperty("none", "1")
            chip_items.append(li)
        chips.addItems(chip_items)
        chips.selectItem([f for f, _ in self.filters()].index(self.filter))

        groups = [g for g in self.groups if self.filter == "all" or self.kind_of(g) == self.filter]
        shown = [g for g in groups if g.get("items")]
        loading = [g["title"] for g in groups if g.get("loading")]
        self.grids = {}
        n = 0
        one = len(shown) == 1
        for i, gid in enumerate(self.GRIDS):
            grid, head = self.getControl(gid), self.getControl(gid + 10)
            grid.reset()
            g = shown[i] if i < len(shown) else None
            if not g:
                # a last heading says which add-ons are still searching
                head.setLabel("Still searching %s…" % ", ".join(loading) if loading and i == len(shown) and q else "")
                head.setVisible(bool(loading) and i == len(shown) and bool(q))
                grid.setVisible(False)
                continue
            items, rows = [], []
            for c in g["items"]:
                url, li, is_folder = self.card(c)
                li.setLabel(_highlight(c.get("title", ""), q))
                items.append(li)
                rows.append((c, url, is_folder))
            grid.addItems(items)
            self.grids[gid] = rows
            n += len(items)
            head.setLabel("%s · %d" % (g["title"], len(items)) if self.kind_of(g) != "addons" else "From %s · %d" % (g["title"], len(items)))
            head.setVisible(True)
            # in Everything a kind shows three rows at most (its grid scrolls); one kind alone fills the column
            lines = (len(items) + 1) // 2
            grid.setHeight(4 * 186 if one else min(lines, 3) * 186)
            grid.setVisible(True)
        if not q:
            note = "Pick letters on the left, or type in the search box."
        elif n == 0 and not loading:
            note = "Nothing found for “%s”." % q
        elif n == 0:
            note = "Searching %s…" % ", ".join(loading)
        else:
            note = ""
        self.setProperty("korie.note", note)

    def card(self, c):
        """(url, ListItem, is folder) for a result: the server's card, or an Android app."""
        if c.get("kind") == "app":
            li = xbmcgui.ListItem(c["title"], c["subtitle"], offscreen=True)
            li.setArt({"thumb": c.get("thumb") or "korie/icon-apps.png", "poster": c.get("thumb") or "korie/icon-apps.png"})
            li.setProperty("korie.kind", "app")
            li.setProperty("korie.id", c["id"])
            li.setProperty("korie.subtitle", "Android app")
            return "", li, False
        url, li, is_folder = self.build(c)
        # the year is shown already: not again from the subtitle ("2021 · 4 episodes")
        sub, year = c.get("subtitle", ""), str(c.get("year", ""))
        if year and sub.startswith(year):
            li.setProperty("korie.subtitle", sub[len(year):].lstrip(" ·"))
        li.setPath(url)
        return url, li, is_folder

    def onClick(self, cid):
        if cid == self.TEXT:
            # a keyboard, or a phone's remote app, types in Kodi's text entry
            t = xbmcgui.Dialog().input("Search", self.text)
            if t:
                self.text = t[:60]
                self.show_text()
            return
        if cid == self.KEYPAD:
            self.type(KEYS[self.getControl(cid).getSelectedPosition()])
        elif cid == self.SPACE:
            if self.text and not self.text.endswith(" "):
                self.type(" ")
        elif cid == self.DELETE:
            self.text = self.text[:-1]
            self.show_text()
        elif cid == self.CLEAR:
            self.text = ""
            self.show_text()
        elif cid == self.CHIPS:
            self.filter = self.filters()[self.getControl(cid).getSelectedPosition()][0]
            self.show_results()
        elif cid in self.grids:
            pos = self.getControl(cid).getSelectedPosition()
            if 0 <= pos < len(self.grids[cid]):
                c, url, is_folder = self.grids[cid][pos]
                if c.get("kind") == "app":
                    from resources.lib import apps
                    return apps.start(c["id"])
                self.open_item(c, url, is_folder, self.getControl(cid).getSelectedItem())

    def onAction(self, action):
        a = action.getId()
        if a == OPTIONS and self.getFocusId() in self.grids:
            xbmc.executebuiltin("RunPlugin(plugin://plugin.video.korie/?a=options)")
            return
        if a in BACK:
            self.stop = True
            self.close()


def _highlight(title, q):
    """The part of the title you typed, in the theme's accent colour."""
    i = title.lower().find(q.lower()) if q else -1
    if i < 0:
        return title
    return "%s[COLOR korie_accent]%s[/COLOR]%s" % (title[:i], title[i:i + len(q)], title[i + len(q):])


def search(server, build, open_item, text=""):
    if not korie_skin():
        return False
    try:
        w = _Search("Korie_Search.xml", PATH, "Default", "1080i", server=server, build=build, open_item=open_item, text=text)
        w.doModal()
        w.stop = True
        if w.watcher:
            w.watcher.join(5)  # it must be done with the window before the window goes
        go, failed = w.go, w.failed
        del w
        if go and go != "search":
            xbmc.executebuiltin(MENU[go])
        return not failed
    except RuntimeError as e:
        log("Korie_Search.xml: %s" % e)
        return False
