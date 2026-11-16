# Runs while Kodi runs. The first time: switches Kodi to the Korie skin and sets the few Kodi
# settings Korie needs. After that: keeps Home's rows up to date (when Home opens, and every
# few minutes while it's open).
import os

import xbmc
import xbmcaddon
import xbmcvfs

from resources.lib import korie, theme, ui
from resources.lib.korie import KorieError, log

ADDON = xbmcaddon.Addon()
SKIN = "skin.korie"
SETUP = 5  # raise when ui.KODI_SETTINGS or ui.KEYMAP changes, so existing installs get the new settings
REFRESH = 300  # seconds
RETRY = 30


def say_yes(monitor, seconds=10):
    """Answers Kodi's yes/no question with Yes (for Korie's own steps only)."""
    for _ in range(int(seconds * 4)):
        if monitor.waitForAbort(0.25):
            return False
        if xbmc.getCondVisibility("Window.IsActive(yesnodialog)"):
            xbmc.executebuiltin("SendClick(yesnodialog,11)")
            return True
    return False


def install_skin(monitor):
    """Installs the Korie skin from the Korie repository. Done here, not as a dependency of
    this add-on: a skin installed as a dependency makes Kodi offer to switch to it at once,
    inside the add-on browser, and Kodi can crash switching skin there."""
    if xbmc.getCondVisibility("System.HasAddon(%s)" % SKIN):
        return True
    log("installing the Korie skin")
    xbmc.executebuiltin("InstallAddon(%s)" % SKIN)
    say_yes(monitor)
    for _ in range(240):
        if monitor.waitForAbort(0.5):
            return False
        if xbmc.getCondVisibility("System.HasAddon(%s)" % SKIN):
            return True
    return False


def apply_skin(monitor):
    if not install_skin(monitor):
        return False
    if xbmc.getSkinDir() == SKIN:
        return True
    # only from Kodi's home screen with nothing open: switching skin anywhere else can crash Kodi
    while not (xbmc.getCondVisibility("Window.IsActive(home)") and not xbmc.getCondVisibility("System.HasActiveModalDialog")):
        if monitor.waitForAbort(1):
            return False
    log("switching Kodi to the Korie skin")
    ui.rpc("Settings.SetSettingValue", setting="lookandfeel.skin", value=SKIN)
    # Kodi asks "Keep this change?" and goes back after a few seconds: answer Yes
    say_yes(monitor)
    monitor.waitForAbort(1)
    return xbmc.getSkinDir() == SKIN


def update_screens(monitor):
    """Korie's screens come inside this add-on (resources/skin): when they're newer than the ones in
    the skin, copy them in and reload the skin (see tools/make_skin.py for why not a skin update)."""
    src = os.path.join(xbmcvfs.translatePath(ADDON.getAddonInfo("path")), "resources", "skin")
    dst = ui.skin_dir()
    try:
        with open(os.path.join(src, "VERSION"), encoding="utf-8") as f:
            want = f.read().strip()
    except OSError:
        return
    marker = os.path.join(dst, "korie-screens")
    try:
        with open(marker, encoding="utf-8") as f:
            have = f.read().strip()
    except OSError:
        have = ""
    if want == have or not os.path.isdir(dst):
        return
    log("new screens %s (had %s)" % (want, have or "none"))
    changed = 0
    for root, _dirs, files in os.walk(src):
        rel = os.path.relpath(root, src)
        os.makedirs(os.path.join(dst, rel), exist_ok=True)
        for name in files:
            if rel == "." and name == "VERSION":
                continue
            # only what changed, each as a new file (fonts in use must not be written into)
            if theme.put_file(os.path.join(root, name), os.path.join(dst, rel, name)):
                changed += 1
    log("%d files of the screens changed" % changed)
    ui.reinstall_themes()
    with open(marker, "w", encoding="utf-8") as f:
        f.write(want)
    if xbmc.getSkinDir() != SKIN:
        return
    # reload when nothing is playing and no pop-up is open
    while xbmc.getCondVisibility("Player.HasMedia") or xbmc.getCondVisibility("System.HasActiveModalDialog"):
        if monitor.waitForAbort(5):
            return
    xbmc.executebuiltin("ReloadSkin()")


class NowPlaying(xbmc.Player):
    """An album Korie started (korie.music.show set): Now playing once the music really plays
    (asking Kodi before that does nothing)."""

    def onAVStarted(self):
        if ui.HOME.getProperty("korie.music.show") and self.isPlayingAudio():
            ui.HOME.clearProperty("korie.music.show")
            if not xbmc.getCondVisibility("Window.IsActive(visualisation)"):
                xbmc.executebuiltin("ActivateWindow(visualisation)")


class Service(xbmc.Monitor):
    def __init__(self):
        super().__init__()
        self.want_home = False
        self.player = NowPlaying()

    def onNotification(self, sender, method, data):
        if sender == "plugin.video.korie" and method.endswith("home"):
            self.want_home = True

    def refresh_home(self):
        """True when Home got its rows (or there's nobody signed in yet)."""
        state = korie.load_state()
        if not state.get("server") or not state.get("token"):
            return True
        try:
            server = korie.Server(state["server"], state["token"])
            ui.show_home(server)
            return True
        except KorieError as e:
            log("couldn't refresh Home: %s" % e)
            # rows already on screen stay; an empty Home says why, and that it keeps trying
            if not ui.HOME.getProperty("korie.row.1.title"):
                ui.HOME.setProperty("korie.status", str(e) + "\nKorie keeps trying.")
                ui.HOME.setProperty("korie.rows", "0")
            return False

    def first_start(self):
        # Kodi's settings Korie needs: checked every start (one that didn't take, or was changed in
        # Kodi's own settings, is put right)
        ui.check_kodi_settings()
        state = korie.load_state()
        if state.get("skin_applied") and state.get("kodi_setup") == SETUP:
            return
        if state.get("kodi_setup") != SETUP:
            ui.setup_kodi()
            state = korie.load_state()
            state["kodi_setup"] = SETUP
            korie.save_state(state)
        if not state.get("skin_applied") and apply_skin(self):
            state = korie.load_state()
            state["skin_applied"] = True
            korie.save_state(state)

    def run(self):
        state = korie.load_state()
        if state.get("name"):
            # remember who was watching, for the menu (the profile screen asks again on start)
            ui.HOME.setProperty("korie.person.last", state["name"])
        self.first_start()
        try:
            update_screens(self)
        except OSError as e:
            log("couldn't update Korie's screens: %s" % e)
        waited = REFRESH
        every = REFRESH
        while not self.abortRequested():
            if self.want_home or (waited >= every and xbmc.getCondVisibility("Window.IsActive(home)")):
                self.want_home = False
                # the server didn't answer: try again soon instead of in five minutes
                every = REFRESH if self.refresh_home() else RETRY
                waited = 0
            if self.waitForAbort(1):
                break
            waited += 1


Service().run()
