# What the Korie skin shows that isn't a list of things: who's watching, the titles and kinds
# of Home's rows, the theme. The skin reads these as Window(Home) properties.
import json
import os
import time
import urllib.parse

import xbmc
import xbmcaddon
import xbmcgui
import xbmcvfs

from resources.lib import korie, theme
from resources.lib.korie import KorieError, log

HOME = xbmcgui.Window(10000)
HOME_ROWS = 8
PEOPLE = 8
KINDS = {"wide": "wide", "poster": "poster", "square": "square", "text": "wide", "fav": "fav"}


def rpc(method, **params):
    return json.loads(xbmc.executeJSONRPC(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})))


def colour(c):
    """#rrggbb from the server to Kodi's AARRGGBB."""
    c = (c or "#2fb0ea").lstrip("#")
    return ("FF" + c).upper() if len(c) == 6 else "FF2FB0EA"


def set_person(person):
    HOME.clearProperty("korie.steady")  # Home's rows hide while they load the new person's things
    name = (person or {}).get("name", "")
    HOME.setProperty("korie.person.name", name)
    HOME.setProperty("korie.person.letter", name[:1].upper())
    HOME.setProperty("korie.person.colour", colour((person or {}).get("color")))


RAIL = ["home", "films", "series", "music", "live", "addons", "apps", "search", "settings"]


TEST_APPS = os.path.join(korie.DATA, "test_apps.json")


def android():
    """Kodi on Android (a test_apps.json in the add-on's data stands in for it when testing elsewhere)."""
    return xbmc.getCondVisibility("System.Platform.Android") or os.path.exists(TEST_APPS)


def set_rail(person):
    """Which entries the menu on the left has for this person on this TV (Music if they may,
    Apps on Android), and each one's place in it (the skin focuses the screen's own entry)."""
    music = (person or {}).get("music", True) is not False
    HOME.setProperty("korie.music.off", "" if music else "1")
    HOME.setProperty("korie.apps.on", "1" if android() else "")
    HOME.setProperty("korie.may.install", "1" if (person or {}).get("canInstall") else "")
    HOME.setProperty("korie.may.admin", "1" if (person or {}).get("admin") else "")
    n = 0
    for k in RAIL:
        if (k == "music" and not music) or (k == "apps" and not android()):
            HOME.setProperty("korie.pos." + k, "")
            continue
        HOME.setProperty("korie.pos." + k, str(n))
        n += 1


def show_people(people, status=""):
    for n in range(1, PEOPLE + 1):
        p = people[n - 1] if n <= len(people) else None
        HOME.setProperty("korie.p.%d.id" % n, p["id"] if p else "")
        HOME.setProperty("korie.p.%d.name" % n, p["name"] if p else "")
        HOME.setProperty("korie.p.%d.letter" % n, p["name"][:1].upper() if p else "")
        HOME.setProperty("korie.p.%d.colour" % n, colour(p.get("color")) if p else "")
        HOME.setProperty("korie.p.%d.pin" % n, "1" if p and p.get("hasPin") else "")
    HOME.setProperty("korie.p.status", status)


def show_home(server):
    """Home's row titles and kinds, so the skin knows which rows to show and how."""
    try:
        set_rail(server.call("/api/me").get("person"))
    except KorieError as e:
        log(e)
    d = server.call("/api/home")
    rows = [r for r in d.get("rows", []) if r.get("items")][:HOME_ROWS]
    for n in range(1, HOME_ROWS + 1):
        r = rows[n - 1] if n <= len(rows) else None
        HOME.setProperty("korie.row.%d.title" % n, r["title"] if r else "")
        HOME.setProperty("korie.row.%d.kind" % n, KINDS.get(r.get("kind"), "poster") if r else "")
    HOME.setProperty("korie.rows", str(len(rows)))
    HOME.setProperty("korie.status", d.get("status") or ("" if rows else "Nothing here yet. Add folders on the Korie server's page."))
    # a new stamp makes the rows ask for their content again
    HOME.setProperty("korie.stamp", str(int(time.time())))


def show_server(state):
    HOME.setProperty("korie.server", (state.get("server") or "").split("://")[-1])


# --- themes -----------------------------------------------------------------------------------

def skin_dir():
    return xbmcvfs.translatePath("special://home/addons/skin.korie/")


def current_theme():
    return korie.load_state().get("theme", "classic")


def disc_menu():
    """Whether DVDs start with the disc's own menu on this screen (Settings, "Disc menus")."""
    return xbmcaddon.Addon("plugin.video.korie").getSetting("disc_menu") != "false"


