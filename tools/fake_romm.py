# A stand-in RomM server for testing the RomM add-on (same API shapes as RomM 3.x/4.x).
import base64, json, http.server, urllib.parse, sys, io
from PIL import Image, ImageDraw
PLATS = [{"id": 1, "name": "Super Nintendo", "display_name": "Super Nintendo", "slug": "snes", "rom_count": 3},
         {"id": 2, "name": "Game Boy Advance", "display_name": "Game Boy Advance", "slug": "gba", "rom_count": 2},
         {"id": 3, "name": "Empty", "slug": "x", "rom_count": 0}]
ROMS = [
 {"id": 11, "platform_id": 1, "name": "Space Rangers", "platform_display_name": "Super Nintendo", "summary": "Fly through twelve sectors and rescue the fleet.", "path_cover_large": "/assets/romm/resources/roms/1/11/cover/big.png", "metadatum": {"first_release_date": 744336000000, "genres": ["Shooter"]}, "last_played": "2026-11-10"},
 {"id": 12, "platform_id": 1, "name": "Kart Champions", "platform_display_name": "Super Nintendo", "summary": "Racing.", "path_cover_large": "/assets/romm/resources/roms/1/12/cover/big.png", "metadatum": {"first_release_date": 715000000000, "genres": ["Racing"]}},
 {"id": 13, "platform_id": 1, "name": "Puzzle Tower", "platform_display_name": "Super Nintendo", "summary": "", "url_cover": "", "metadatum": {}},
 {"id": 21, "platform_id": 2, "name": "Pocket Quest", "platform_display_name": "Game Boy Advance", "summary": "An adventure.", "path_cover_large": "/assets/romm/resources/roms/2/21/cover/big.png", "metadatum": {"first_release_date": 1020000000000}},
 {"id": 22, "platform_id": 2, "name": "Tiny Golf", "platform_display_name": "Game Boy Advance", "path_cover_small": "/assets/romm/resources/roms/2/22/cover/small.png"},
]
GOOD = "Basic " + base64.b64encode(b"admin:secret pw").decode()
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): sys.stderr.write(self.command + " " + self.path + " auth=" + str(self.headers.get("Authorization")) + "\n")
    def send(self, code, body, ctype="application/json"):
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path.startswith("/assets/"):
            rid = u.path.split("/")[5]
            im = Image.new("RGB", (264, 352), (40 + int(rid) * 7 % 200, 60, 140)); d = ImageDraw.Draw(im); d.text((20, 160), "ROM " + rid, fill="white")
            b = io.BytesIO(); im.save(b, "PNG"); return self.send(200, b.getvalue(), "image/png")
        if u.path.startswith("/rom/"):
            return self.send(200, b"<html><body style='background:#123;color:#fff;font:40px sans-serif'>RomM player for " + u.path.encode() + b"</body></html>", "text/html")
        if u.path.startswith("/api/") and self.headers.get("Authorization") != GOOD:
            return self.send(401, b'{"detail":"Not authenticated"}')
        if u.path == "/api/platforms":
            return self.send(200, json.dumps(PLATS).encode())
        if u.path == "/api/roms":
            r = ROMS
            pid = q.get("platform_ids", q.get("platform_id", [None]))[0]
            if pid: r = [x for x in r if str(x["platform_id"]) == pid]
            if q.get("last_played"): r = [x for x in r if x.get("last_played")]
            if q.get("search_term"): r = [x for x in r if q["search_term"][0].lower() in x["name"].lower()]
            if q.get("order_by") == ["id"]: r = sorted(r, key=lambda x: -x["id"])
            return self.send(200, json.dumps({"items": r, "total": len(r)}).encode())
        self.send(404, b"{}")
http.server.ThreadingHTTPServer(("127.0.0.1", 8090), H).serve_forever()
