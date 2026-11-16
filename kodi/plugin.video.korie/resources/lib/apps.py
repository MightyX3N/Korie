# Android apps on this TV (Korie is the home screen there): the ones the person may open, the
# ones used lately, and the ones hidden on this TV. Kodi lists them (androidapp://) and starts them.
import json
import os

import xbmc
import xbmcgui

from resources.lib import korie, ui
from resources.lib.korie import log

LOCAL = os.path.join(korie.DATA, "apps.json")  # this TV's own: hidden apps, recently used


def _local():
    try:
        with open(LOCAL, encoding="utf-8") as f:
            d = json.load(f)
            return {"hidden": list(d.get("hidden", [])), "recent": list(d.get("recent", []))}
    except (OSError, ValueError):
        return {"hidden": [], "recent": []}


def _save(d):
    os.makedirs(korie.DATA, exist_ok=True)
    tmp = LOCAL + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f)
    os.replace(tmp, LOCAL)


def installed():
    """[{pkg, label, icon}] for every app on this TV."""
    if os.path.exists(ui.TEST_APPS):
        with open(ui.TEST_APPS, encoding="utf-8") as f:
            return json.load(f)
    r = ui.rpc("Files.GetDirectory", directory="androidapp://sources/apps/", media="files", properties=["thumbnail"])
    out = []
    for f in (r.get("result") or {}).get("files") or []:
        pkg = f.get("file", "").rstrip("/").rsplit("/", 1)[-1]
        if pkg:
            out.append({"pkg": pkg, "label": f.get("label") or pkg, "icon": f.get("thumbnail", "")})
    return sorted(out, key=lambda a: a["label"].lower())


def report(server, apps):
    """The server learns which apps this TV has, so an admin can choose who may open which."""
    try:
        server.call("/api/apps", {"apps": [{"pkg": a["pkg"], "label": a["label"]} for a in apps]})
    except korie.KorieError as e:
        log(e)


def listing(server, person, tab):
    """(apps to show, how many hidden, note) for a tab: all, recent or hidden."""
    every = installed()
    report(server, every)
    allowed = (person or {}).get("apps", "all")
    mine = [a for a in every if allowed == "all" or a["pkg"] in allowed]
    local = _local()
    hidden = [a for a in mine if a["pkg"] in local["hidden"]]
    shown = [a for a in mine if a["pkg"] not in local["hidden"]]
    if tab == "recent":
        by = {a["pkg"]: a for a in shown}
        shown = [by[p] for p in local["recent"] if p in by]
    elif tab == "hidden":
        shown = hidden
    note = "" if allowed == "all" else "Only the apps %s may use" % (person or {}).get("name", "you")
    return shown, len(hidden), note, len(every)


def start(pkg):
    local = _local()
    local["recent"] = [pkg] + [p for p in local["recent"] if p != pkg][:11]
    _save(local)
    if os.path.exists(ui.TEST_APPS):
        log("would start %s" % pkg)
        xbmcgui.Dialog().notification("Korie", "Starting %s" % pkg, xbmcgui.NOTIFICATION_INFO, 2000)
        return
    xbmc.executebuiltin("StartAndroidActivity(%s)" % pkg)


def set_hidden(pkg, hide):
    local = _local()
    local["hidden"] = [p for p in local["hidden"] if p != pkg] + ([pkg] if hide else [])
    _save(local)


def is_hidden(pkg):
    return pkg in _local()["hidden"]


def info(pkg):
    """Android's own page for the app (storage, permissions, force stop)."""
    xbmc.executebuiltin("StartAndroidActivity(,android.settings.APPLICATION_DETAILS_SETTINGS,,package:%s)" % pkg)


def uninstall(pkg):
    """Android asks the person itself before it removes the app."""
    xbmc.executebuiltin("StartAndroidActivity(,android.intent.action.DELETE,,package:%s)" % pkg)