def show_disc_menu():
    HOME.setProperty("korie.discmenu.name", "Start with the disc's menu" if disc_menu() else "Go straight to the film")


def toggle_disc_menu():
    xbmcaddon.Addon("plugin.video.korie").setSetting("disc_menu", "false" if disc_menu() else "true")
    show_disc_menu()


def show_theme():
    tid = current_theme()
    for t in theme.installed(skin_dir()):
        if t["id"] == tid:
            HOME.setProperty("korie.theme.name", t["name"])
            return
    HOME.setProperty("korie.theme.name", "Korie Classic")


def apply_theme(tid):
    """Switches the skin to a theme's colours, fonts and background."""
    info = next((t for t in theme.installed(skin_dir()) if t["id"] == tid), None)
    if not info:
        raise KorieError("That theme isn't installed.")
    rpc("Settings.SetSettingValue", setting="lookandfeel.skincolors", value=tid)
    rpc("Settings.SetSettingValue", setting="lookandfeel.font", value="korie-" + tid)
    bg = ""
    if info.get("background"):
        folder = os.path.join(skin_dir(), "media", "korie", "themes", tid)
        for name in os.listdir(folder):
            if name.startswith("background."):
                bg = "korie/themes/%s/%s" % (tid, name)
    xbmc.executebuiltin("Skin.SetString(korie.background,%s)" % bg)
    state = korie.load_state()
    state["theme"] = tid
    korie.save_state(state)
    HOME.setProperty("korie.theme.name", info["name"])


def reinstall_themes():
    """Themes installed on this screen (from the server) live in the skin's Font.xml and colors;
    new screens bring a fresh Font.xml, so put them back. The theme folders are kept in Korie's data."""
    folder = os.path.join(korie.DATA, "themes")
    if not os.path.isdir(folder):
        return
    for name in os.listdir(folder):
        try:
            theme.install(theme.load(os.path.join(folder, name)), skin_dir())
        except (OSError, ValueError, theme.ThemeError) as e:
            log("couldn't put back theme %s: %s" % (name, e))


def sync_themes(server):
    """The server's themes (from its Store) that this screen doesn't have yet, or has an older
    version of: fetched into Korie's data, and put into the skin. True when something was added."""
    import hashlib
    import shutil
    d = server.call("/api/themes")
    folder = os.path.join(korie.DATA, "themes")
    os.makedirs(folder, exist_ok=True)
    added = False
    for t in d.get("themes", []):
        if t.get("builtin") or not theme.ID_RE.match(t.get("id", "")):
            continue
        dst = os.path.join(folder, t["id"])
        try:
            with open(os.path.join(dst, "theme.json"), encoding="utf-8") as f:
                have = json.load(f).get("version")
        except (OSError, ValueError):
            have = None
        if have == t.get("version"):
            continue
        tmp = dst + ".new"
        shutil.rmtree(tmp, ignore_errors=True)
        os.makedirs(tmp)
        try:
            for f in t.get("files", []):
                name = f["name"]
                if "/" in name or "\\" in name or name.startswith("."):
                    raise KorieError("The theme lists a file Korie won't write (%s)." % name)
                body = server.fetch("/api/themes/%s/%s" % (t["id"], urllib.parse.quote(name)))
                if f.get("sha256") and hashlib.sha256(body).hexdigest() != f["sha256"]:
                    raise KorieError("%s of the theme %s didn't arrive whole." % (name, t["name"]))
                with open(os.path.join(tmp, name), "wb") as out:
                    out.write(body)
            shutil.rmtree(dst, ignore_errors=True)
            os.rename(tmp, dst)
            theme.install(theme.load(dst), skin_dir())
            log("theme %s %s from the server" % (t["id"], t.get("version")))
            added = True
        except (KorieError, OSError, ValueError, theme.ThemeError) as e:
            log("couldn't get theme %s: %s" % (t.get("id"), e))
            shutil.rmtree(tmp, ignore_errors=True)
    return added


def choose_theme(server=None):
    if server is not None:
        try:
            sync_themes(server)
        except KorieError as e:
            log(e)
    themes = theme.installed(skin_dir())
    if not themes:
        return
    from resources.lib import screens
    tid = current_theme()
    now = next((n for n, t in enumerate(themes) if t["id"] == tid), 0)
    i = screens.menu("Theme", [{"label": t["name"], "on": t["id"] == tid} for t in themes], start=now)
    if i >= 0 and themes[i]["id"] != tid:
        apply_theme(themes[i]["id"])


