# What the Korie skin shows that isn't a list of things: who's watching, the titles and kinds
# of Home's rows, the theme. The skin reads these as Window(Home) properties.
import json
import os
import time

import xbmc
import xbmcgui
import xbmcvfs

from resources.lib import korie, theme
from resources.lib.korie import KorieError, log

HOME = xbmcgui.Window(10000)
HOME_ROWS = 8
PEOPLE = 8
KINDS = {"wide": "wide", "poster": "poster", "square": "square", "text": "wide"}


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


def choose_theme():
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
    </keyboard>
    <remote>
      <back>Stop</back>
    </remote>
  </FullscreenVideo>
</keymap>
""".format(menu=MENU_KEYS)


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
