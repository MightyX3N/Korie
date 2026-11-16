# Settings › People (the People artboard): everyone on the left; for the chosen person their
# cards (signing in, films and series, add-ons, Android apps) and what else they may do along the
# bottom. Each change is saved at once. Xml/Korie_People.xml is the screen.
import threading
import time

import xbmc
import xbmcgui

from resources.lib import screens, ui
from resources.lib.korie import KorieError, log, device_id

AGES = [None, 15, 11, 7, 0]


def age_label(age):
    if age is None:
        return "Everything"
    return "For everyone" if age == 0 else "Age %d" % age


def seen(t):
    """When a device was last used: today, yesterday or the date."""
    if not t:
        return ""
    day = time.strftime("%Y-%m-%d", time.localtime(t))
    if day == time.strftime("%Y-%m-%d"):
        return "Today"
    if day == time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400)):
        return "Yesterday"
    return time.strftime("%d %b", time.localtime(t)).lstrip("0")


def note(p):
    """The line under a name: what's special about them."""
    if p.get("admin"):
        return "Runs the server"
    limited = p.get("maxAge") is not None or p.get("addons") != "all" or p.get("apps", "all") != "all" or not p.get("music", True)
    return " · ".join(x for x in ("PIN" if p.get("hasPin") else "", "Limited" if limited else "") if x) or "May watch everything"


def line(label, kind="", on=False, value="", do=None):
    return {"label": label, "kind": kind, "on": on, "value": value, "do": do}


