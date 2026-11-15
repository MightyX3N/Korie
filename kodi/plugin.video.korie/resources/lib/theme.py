# Korie themes: a theme is a theme.json (colours, fonts, sizes) plus images. This turns one into
# what Kodi's skin engine reads: a colour file and a font set. Nobody making a theme ever sees XML.
#
# Used in two places: tools/make_skin.py for the themes that come with Korie, and the Korie add-on
# when a theme is installed from the server.
import json
import os
import re

# Every colour the Korie skin uses, with the Korie Classic value. A theme may set any of them;
# the ones it leaves out keep these.
COLOURS = {
    "ground": "#0a1420",     # the screen behind everything
    "panel": "#16293f",      # buttons, cards, menus
    "panel2": "#102033",     # quieter boxes
    "ink": "#eaf1f8",        # main text
    "soft": "#c3d1df",       # secondary text
    "dim": "#9db0c4",        # small print
    "accent": "#2fb0ea",     # focus, progress, the chosen thing
    "onaccent": "#04131d",   # text on the accent colour
    "warm": "#e8a33d",       # notes and warnings
    "shade": "#070e17",      # bars over pictures
}

# Font roles and the sizes the screens use them at (in the 1920x1080 grid)
FONT_ROLES = {
    "body": [20, 22, 24, 26, 28, 32, 36],
    "heading": [26, 30, 34, 40, 46, 52, 64, 72, 110],
}
DEFAULT_FONTS = {"body": "Barlow-Medium.ttf", "heading": "BarlowSemiCondensed-SemiBold.ttf"}

# Estuary's own colour names (its dialogs, keyboard and player controls use them) and the
# Korie colour each one takes, so Kodi's own dialogs follow the theme too.
ESTUARY = {
    "primary_background": "ground",
    "background": "ground",
    "dialog_tint": "panel",
    "white": "ink",
    "grey": "dim",
    "blue": "accent",
    "button_focus": "accent",
    "selected": "warm",
}

ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,40}$")


class ThemeError(Exception):
    pass


def argb(value, alpha="FF"):
    v = str(value).strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", v):
        return (alpha + v).upper()
    if re.fullmatch(r"[0-9a-fA-F]{8}", v):  # already AARRGGBB
        return v.upper()
    raise ThemeError("Not a colour: %r (use #rrggbb)" % value)


def load(folder):
    """Reads and checks a theme folder; returns the theme as a dict with every field filled."""
    with open(os.path.join(folder, "theme.json"), encoding="utf-8") as f:
        t = json.load(f)
    tid = str(t.get("id", ""))
    if not ID_RE.match(tid):
        raise ThemeError("A theme id is lower case letters, digits, - and _ (got %r)" % tid)
    colours = dict(COLOURS)
    for k, v in (t.get("colours") or t.get("colors") or {}).items():
        if k not in COLOURS:
            raise ThemeError("Unknown colour %r; the colours are: %s" % (k, ", ".join(COLOURS)))
        colours[k] = v
    for k, v in colours.items():
        argb(v)  # checks it
    fonts = dict(DEFAULT_FONTS)
    for k, v in (t.get("fonts") or {}).items():
        if k not in FONT_ROLES:
            raise ThemeError("Unknown font role %r; the roles are: %s" % (k, ", ".join(FONT_ROLES)))
        if "/" in v or "\\" in v or not v.lower().endswith((".ttf", ".otf")):
            raise ThemeError("A font is a .ttf or .otf file in the theme folder (got %r)" % v)
        fonts[k] = v
    return {"id": tid, "name": str(t.get("name") or tid), "version": str(t.get("version") or "1.0"),
            "author": str(t.get("author") or ""), "colours": colours, "fonts": fonts,
            "background": t.get("background") or "", "folder": folder}


