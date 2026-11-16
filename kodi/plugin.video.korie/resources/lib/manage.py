# People, from the TV (Settings › People, for admins): who may do what. The same as on the
# Korie server's page, in Korie's menus.
import xbmcgui

from resources.lib import screens
from resources.lib.korie import KorieError


def _note(e):
    xbmcgui.Dialog().notification("Korie", str(e), xbmcgui.NOTIFICATION_WARNING, 4000)


def people(server):
    while True:
        try:
            d = server.call("/api/people/all")
        except KorieError as e:
            return _note(e)
        everyone = d.get("people", [])
        options = [{"label": p["name"], "note": about(p)} for p in everyone] + [{"label": "Add person", "gap": True}]
        i = screens.menu("People", options)
        if i < 0:
            return
        if i == len(everyone):
            name = xbmcgui.Dialog().input("Name")
            if name.strip():
                try:
                    server.call("/api/people", {"name": name.strip()})
                except KorieError as e:
                    _note(e)
            continue
        person(server, everyone[i]["id"])


def about(p):
    if p.get("admin"):
        return "Admin, runs the server"
    bits = ["PIN"] if p.get("hasPin") else []
    if p.get("maxAge") is not None:
        bits.append(age_label(p["maxAge"]))
    if p.get("addons") != "all" or p.get("apps") != "all" or not p.get("music", True):
        bits.append("Limited")
    return " · ".join(bits)


AGES = [None, 15, 11, 7, 0]


def age_label(age):
    if age is None:
        return "Anything"
    return "For everyone" if age == 0 else "Age %d" % age


def yes(on):
    return "Yes" if on else "No"


def person(server, pid):
    """One person's menu; it stays open while you change things (each change is saved at once)."""
    start = 0
    while True:
        d = server.call("/api/people/all")
        p = next((x for x in d.get("people", []) if x["id"] == pid), None)
        if not p:
            return
        addons, apps = d.get("addons", []), d.get("apps", [])
        rows = [
            ("pin", {"label": "Needs a PIN", "note": yes(p.get("hasPin"))}),
        ]
        if not p.get("admin"):
            rows.append(("maxAge", {"label": "Films and series rated up to", "note": age_label(p.get("maxAge")), "gap": True}))
        rows.append(("music", {"label": "Music", "note": yes(p.get("music", True)), "gap": p.get("admin")}))
        if not p.get("admin"):
            rows += [
                ("addons", {"label": "Add-ons they may use", "note": "All" if p["addons"] == "all" else "%d of %d" % (len(p["addons"]), len(addons))}),
            ]
            if apps:
                rows.append(("apps", {"label": "Android apps they may use", "note": "All" if p.get("apps", "all") == "all" else "%d of %d" % (len(p["apps"]), len(apps))}))
            rows += [
                ("canInstall", {"label": "Install add-ons", "note": yes(p.get("canInstall")), "gap": True}),
                ("canSettings", {"label": "Change settings", "note": yes(p.get("canSettings"))}),
                ("canDelete", {"label": "Delete from the library", "note": yes(p.get("canDelete"))}),
            ]
        rows.append(("admin", {"label": "Admin", "note": yes(p.get("admin")), "gap": p.get("admin")}))
        rows.append(("rename", {"label": "Rename", "gap": True}))
        rows.append(("remove", {"label": "Remove %s…" % p["name"], "danger": True}))
        i = screens.menu(p["name"], [o for _, o in rows], start=start)
        if i < 0:
            return
        start = i
        what = rows[i][0]
        try:
            if what == "pin":
                set_pin(server, p)
            elif what in ("music", "canInstall", "canSettings", "canDelete", "admin"):
                now = p.get(what, True) if what == "music" else p.get(what)
                server.call("/api/people/" + pid, {what: not now}, method="PATCH")
            elif what == "maxAge":
                n = screens.menu("Films and series %s may watch (ones with no age rating are left out)" % p["name"], [
                    {"label": age_label(a), "note": "No limit" if a is None else ("Rated for all ages" if a == 0 else "Rated %d and under" % a), "on": p.get("maxAge") == a}
                    for a in AGES], start=AGES.index(p.get("maxAge")) if p.get("maxAge") in AGES else 0)
                if n >= 0:
                    server.call("/api/people/" + pid, {"maxAge": AGES[n]}, method="PATCH")
            elif what == "addons":
                choose(server, p, "addons", "Add-ons %s may use" % p["name"], [(a["id"], a["name"]) for a in addons])
            elif what == "apps":
                choose(server, p, "apps", "Android apps %s may use" % p["name"], [(a["pkg"], a["label"]) for a in apps])
            elif what == "rename":
                name = xbmcgui.Dialog().input("Name", p["name"])
                if name.strip():
                    server.call("/api/people/" + pid, {"name": name.strip()}, method="PATCH")
            elif what == "remove":
                if xbmcgui.Dialog().yesno("Remove %s?" % p["name"], "What they watched and their favourites go too.", nolabel="Keep", yeslabel="Remove"):
                    server.call("/api/people/" + pid, method="DELETE")
                    return
        except KorieError as e:
            _note(e)


def set_pin(server, p):
    if p.get("hasPin"):
        i = screens.menu("PIN for %s" % p["name"], [{"label": "Change the PIN"}, {"label": "No PIN", "danger": True}])
        if i < 0:
            return
        if i == 1:
            server.call("/api/people/%s/pin" % p["id"], {"pin": None})
            return
    pin = xbmcgui.Dialog().numeric(0, "A new four-digit PIN for %s" % p["name"], "", True)
    if pin:
        server.call("/api/people/%s/pin" % p["id"], {"pin": pin})


def choose(server, p, key, title, everything):
    """Ticks: which of everything (id, name) they may use. All ticked means all, new ones too."""
    start = 0
    while True:
        now = p.get(key, "all")
        chosen = [i for i, _ in everything] if now == "all" else list(now)
        options = [{"label": "All of them, and new ones", "on": now == "all"}] + \
                  [{"label": name, "on": now != "all" and i in chosen} for i, name in everything]
        n = screens.menu(title, options, start=start)
        if n < 0:
            return
        start = n
        if n == 0:
            value = "all" if now != "all" else []
        else:
            i = everything[n - 1][0]
            value = [x for x in chosen if x != i] if i in chosen else chosen + [i]
        r = server.call("/api/people/" + p["id"], {key: value}, method="PATCH")
        p = r or p