class _People(xbmcgui.WindowXML):
    LIST, SIGNIN, ADDONS, FILMS, APPS = 320, 331, 332, 341, 342
    INSTALL, SETTINGS, DELETE, MORE = 351, 352, 353, 354
    TOP, BAR, ROW, HEAD, GAP = 136, 934, 58, 56, 16

    def __init__(self, *args, **kwargs):
        self.server = kwargs["server"]
        self.pid = kwargs.get("pid") or ""
        self.signed_out = kwargs.get("signed_out", False)  # from Who's watching: no menu on the left
        self.data = {}
        self.everyone = []
        self.cols = {}
        self.stop = False
        self.ready = False
        self.go = ""
        self.watcher = None

    def onInit(self):
        if self.ready:
            return
        self.ready = True
        self.setProperty("korie.python", "1")
        self.setProperty("korie.norail", "1" if self.signed_out else "")
        self.load()
        self.fill_people()
        self.fill_cards()
        self.watcher = threading.Thread(target=self.watch, daemon=True)
        self.watcher.start()
        self.setFocusId(self.LIST)

    def load(self):
        self.data = self.server.call("/api/people/all")
        self.everyone = self.data.get("people", [])
        if not any(p["id"] == self.pid for p in self.everyone) and self.everyone:
            self.pid = self.everyone[0]["id"]

    def person(self):
        return next((p for p in self.everyone if p["id"] == self.pid), {})

    def fill_people(self):
        lst = self.getControl(self.LIST)
        lst.reset()
        items = []
        for p in self.everyone:
            li = xbmcgui.ListItem(p["name"], p["name"][:1].upper(), offscreen=True)
            li.setProperty("note", note(p))
            li.setProperty("colour", ui.colour(p.get("color")))
            li.setProperty("on", "1" if p["id"] == self.pid else "")
            items.append(li)
        add = xbmcgui.ListItem("Add person", offscreen=True)
        add.setProperty("add", "1")
        items.append(add)
        lst.addItems(items)
        lst.selectItem(next((n for n, p in enumerate(self.everyone) if p["id"] == self.pid), 0))

    def watch(self):
        """Moving up and down the people shows each one's cards; the menu's Go closes this."""
        monitor = xbmc.Monitor()
        while not self.stop and not monitor.abortRequested():
            try:
                go = ui.HOME.getProperty("korie.go")
                if go:
                    ui.HOME.clearProperty("korie.go")
                    self.go = screens.MENU.get(go, "")
                    self.stop = True
                    self.close()
                    return
                if self.getFocusId() == self.LIST:
                    n = self.getControl(self.LIST).getSelectedPosition()
                    if 0 <= n < len(self.everyone) and self.everyone[n]["id"] != self.pid:
                        self.pid = self.everyone[n]["id"]
                        lst = self.getControl(self.LIST)
                        for i, p in enumerate(self.everyone):
                            lst.getListItem(i).setProperty("on", "1" if p["id"] == self.pid else "")
                        self.fill_cards()
            except RuntimeError:
                return
            monitor.waitForAbort(0.12)

    # --- the cards ------------------------------------------------------------------------------

    def cards(self):
        """{list id: (heading, rows)}: the four cards and the bar along the bottom."""
        p = self.person()
        if not p:
            return {}
        admin = p.get("admin")
        devices = {d["id"]: d["name"] for d in self.data.get("devices", [])}
        signin = [
            line("Needs a PIN", "tick", p.get("hasPin"), do=self.pin),
            line("Signs in by itself on", "sel", value=devices.get(p.get("autoDevice"), "No device"), do=self.device),
        ]
        films = [] if admin else [line("Only rated up to", "sel", value=age_label(p.get("maxAge")), do=self.age)]
        films.append(line("Music", "tick", p.get("music", True), do=lambda: self.change({"music": not p.get("music", True)})))
        if admin:
            films.append(line("Admins may watch everything.", "note"))
        addons, apps = [], []
        if not admin:
            addons = [line(a["name"], "tick", p["addons"] == "all" or a["id"] in p["addons"], do=lambda a=a: self.choose("addons", a["id"]))
                      for a in self.data.get("addons", [])] or [line("No add-ons yet.", "note")]
            apps = [line(a["label"], "tick", p.get("apps", "all") == "all" or a["pkg"] in p["apps"], do=lambda a=a: self.choose("apps", a["pkg"]))
                    for a in self.data.get("apps", [])]
        return {self.SIGNIN: ("Signing in", signin), self.ADDONS: ("Add-ons they may use", addons),
                self.FILMS: ("Films and series", films), self.APPS: ("Android apps they may use", apps)}

    def fill_cards(self, keep=False):
        cards = self.cards()
        self.cols = {cid: rows for cid, (_, rows) in cards.items()}
        for cid, (title, rows) in cards.items():
            lst = self.getControl(cid)
            pos = lst.getSelectedPosition() if keep else 0
            lst.reset()
            items = []
            for r in rows:
                li = xbmcgui.ListItem(r["label"], r["value"], offscreen=True)
                li.setProperty("kind", r["kind"])
                li.setProperty("on", "1" if r["on"] else "")
                items.append(li)
            lst.addItems(items)
            if items:
                lst.selectItem(min(max(pos, 0), len(items) - 1))
            self.getControl(cid + 3000).setLabel(title)
        p = self.person()
        for key in ("canInstall", "canSettings", "canDelete"):
            self.setProperty("korie." + key, "1" if p.get(key) else "")
        self.place()

    def place(self):
        """Stacks each column's two cards (a card is as tall as its rows, the second one scrolls when
        there are many), hides empty ones and joins the lists up for the remote."""
        shown = {cid: bool(self.cols.get(cid)) for cid in (self.SIGNIN, self.ADDONS, self.FILMS, self.APPS)}
        for first, second in ((self.SIGNIN, self.ADDONS), (self.FILMS, self.APPS)):
            y = self.TOP
            for cid in (first, second):
                group = self.getControl(cid + 1000)
                group.setVisible(shown[cid])
                if not shown[cid]:
                    continue
                room = self.BAR - self.GAP - y - self.HEAD - 12
                h = max(self.ROW, min(len(self.cols[cid]) * self.ROW, room // self.ROW * self.ROW))
                self.getControl(cid).setHeight(h)
                self.getControl(cid + 2000).setHeight(self.HEAD + h + 12)
                group.setPosition(group.getX(), y)
                y += self.HEAD + h + 12 + self.GAP
        c = self.getControl
        admin = self.person().get("admin")
        for cid in (self.INSTALL, self.SETTINGS, self.DELETE):
            c(cid).setVisible(not admin)
        more = c(self.MORE)
        bottom = more if admin else c(self.INSTALL)
        more.controlLeft(more if admin else c(self.DELETE))
        lst = c(self.LIST)
        signin, addons, films, apps = c(self.SIGNIN), c(self.ADDONS), c(self.FILMS), c(self.APPS)
        signin.controlDown(addons if shown[self.ADDONS] else bottom)
        signin.controlLeft(lst)
        signin.controlRight(films)
        addons.controlUp(signin)
        addons.controlDown(bottom)
        addons.controlLeft(lst)
        addons.controlRight(apps if shown[self.APPS] else films)
        films.controlDown(apps if shown[self.APPS] else bottom)
        films.controlLeft(signin)
        apps.controlUp(films)
        apps.controlDown(bottom)
        apps.controlLeft(addons if shown[self.ADDONS] else signin)
        for cid in (self.INSTALL, self.SETTINGS, self.DELETE, self.MORE):
            c(cid).controlUp(addons if shown[self.ADDONS] else signin)

    def refresh(self):
        self.load()
        lst = self.getControl(self.LIST)
        if lst.size() != len(self.everyone) + 1:
            self.fill_people()
        else:
            for i, p in enumerate(self.everyone):
                li = lst.getListItem(i)
                li.setLabel(p["name"])
                li.setLabel2(p["name"][:1].upper())
                li.setProperty("note", note(p))
                li.setProperty("colour", ui.colour(p.get("color")))
        self.fill_cards(keep=True)

    # --- changes --------------------------------------------------------------------------------

    def change(self, body):
        self.server.call("/api/people/" + self.pid, body, method="PATCH")

    def choose(self, key, item):
        p = self.person()
        every = [a["id"] for a in self.data.get("addons", [])] if key == "addons" else [a["pkg"] for a in self.data.get("apps", [])]
        now = every if p.get(key, "all") == "all" else list(p[key])
        nxt = [x for x in now if x != item] if item in now else now + [item]
        self.change({key: "all" if set(nxt) >= set(every) else nxt})

    def pin(self):
        p = self.person()
        if p.get("hasPin"):
            i = screens.menu("PIN for %s" % p["name"], [{"label": "Change the PIN"}, {"label": "No PIN", "danger": True}])
            if i < 0:
                return
            if i == 1:
                self.server.call("/api/people/%s/pin" % p["id"], {"pin": None})
                return
        pin = xbmcgui.Dialog().numeric(0, "A new four-digit PIN for %s" % p["name"], "", True)
        if pin:
            self.server.call("/api/people/%s/pin" % p["id"], {"pin": pin})

    def device(self):
        p = self.person()
        devices = self.data.get("devices", [])
        me = device_id()
        opts = [{"label": "No device", "on": not p.get("autoDevice")}] + \
               [{"label": d["name"] + (" (this one)" if d["id"] == me else ""), "note": seen(d.get("seen")), "on": p.get("autoDevice") == d["id"]} for d in devices]
        i = screens.menu("%s signs in by itself on" % p["name"], opts)
        if i >= 0:
            self.change({"autoDevice": None if i == 0 else devices[i - 1]["id"]})

    def age(self):
        p = self.person()
        i = screens.menu("Films and series %s may watch (ones with no age rating are left out)" % p["name"],
                         [{"label": age_label(a), "note": "" if a is None else ("Rated for all ages" if a == 0 else "Rated %d and under" % a), "on": p.get("maxAge") == a} for a in AGES],
                         start=AGES.index(p.get("maxAge")) if p.get("maxAge") in AGES else 0)
        if i >= 0:
            self.change({"maxAge": AGES[i]})

    def more(self):
        p = self.person()
        me = self.server.call("/api/me").get("person") or {}
        opts = [("name", {"label": "Rename"}), ("color", {"label": "Colour"}),
                ("admin", {"label": "Not an admin" if p.get("admin") else "Make an admin"})]
        if p["id"] != me.get("id"):
            opts.append(("remove", {"label": "Remove %s…" % p["name"], "danger": True}))
        i = screens.menu(p["name"], [o for _, o in opts])
        if i < 0:
            return
        what = opts[i][0]
        if what == "name":
            t = xbmcgui.Dialog().input("Name", p["name"])
            if t.strip():
                self.change({"name": t.strip()})
        elif what == "color":
            colours = ["#e8a33d", "#2fb0ea", "#6cc28a", "#d96fa5", "#9b8cf0", "#e86a5c"]
            names = ["Orange", "Blue", "Green", "Pink", "Purple", "Red"]
            c = screens.menu("Colour", [{"label": n, "on": x == p.get("color")} for x, n in zip(colours, names)])
            if c >= 0:
                self.change({"color": colours[c]})
        elif what == "admin":
            self.change({"admin": not p.get("admin")})
        elif what == "remove":
            if xbmcgui.Dialog().yesno("Remove %s?" % p["name"], "What they watched and their favourites go too.", nolabel="Keep", yeslabel="Remove"):
                self.server.call("/api/people/" + p["id"], method="DELETE")
                self.pid = ""
                self.load()
                self.fill_people()
                self.setFocusId(self.LIST)

    def onClick(self, cid):
        try:
            if cid == self.LIST:
                n = self.getControl(cid).getSelectedPosition()
                if n == len(self.everyone):
                    t = xbmcgui.Dialog().input("Name of the new person")
                    if t.strip():
                        self.pid = self.server.call("/api/people", {"name": t.strip()})["id"]
                        self.load()
                        self.fill_people()
                        self.fill_cards()
                    return
                self.setFocusId(self.SIGNIN)
                return
            p = self.person()
            if cid in (self.INSTALL, self.SETTINGS, self.DELETE):
                key = {self.INSTALL: "canInstall", self.SETTINGS: "canSettings", self.DELETE: "canDelete"}[cid]
                self.change({key: not p.get(key)})
                return self.refresh()
            if cid == self.MORE:
                self.more()
                return self.refresh() if self.pid else None
            rows = self.cols.get(cid, [])
            n = self.getControl(cid).getSelectedPosition()
            if 0 <= n < len(rows) and rows[n]["do"]:
                rows[n]["do"]()
                self.refresh()
        except KorieError as e:
            xbmcgui.Dialog().notification("Korie", str(e), xbmcgui.NOTIFICATION_WARNING, 4000)

    def onAction(self, action):
        if action.getId() in screens.BACK:
            self.stop = True
            self.close()


def show(server, pid="", go_now=True, signed_out=False):
    """Opens People. Where the menu on the left said to go: gone there (go_now), or returned."""
    if not screens.korie_skin():
        from resources.lib import manage
        return manage.people(server)
    try:
        w = _People("Korie_People.xml", screens.PATH, "Default", "1080i", server=server, pid=pid, signed_out=signed_out)
        w.doModal()
        w.stop = True
        if w.watcher:
            w.watcher.join(2)
        go = w.go
        del w
    except (RuntimeError, KorieError) as e:
        log("Korie_People.xml: %s" % e)
        return
    if go and go_now:
        xbmc.executebuiltin(go)
    return go
