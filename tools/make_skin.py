#!/usr/bin/env python3
"""Makes the Korie skin for Kodi.

    python3 tools/make_skin.py <path to skin.estuary> [kodi/skin.korie]

Korie's own screens (kodi/skin-src/xml: Home, the lists, a film's page, who's watching,
settings) are drawn from Korie's designs. Everything else Kodi needs (the keyboard, the PIN
pad, the player's controls, pop-ups) comes from Kodi's own Estuary skin (GPL-2.0, artwork
CC BY-SA 4.0, by phil65 and Ichabod Fletchman, https://github.com/xbmc/xbmc/tree/<release>/
addons/skin.estuary), which is maintained with each Kodi release and in the theme's colours.

Themes (kodi/themes/<id>/theme.json) become colour files and font sets; see
kodi/plugin.video.korie/resources/lib/theme.py. Korie Classic is the default.

Run it again on a newer Estuary (Kodi 22, say) to make the skin for that Kodi.
"""
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ROOT / "kodi" / "skin.korie"
OWN = ROOT / "kodi" / "skin-src"
THEMES = ROOT / "kodi" / "themes"
FONTS = ROOT / "kodi" / "fonts"          # Barlow (SIL Open Font License), see kodi/fonts/OFL.txt

sys.path.insert(0, str(ROOT / "kodi" / "plugin.video.korie" / "resources" / "lib"))
import theme  # noqa: E402

if not (SRC / "xml" / "Home.xml").exists():
    sys.exit("Not a skin.estuary folder: %s" % SRC)

shutil.rmtree(OUT, ignore_errors=True)
shutil.copytree(SRC, OUT)


def edit(rel, fn):
    p = OUT / rel
    s = p.read_text(encoding="utf-8")
    s2 = fn(s)
    if s2 == s:
        sys.exit("Nothing changed in %s: Estuary has changed, update make_skin.py" % rel)
    p.write_text(s2, encoding="utf-8")


# --- the add-on itself ------------------------------------------------------------------------

def addon_xml(s):
    s = re.sub(r'<addon id="skin.estuary" version="[^"]*" name="Estuary" provider-name="([^"]*)">',
               r'<addon id="skin.korie" version="{VERSION}" name="Korie" provider-name="Korie, with parts of Estuary by \1">', s)
    s = re.sub(r"<assets>.*?</assets>", "<assets>\n\t\t\t<icon>resources/icon.png</icon>\n\t\t\t<fanart>resources/fanart.jpg</fanart>\n\t\t</assets>", s, flags=re.S)
    for tag in ("summary", "description", "disclaimer"):
        s = re.sub(r'<%s lang="[^"]*">.*?</%s>\s*' % (tag, tag), "", s, flags=re.S)
    s = s.replace("<platform>all</platform>", '<platform>all</platform>\n\t\t<summary lang="en_GB">Korie\'s look for Kodi</summary>\n'
                  '\t\t<description lang="en_GB">Korie\'s screens for Kodi, with your Korie server\'s films, series, live TV and add-ons, '
                  'in the theme you choose. Kodi\'s own pop-ups and player controls come from Estuary.</description>', 1)
    return s


edit("addon.xml", addon_xml)
for old in (OUT / "resources").glob("screenshot-*.jpg"):
    old.unlink()
shutil.copy(ROOT / "kodi" / "repository.korie" / "icon.png", OUT / "resources" / "icon.png")
shutil.copy(ROOT / "kodi" / "plugin.video.korie" / "fanart.jpg", OUT / "resources" / "fanart.jpg")

# --- Korie's own screens and pictures ---------------------------------------------------------
import xml.dom.minidom  # noqa: E402

for f in (OWN / "xml").glob("*.xml"):
    try:
        xml.dom.minidom.parse(str(f))  # Kodi silently refuses a screen that isn't well-formed
    except Exception as e:  # noqa: BLE001
        sys.exit("%s isn't valid XML: %s" % (f.name, e))
    shutil.copy(f, OUT / "xml" / f.name)
shutil.copytree(OWN / "media", OUT / "media", dirs_exist_ok=True)


def includes(s):
    # Estuary's Includes.xml lists its include files at the top; Korie's joins them
    return s.replace("<includes>", '<includes>\n\t<include file="Korie_Includes.xml" />', 1)


edit("xml/Includes.xml", includes)



# none of Home's row lists (5<row><1 wide, 2 poster, 3 square>) is loading
ROWS_IDLE = " + ".join("!Container(5%d%d).IsUpdating" % (n, k) for n in range(1, 9) for k in (1, 2, 3))