# --- the first start: Kodi settings Korie needs ----------------------------------------------

KODI_SETTINGS = {
    # OK on a film opens its page (Resume, Play from the start, the story), like Korie's screens
    "myvideos.selectaction": 3,
    # no ".." row at the top of every list: Back does that
    "filelists.showparentdiritems": False,
    # the clock on every screen in 24 hours ("21:40"), as on Korie's other screens
    "locale.use24hourclock": "24hours",
}


OPTIONS = "RunPlugin(plugin://plugin.video.korie/?a=options)"
MENU_KEYS = """
    <keyboard>
      <menu>{o}</menu>
      <c>{o}</c>
      <return mod="longpress">{o}</return>
      <enter mod="longpress">{o}</enter>
    </keyboard>
    <remote>
      <menu>{o}</menu>
      <title>{o}</title>
    </remote>
    <mouse>
      <rightclick>{o}</rightclick>
    </mouse>
""".format(o=OPTIONS)

# The Menu button (and holding OK, and right-click) opens Korie's options instead of Kodi's;
# Back while a film plays stops it and goes back, like the other Korie screens (Kodi's own
# keeps it playing hidden behind the menus).
KEYMAP = """<?xml version="1.0" encoding="UTF-8"?>
<!-- Made by the Korie add-on. -->
<keymap>
  <home>{menu}</home>
  <videos>{menu}</videos>
  <FullscreenVideo>
    <keyboard>
      <backspace>Stop</backspace>
      <browser_back>Stop</browser_back>
      <escape>Stop</escape>
      <menu>OSD</menu>
      <c>OSD</c>
    </keyboard>
    <remote>
      <back>Stop</back>
      <menu>OSD</menu>
      <title>OSD</title>
    </remote>
    <mouse>
      <rightclick>OSD</rightclick>
    </mouse>
  </FullscreenVideo>
  <!-- in a DVD's own menu Kodi uses this section: Menu opens Korie's controls there too -->
  <VideoMenu>
    <keyboard>
      <menu>OSD</menu>
      <c>OSD</c>
    </keyboard>
    <remote>
      <menu>OSD</menu>
      <title>OSD</title>
    </remote>
    <mouse>
      <rightclick>OSD</rightclick>
    </mouse>
  </VideoMenu>
</keymap>
""".format(menu=MENU_KEYS)


def check_kodi_settings():
    for k, v in KODI_SETTINGS.items():
        r = rpc("Settings.GetSettingValue", setting=k)
        now = (r.get("result") or {}).get("value")
        if now != v:
            r = rpc("Settings.SetSettingValue", setting=k, value=v)
            log("Kodi setting %s was %r, set to %r: %s" % (k, now, v, r.get("result", r.get("error"))))


def setup_kodi():
    for k, v in KODI_SETTINGS.items():
        r = rpc("Settings.SetSettingValue", setting=k, value=v)
        if "error" in r:
            log("couldn't set %s: %s" % (k, r["error"]))
    folder = xbmcvfs.translatePath("special://profile/keymaps/")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "korie.xml"), "w", encoding="utf-8") as f:
        f.write(KEYMAP)
    xbmc.executebuiltin("Action(reloadkeymaps)")


# --- your languages (kept on the server: every screen in the house uses them) ----------------

def language_names(me):
    names = dict(me.get("languages") or [])
    p = me.get("person") or {}
    audio, subs = p.get("audio", ""), p.get("subs", "")
    HOME.setProperty("korie.audio.name", names.get(audio, audio) if audio else "Original language")
    HOME.setProperty("korie.subs.name", "Off" if subs == "off" else names.get(subs, subs) if subs else "As the film says")


def choose_language(server, which):
    from resources.lib import screens
    me = server.call("/api/me")
    langs = me.get("languages") or []
    now = (me.get("person") or {}).get(which, "")
    if which == "audio":
        values = [""] + [c for c, _ in langs]
        options = [{"label": "Original language"}] + [{"label": n} for _, n in langs]
        title = "Audio language"
    else:
        values = [c for c, _ in langs] + ["off", ""]
        options = [{"label": n} for _, n in langs] + [{"label": "Off"}, {"label": "As the film says"}]
        title = "Subtitles"
    start = values.index(now) if now in values else 0
    options[start]["on"] = True
    i = screens.menu(title, options, start=start)
    if i < 0 or values[i] == now:
        return
    r = server.call("/api/me/playback", {which: values[i]})
    me["person"] = r.get("person") or me.get("person")
    language_names(me)

