#!/usr/bin/env python3
"""Adds the big test folders to a server and measures, through the Jellyfin API (what the apps see),
how long until all 1000 films and 1000 episodes are listed, and until one can be opened to play.
speed.py korie|jellyfin"""
import json, os, sys, time, urllib.request

which = sys.argv[1]
AUTH = 'MediaBrowser Client="speedtest", Device="cli", DeviceId="speed", Version="1"'


def call(base, method, path, body=None, token=None, extra=None):
    h = {"Authorization": AUTH + (f', Token="{token}"' if token else ""), "Accept": "application/json", "Content-Type": "application/json"}
    h.update(extra or {})
    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=120) as r:
        b = r.read()
        return json.loads(b) if b else None


if which == "korie":
    base, user, pw = "http://localhost:8100", "Admin", ""
else:
    base, user, pw = "http://localhost:8096", "admin", "test"
a = call(base, "POST", "/Users/AuthenticateByName", {"Username": user, "Pw": pw})
tok = a["AccessToken"]

t0 = time.time()
if which == "korie":
    kt = os.environ["KORIE_TOKEN"]  # a Korie admin session (POST /api/login)
    for path, kind in [(os.environ.get("BIG", "big") + "/Films", "films"), (os.environ.get("BIG", "big") + "/Series", "series")]:
        call(base, "POST", "/api/folders", {"path": path, "kind": kind}, extra={"Authorization": "Bearer " + kt})
else:
    call(base, "POST", "/Library/VirtualFolders?name=BigFilms&collectionType=movies&refreshLibrary=false", {"LibraryOptions": {"PathInfos": [{"Path": os.environ.get("BIG", "big") + "/Films"}]}}, tok)
    call(base, "POST", "/Library/VirtualFolders?name=BigSeries&collectionType=tvshows&refreshLibrary=true", {"LibraryOptions": {"PathInfos": [{"Path": os.environ.get("BIG", "big") + "/Series"}]}}, tok)

seen = {}
while True:
    el = time.time() - t0
    q = call(base, "GET", "/Items?recursive=true&includeItemTypes=Movie&searchTerm=Test%20Film&limit=1", token=tok)
    e = call(base, "GET", "/Items?recursive=true&includeItemTypes=Episode&limit=1&searchTerm=", token=tok)
    films = q["TotalRecordCount"]
    eps = call(base, "GET", "/Items?recursive=true&includeItemTypes=Series&searchTerm=Test%20Show&limit=1", token=tok)["TotalRecordCount"]
    for name, n, goal in [("first film listed", films, 1), ("all 1000 films listed", films, 1000), ("first series listed", eps, 1), ("all 50 series listed", eps, 50)]:
        if n >= goal and name not in seen:
            seen[name] = el
            print(f"{el:7.1f} s  {name}", flush=True)
    if len(seen) == 4:
        break
    if el > 3600:
        print(f"stopped after an hour: {films} films, {eps} series listed")
        break
    time.sleep(1)
# opening a film right after (the file is looked into now, on Korie)
films = call(base, "GET", "/Items?recursive=true&includeItemTypes=Movie&searchTerm=Test%20Film%200500&limit=1", token=tok)["Items"]
t1 = time.time()
pi = call(base, "POST", f"/Items/{films[0]['Id']}/PlaybackInfo", {"DeviceProfile": {"DirectPlayProfiles": [{"Type": "Video", "Container": "mkv,mp4", "VideoCodec": "h264", "AudioCodec": "aac"}]}}, tok)
print(f"opening a film to play: {1000*(time.time()-t1):.0f} ms (streams known: {len(pi['MediaSources'][0].get('MediaStreams') or [])}, direct play: {pi['MediaSources'][0]['SupportsDirectPlay']})")