def timers(s):
    # Kodi's chapter list fills after its open actions run, so focusing it there is too early;
    # this timer starts once it has chapters and nothing is focused, and puts the focus on it
    return s.replace("</timers>", """    <timer>
        <name>korie_chapters_focus</name>
        <description>Korie: focus the chapter list once Kodi has filled it</description>
        <start reset="true">Window.IsActive(videobookmarks) + !Control.HasFocus(11) + Integer.IsGreater(Container(11).NumItems,0)</start>
        <stop>Integer.IsGreaterOrEqual(Skin.TimerElapsedSecs(korie_chapters_focus),0)</stop>
        <onstop>SetFocus(11)</onstop>
    </timer>
    <timer>
        <name>korie_rows_steady</name>
        <description>Korie: after switching person, Home's rows hide while they load; once none is loading, they show while refreshing again</description>
        <start reset="true">Window.IsActive(home) + String.IsEmpty(Window(Home).Property(korie.steady))</start>
        <stop>Integer.IsGreaterOrEqual(Skin.TimerElapsedSecs(korie_rows_steady),2) + %s</stop>
        <onstop>SetProperty(korie.steady,1,home)</onstop>
    </timer>
</timers>""" % ROWS_IDLE, 1)


edit("xml/Timers.xml", timers)

# --- fonts and colours: one font set and one colour file per theme ----------------------------
for f in FONTS.glob("*"):
    shutil.copy(f, OUT / "fonts" / f.name)


def fonts(s):
    # Estuary's own set stays (as "Estuary") as the starting point for every theme's set;
    # Arial is for alphabets Estuary's fonts lack, and stays as it is
    return s.replace('<fontset id="Default" idloc="15109">', '<fontset id="Estuary">', 1)


edit("xml/Font.xml", fonts)

for f in (OUT / "colors").glob("*.xml"):
    if f.name != "defaults.xml":
        f.unlink()  # Estuary's colour sets: Korie's themes replace them

ordered = sorted(THEMES.iterdir(), key=lambda d: d.name != "classic", reverse=True)  # classic last = first in Font.xml
for d in ordered:
    if (d / "theme.json").exists():
        t = theme.load(str(d))
        theme.install(t, str(OUT))
        print("theme", t["id"])

# defaults.xml is what Kodi uses before any theme is chosen: Estuary's colours, with Korie Classic's on top
classic = theme.load(str(THEMES / "classic"))
mine = re.findall(r'<color name="([^"]+)">([0-9A-F]{8})</color>', theme.colour_file(classic))


def defaults(s):
    for name, value in mine:
        s, n = re.subn(r'(<color name="%s">)[0-9A-Fa-f]{8}(</color>)' % re.escape(name), r"\g<1>%s\2" % value, s)
        if n == 0:
            s = s.replace("</colors>", '\t<color name="%s">%s</color>\n</colors>' % (name, value))
    return s


edit("colors/defaults.xml", defaults)

# --- the skin's version, and its screens inside the Korie add-on --------------------------------
# Kodi updating a skin while it's on screen can freeze Kodi (it unloads the skin, swaps the files,
# then loads it again; tested on Kodi 21.3 for Android). So the skin add-on keeps one version
# (SHELL) and Kodi never updates it; Korie's screens travel inside the Korie add-on instead, which
# copies them into the skin and reloads it - the same reload a theme change does.
import hashlib  # noqa: E402

SHELL = "1.0.0"   # raise only when the skin itself must be replaced (a new Kodi version's Estuary)
edit("addon.xml", lambda s: s.replace('<addon id="skin.korie" version="{VERSION}"', '<addon id="skin.korie" version="%s"' % SHELL))

PAYLOAD = ROOT / "kodi" / "plugin.video.korie" / "resources" / "skin"
shutil.rmtree(PAYLOAD, ignore_errors=True)
for sub in ("xml", "colors", "fonts", "media/korie"):
    shutil.copytree(OUT / sub, PAYLOAD / sub)
h = hashlib.sha1()
for f in sorted(PAYLOAD.rglob("*")):
    if f.is_file():
        h.update(str(f.relative_to(PAYLOAD)).encode())
        h.update(f.read_bytes())
version = h.hexdigest()[:12]
(PAYLOAD / "VERSION").write_text(version)
(OUT / "korie-screens").write_text(version)
print("screens", version)

print("made", OUT)
