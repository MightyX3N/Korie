# Talking to the Korie server: finding it on the network, signing in as a profile,
# and asking it for things. Standard library only, so it runs on every Kodi.
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

import xbmc
import xbmcaddon
import xbmcgui
import xbmcvfs

ADDON = xbmcaddon.Addon("plugin.video.korie")
DATA = xbmcvfs.translatePath(ADDON.getAddonInfo("profile"))
STATE_FILE = os.path.join(DATA, "state.json")
DISCOVERY_PORT = 7361


class KorieError(Exception):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


def log(msg):
    xbmc.log("[Korie] " + str(msg), xbmc.LOGINFO)


# --- what this Kodi remembers: which server, which profile -----------------------------

def load_state():
    try:
        with open(STATE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(DATA, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, STATE_FILE)


# --- finding servers -------------------------------------------------------------------

def discover(wait=1.5):
    """Every Korie server on the network answers a UDP broadcast with its name and port."""
    found = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(0.3)
        for target in ("255.255.255.255", "<broadcast>"):
            try:
                sock.sendto(b"KORIE_DISCOVER", (target, DISCOVERY_PORT))
            except OSError:
                pass
        end = time.time() + wait
        while time.time() < end:
            try:
                data, addr = sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                break
            try:
                info = json.loads(data.decode("utf-8"))
            except ValueError:
                continue
            if info.get("korie") and info.get("id"):
                found[info["id"]] = {
                    "id": info["id"],
                    "name": info.get("name") or "Korie",
                    "url": "http://%s:%s" % (addr[0], info.get("port", 8100)),
                }
    finally:
        sock.close()
    return list(found.values())


def normalise(address):
    a = address.strip().rstrip("/")
    if not a:
        return ""
    if "://" not in a:
        a = "http://" + a
    host = a.split("://", 1)[1]
    if ":" not in host.split("/")[0] and a.startswith("http://"):
        a += ":8100"
    return a


# --- the connection ------------------------------------------------------------------------

class Server:
    def __init__(self, url, token=""):
        self.url = url.rstrip("/")
        self.token = token

    def call(self, path, body=None, timeout=20):
        headers = {"Content-Type": "application/json", "User-Agent": "KorieKodi"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode("utf-8")).get("error") or e.reason
            except ValueError:
                msg = e.reason
            raise KorieError(str(msg), e.code)
        except (urllib.error.URLError, socket.timeout, OSError) as e:
            log("%s%s: %s" % (self.url, path, getattr(e, "reason", e)))
            raise KorieError("The Korie server (%s) can't be reached. Is it on?" % self.url.split("://")[-1])

    def get(self, path, **query):
        q = urllib.parse.urlencode({k: v for k, v in query.items() if v not in (None, "")})
        return self.call(path + ("?" + q if q else ""))

    def absolute(self, u):
        """Picture and media addresses from the server are relative to it."""
        if not u:
            return ""
        return self.url + u if u.startswith("/") else u


# --- getting connected: server, then profile ---------------------------------------------

def repository_server():
    """The server Korie was installed from: the Korie repository add-on points at it."""
    try:
        with open(xbmcvfs.translatePath("special://home/addons/repository.korie/addon.xml"), encoding="utf-8") as f:
            xml = f.read()
    except OSError:
        return ""
    import re
    m = re.search(r"<info[^>]*>(https?://[^<]+?)/kodi/repo/addons\.xml</info>", xml)
    return m.group(1) if m else ""


def choose_server(state, force=False):
    """The server to use: the one in settings, the remembered one, the one Korie was installed
    from, or one found on the network."""
    typed = normalise(ADDON.getSetting("server"))
    if typed and not force:
        return typed
    if state.get("server") and not force:
        return state["server"]
    if not force:
        repo = repository_server()
        if repo:
            try:
                Server(repo).call("/api/hello", timeout=5)
                return repo
            except KorieError as e:
                log("the server Korie came from doesn't answer: %s" % e)
    progress = xbmcgui.DialogProgress()
    progress.create("Korie", "Looking for your Korie server…")
    try:
        servers = discover()
    finally:
        progress.close()
    if len(servers) == 1:
        return servers[0]["url"]
    if len(servers) > 1:
        names = ["%s  (%s)" % (s["name"], s["url"].split("://")[1]) for s in servers]
        i = xbmcgui.Dialog().select("Which Korie server?", names)
        if i < 0:
            return ""
        return servers[i]["url"]
    address = xbmcgui.Dialog().input("No Korie server found. Type its address (e.g. 192.168.1.10)")
    return normalise(address)


def choose_profile(server):
    """Picks a profile and signs in; returns the token or ''."""
    people = server.call("/api/people")
    if not people:
        raise KorieError("This server has no profiles.")
    if len(people) == 1 and not people[0].get("hasPin"):
        person = people[0]
    else:
        items = []
        for p in people:
            li = xbmcgui.ListItem(p["name"], "PIN" if p.get("hasPin") else "")
            items.append(li)
        i = xbmcgui.Dialog().select("Who's watching?", items, useDetails=False)
        if i < 0:
            return "", None
        person = people[i]
    body = {"person": person["id"], "device": "Kodi on " + (xbmc.getInfoLabel("System.FriendlyName") or "this device")}
    if person.get("hasPin"):
        pin = xbmcgui.Dialog().numeric(0, "PIN for %s" % person["name"], "", True)
        if not pin:
            return "", None
        body["pin"] = pin
    while True:
        try:
            r = server.call("/api/login", body)
            return r["token"], person
        except KorieError as e:
            if e.status == 401 and "password" in str(e).lower():
                pw = xbmcgui.Dialog().input(str(e), option=xbmcgui.ALPHANUM_HIDE_INPUT)
                if not pw:
                    return "", None
                body["password"] = pw
                continue
            raise


def server_only(force=False):
    """The server, without signing in (for "Who's watching?"). None when the person cancelled."""
    state = load_state()
    url = choose_server(state, force)
    if not url:
        return None
    if url != state.get("server"):
        state = {k: v for k, v in state.items() if k in ("skin_applied", "kodi_setup", "theme")}
        state["server"] = url
        save_state(state)
    return Server(url, state.get("token", ""))


def sign_in(server, person):
    """Signs in as a person, asking for their PIN (or password) when they have one."""
    body = {"person": person["id"], "device": "Kodi on " + (xbmc.getInfoLabel("System.FriendlyName") or "this device")}
    got = {}

    def attempt(pin=None):
        """None when signed in (or the server wants a password next); else what to tell the person."""
        if pin:
            body["pin"] = pin
        try:
            got["r"] = server.call("/api/login", body)
            return None
        except KorieError as e:
            if e.status == 401 and "password" in str(e).lower():
                got["password"] = str(e)
                return None
            if e.status in (401, 403):
                return str(e)
            raise

    if person.get("hasPin"):
        from resources.lib import screens
        if not screens.pin(person, attempt):
            return False
    else:
        error = attempt()
        if error:
            xbmcgui.Dialog().notification("Korie", error, xbmcgui.NOTIFICATION_WARNING, 4000)
            return False
    while "r" not in got:
        pw = xbmcgui.Dialog().input(got.get("password", "Password"), option=xbmcgui.ALPHANUM_HIDE_INPUT)
        if not pw:
            return False
        body["password"] = pw
        got.pop("password", None)
        error = attempt()
        if error:
            xbmcgui.Dialog().notification("Korie", error, xbmcgui.NOTIFICATION_WARNING, 4000)
    r = got["r"]
    server.token = r["token"]
    state = load_state()
    state.update({"server": server.url, "token": r["token"], "person": person["id"], "name": person["name"], "color": person.get("color", "")})
    save_state(state)
    ADDON.setSetting("profile_name", person["name"])
    return True


def connect(force_server=False, force_profile=False):
    """A signed-in Server, asking only what it has to. None when the person cancelled."""
    state = load_state()
    url = choose_server(state, force_server)
    if not url:
        return None
    if url != state.get("server"):
        state = {"server": url}
    server = Server(url, "" if force_profile else state.get("token", ""))
    if server.token:
        try:
            server.call("/api/me")
            return server
        except KorieError as e:
            if e.status != 401:
                raise
            server.token = ""
    token, person = choose_profile(server)
    if not token:
        return None
    server.token = token
    state.update({"server": url, "token": token, "person": person["id"], "name": person["name"]})
    save_state(state)
    ADDON.setSetting("profile_name", person["name"])
    return server
