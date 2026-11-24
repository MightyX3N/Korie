#!/usr/bin/env python3
"""A stand-in for a Jellyfin server, for testing the Jellyfin add-on where a real server cannot run.
It answers the requests the add-on makes, in the shapes of Jellyfin's API description
(jellyfin-openapi-12.4.json), with two films and one series, and prints what it is told.

    python3 tools/jellyfin-test/standin.py <video.mp4> <picture.jpg> [port]

Users: Alice (no password), Bob (password "pw"). Quick Connect signs in as Bob the second time
the code is checked. It is not Jellyfin: passing here does not prove the add-on works with a real server.
"""
import json, os, re, sys, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

VIDEO, PICTURE = sys.argv[1], sys.argv[2]
PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 8096
TICKS = 10_000_000
RUNTIME = 1200 * TICKS
USERS = {"u-alice": {"Name": "Alice", "pw": ""}, "u-bob": {"Name": "Bob", "pw": "pw"}}
TOKENS = {}      # token -> user id
POSITION = {}    # (user, item) -> ticks
PLAYED = set()   # (user, item)
QC = {}          # secret -> number of checks

def movie(i, name, year):
    return {"Id": i, "Name": name, "Type": "Movie", "ProductionYear": year, "Overview": name + " overview.", "Genres": ["Drama", "Test"],
            "CommunityRating": 7.5, "RunTimeTicks": RUNTIME, "ImageTags": {"Primary": "p" + i}, "BackdropImageTags": ["b" + i], "ProviderIds": {"Tmdb": str(1000 + len(i))}}
MOVIES = [movie("m1", "Fixture Film", 2019), movie("m22", "Second Film", 2021)]
SERIES = {"Id": "s1", "Name": "Fixture Show", "Type": "Series", "ProductionYear": 2020, "Overview": "A series on the stand-in server.", "Genres": ["Comedy"],
          "ImageTags": {"Primary": "ps1"}, "BackdropImageTags": ["bs1"], "ProviderIds": {"Tmdb": "2000"}}
SEASONS = [{"Id": "se1", "Name": "Season 1", "Type": "Season"}, {"Id": "se2", "Name": "Season 2", "Type": "Season"}]
def episode(i, season, n, name):
    return {"Id": i, "Name": name, "Type": "Episode", "SeriesName": "Fixture Show", "SeasonId": "se%d" % season, "IndexNumber": n, "ParentIndexNumber": season,
            "Overview": name + " overview.", "RunTimeTicks": RUNTIME, "ImageTags": {"Primary": "p" + i}, "ParentBackdropItemId": "s1", "ParentBackdropImageTags": ["bs1"]}
EPISODES = [episode("e11", 1, 1, "Pilot"), episode("e12", 1, 2, "Second"), episode("e13", 1, 3, "Third"), episode("e21", 2, 1, "Return")]
BY_ID = {x["Id"]: x for x in MOVIES + [SERIES] + EPISODES}

