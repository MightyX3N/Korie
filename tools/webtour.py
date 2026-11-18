#!/usr/bin/env python3
"""Visits pages of Korie's web client signed in, screenshots each and reports problems.

usage: webtour.py WIDTHxHEIGHT path [path ...]   (paths under /web, like /films or /admin/people)
Signs in as the first admin (no PIN) through the API, like a person would through Who's watching.
"""
import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8100"
size = tuple(int(x) for x in sys.argv[1].split("x"))
paths = sys.argv[2:]
people = json.load(urllib.request.urlopen(BASE + "/api/people"))
admin = next(p for p in people if p["admin"])
req = urllib.request.Request(BASE + "/api/login", data=json.dumps({"person": admin["id"], "device": "Korie in Chrome (test)", "deviceId": "webtour0000test"}).encode(), headers={"Content-Type": "application/json"})
token = json.load(urllib.request.urlopen(req))["token"]

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": size[0], "height": size[1]})
    ctx.add_init_script(f"localStorage.setItem('korie.token', {json.dumps(token)})")
    pg = ctx.new_page()
    problems = []
    pg.on("console", lambda m: m.type == "error" and problems.append(f"console: {m.text[:200]}"))
    pg.on("pageerror", lambda e: problems.append(f"PAGE ERROR: {e}"))
    pg.on("response", lambda r: ("/api/" in r.url and r.status >= 400) and problems.append(f"HTTP {r.status} {r.url.split('8100')[-1][:100]}"))
    for path in paths:
        problems.clear()
        pg.goto(BASE + "/web" + path)
        pg.wait_for_timeout(1800)
        name = (path.strip("/").replace("/", "_").replace("?", "_").replace("=", "-") or "home") + f"_{size[0]}"
        pg.screenshot(path=f"/tmp/tour_{name}.png", full_page=False)
        over = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
        print(f"{path}: {'OK' if not problems else ''}{' SIDEWAYS SCROLL' if over else ''} -> /tmp/tour_{name}.png")
        for x in problems:
            print("   ", x)
    b.close()