def colour_file(theme):
    """The colour file for Kodi (colors/<id>.xml)."""
    c = theme["colours"]
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', "<!-- Made from the Korie theme \"%s\". Change theme.json, not this. -->" % theme["name"], "<colors>"]
    for k, v in c.items():
        lines.append('\t<color name="korie_%s">%s</color>' % (k, argb(v)))
        # see-through versions for focus glows, bars over pictures and dimmed backgrounds
        for pct, a in (("90", "E6"), ("60", "99"), ("40", "66"), ("25", "40"), ("15", "26")):
            lines.append('\t<color name="korie_%s%s">%s</color>' % (k, pct, argb(v, a)))
    for est, mine in ESTUARY.items():
        lines.append('\t<color name="%s">%s</color>' % (est, argb(c[mine])))
    lines.append('\t<color name="button_alt_focus">%s</color>' % argb(c["accent"], "80"))
    lines.append('\t<color name="secondary_background">%s</color>' % argb(c["panel"], "33"))
    lines.append("</colors>")
    return "\n".join(lines) + "\n"


def fontset(theme, fontset_id, estuary_default):
    """A font set for Font.xml: the Korie font names plus Estuary's own (so its dialogs follow)."""
    body, head = theme["fonts"]["body"], theme["fonts"]["heading"]
    out = ['<fontset id="%s">' % fontset_id]
    for role, sizes in FONT_ROLES.items():
        for size in sizes:
            out.append("\t\t<font><name>korie_%s%d</name><filename>%s</filename><size>%d</size></font>"
                       % (role, size, body if role == "body" else head, size))
    # Estuary's fonts, with its two typefaces swapped for the theme's
    inner = re.search(r"<fontset[^>]*>(.*)</fontset>", estuary_default, flags=re.S).group(1)
    inner = re.sub(r"NotoSans-Regular\.ttf|Barlow-Medium\.ttf", body, inner)
    inner = re.sub(r"Roboto-Thin\.ttf|Barlow-Regular\.ttf|BarlowSemiCondensed-SemiBold\.ttf", head, inner)
    out.append(inner.rstrip())
    out.append("\t</fontset>")
    return "\t" + "\n".join(out)


def install(theme, skin_dir):
    """Writes a theme into the skin: its colour file, its fonts and its font set."""
    import shutil
    with open(os.path.join(skin_dir, "colors", theme["id"] + ".xml"), "w", encoding="utf-8") as f:
        f.write(colour_file(theme))
    for role, name in theme["fonts"].items():
        src = os.path.join(theme["folder"], name)
        if os.path.exists(src):
            shutil.copy(src, os.path.join(skin_dir, "fonts", name))
        elif not os.path.exists(os.path.join(skin_dir, "fonts", name)):
            raise ThemeError("The theme names %s but doesn't include it" % name)
    if theme["background"]:
        dst = os.path.join(skin_dir, "media", "korie", "themes", theme["id"])
        os.makedirs(dst, exist_ok=True)
        shutil.copy(os.path.join(theme["folder"], theme["background"]), os.path.join(dst, "background" + os.path.splitext(theme["background"])[1]))
    font_xml = os.path.join(skin_dir, "xml", "Font.xml")
    with open(font_xml, encoding="utf-8") as f:
        s = f.read()
    estuary = re.search(r'<fontset id="Estuary"[^>]*>.*?</fontset>', s, flags=re.S)
    if not estuary:
        raise ThemeError("Font.xml has no Estuary font set to start from")
    fid = "korie-" + theme["id"]
    s = re.sub(r'\s*<fontset id="%s"[^>]*>.*?</fontset>' % re.escape(fid), "", s, flags=re.S)
    s = s.replace("<fonts>", "<fonts>\n" + fontset(theme, fid, estuary.group(0)), 1)
    with open(font_xml, "w", encoding="utf-8") as f:
        f.write(s)
    with open(os.path.join(skin_dir, "colors", theme["id"] + ".json"), "w", encoding="utf-8") as f:
        json.dump({"id": theme["id"], "name": theme["name"], "version": theme["version"], "author": theme["author"],
                   "background": bool(theme["background"])}, f)
    return fid


def installed(skin_dir):
    """The themes in the skin, from the little json each install leaves next to its colours."""
    out = []
    d = os.path.join(skin_dir, "colors")
    for name in sorted(os.listdir(d)):
        if name.endswith(".json"):
            try:
                with open(os.path.join(d, name), encoding="utf-8") as f:
                    out.append(json.load(f))
            except (OSError, ValueError):
                pass
    return out