def with_user(item, user):
    out = dict(item)
    pos = POSITION.get((user, item["Id"]), 0)
    out["UserData"] = {"PlaybackPositionTicks": pos, "PlayedPercentage": 100.0 * pos / RUNTIME, "Played": (user, item["Id"]) in PLAYED}
    return out

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def say(self, *a): print(*a, flush=True)
    def token(self):
        m = re.search(r'Token="([^"]*)"', self.headers.get("Authorization", ""))
        return m.group(1) if m else None
    def user(self):
        return TOKENS.get(self.token())
    def send(self, code, obj=None):
        data = b"" if obj is None else json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def file(self, path, mime):
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        if m:
            start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else end
            self.send_response(206); self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        else:
            self.send_response(200)
        self.send_header("Content-Type", mime); self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(end - start + 1)); self.end_headers()
        try:
            with open(path, "rb") as f:
                f.seek(start); left = end - start + 1
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk: break
                    self.wfile.write(chunk); left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}
    def sign_in(self, uid):
        t = uuid.uuid4().hex; TOKENS[t] = uid
        self.say("SIGNED IN", USERS[uid]["Name"], "device", re.search(r'DeviceId="([^"]*)"', self.headers.get("Authorization", "")).group(1))
        self.send(200, {"AccessToken": t, "ServerId": "srv1", "User": {"Id": uid, "Name": USERS[uid]["Name"]}})

    def do_GET(self):
        u = urlparse(self.path); p = u.path; q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if p == "/System/Info/Public": return self.send(200, {"Id": "srv1", "ServerName": "Stand-in Jellyfin", "Version": "12.4.0"})
        if p == "/Users/Public": return self.send(200, [{"Id": i, "Name": x["Name"], "HasPassword": x["pw"] != ""} for i, x in USERS.items()])
        if p == "/QuickConnect/Enabled": return self.send(200, True)
        if p == "/QuickConnect/Connect":
            if q.get("secret") not in QC: return self.send(404)
            QC[q["secret"]] += 1
            return self.send(200, {"Authenticated": QC[q["secret"]] >= 2, "Secret": q["secret"], "Code": "123456"})
        m = re.match(r"/Items/([^/]+)/Images/", p)
        if m: return self.file(PICTURE, "image/jpeg")
        m = re.match(r"/Videos/([^/]+)/stream", p)
        if m:
            if not self.user(): self.say("STREAM WITHOUT TOKEN"); return self.send(401)
            if "Range" not in self.headers or self.headers["Range"].startswith("bytes=0-"): self.say("STREAM", m.group(1), "static=" + q.get("static", ""), "source=" + q.get("mediaSourceId", ""))
            return self.file(VIDEO, "video/mp4")
        user = self.user()
        if not user: return self.send(401)
        if q.get("userId") not in (None, user): return self.send(403)
        if p == "/Items":
            items = [with_user(x, user) for x in MOVIES + [SERIES]]
            s = int(q.get("startIndex", 0)); n = int(q.get("limit", 100))
            return self.send(200, {"Items": items[s:s + n], "TotalRecordCount": len(items), "StartIndex": s})
        if p == "/UserItems/Resume":
            items = [with_user(BY_ID[i], user) for (uu, i), pos in POSITION.items() if uu == user and pos > 0 and (uu, i) not in PLAYED]
            return self.send(200, {"Items": items, "TotalRecordCount": len(items)})
        if p == "/Shows/NextUp": return self.send(200, {"Items": [], "TotalRecordCount": 0})
        m = re.match(r"/Shows/([^/]+)/Seasons", p)
        if m: return self.send(200, {"Items": SEASONS, "TotalRecordCount": 2})
        m = re.match(r"/Shows/([^/]+)/Episodes", p)
        if m:
            eps = [with_user(e, user) for e in EPISODES if e["SeasonId"] == q.get("seasonId")]
            return self.send(200, {"Items": eps, "TotalRecordCount": len(eps)})
        m = re.match(r"/Items/([^/]+)$", p)
        if m and m.group(1) in BY_ID: return self.send(200, with_user(BY_ID[m.group(1)], user))
        self.say("UNKNOWN GET", p); self.send(404)

    def do_POST(self):
        u = urlparse(self.path); p = u.path
        b = self.body()
        if p == "/Users/AuthenticateByName":
            for i, x in USERS.items():
                if x["Name"].lower() == str(b.get("Username", "")).lower() and x["pw"] == b.get("Pw", ""): return self.sign_in(i)
            return self.send(401)
        if p == "/QuickConnect/Initiate":
            s = uuid.uuid4().hex; QC[s] = 0
            return self.send(200, {"Authenticated": False, "Secret": s, "Code": "123456"})
        if p == "/Users/AuthenticateWithQuickConnect":
            if QC.get(b.get("Secret"), 0) >= 2: return self.sign_in("u-bob")
            return self.send(401)
        user = self.user()
        if not user: return self.send(401)
        m = re.match(r"/Items/([^/]+)/PlaybackInfo", p)
        if m:
            direct = b.get("EnableDirectPlay", True)
            self.say("PLAYBACKINFO", m.group(1), "profile" if isinstance(b.get("DeviceProfile"), dict) else "NO PROFILE", "direct" if direct else "convert")
            return self.send(200, {"PlaySessionId": uuid.uuid4().hex, "MediaSources": [{"Id": m.group(1), "SupportsDirectPlay": direct, "SupportsDirectStream": direct, "SupportsTranscoding": True}]})
        if p in ("/Sessions/Playing", "/Sessions/Playing/Progress", "/Sessions/Playing/Stopped"):
            pos = b.get("PositionTicks")
            if not isinstance(pos, int): self.say("BAD PositionTicks", repr(pos)); return self.send(400)
            item = b.get("ItemId")
            if pos >= RUNTIME * 0.9: PLAYED.add((user, item)); POSITION[(user, item)] = 0
            else: POSITION[(user, item)] = pos
            self.say(p.split("/")[-1].upper(), USERS[user]["Name"], item, "%d s" % (pos // TICKS), "paused" if b.get("IsPaused") else "", b.get("PlayMethod", ""), "session" if b.get("PlaySessionId") else "NO SESSION")
            return self.send(204)
        if p == "/Sessions/Logout":
            TOKENS.pop(self.token(), None); self.say("SIGNED OUT", USERS[user]["Name"]); return self.send(204)
        self.say("UNKNOWN POST", p); self.send(404)

print("stand-in Jellyfin on port", PORT, flush=True)
ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()
