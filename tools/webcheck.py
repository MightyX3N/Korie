#!/usr/bin/env python3
"""Drives Korie's web client in Chrome like a person with a keyboard or mouse.

usage: webcheck.py URL step [step ...]
steps:  KEY (ArrowDown, Enter, Escape, Backspace ...), text:abc, click:css,
        clicktext:Visible text, wait:ms, shot:name, goto:/path, w:WIDTHxHEIGHT
Every console error, page error and failed /api request is printed.
"""
import sys, json, os, urllib.request
from playwright.sync_api import sync_playwright

def admin_token(base):
    people = json.load(urllib.request.urlopen(base + "/api/people"))
    a = next(p for p in people if p["admin"])
    req = urllib.request.Request(base + "/api/login", data=json.dumps({"person": a["id"], "device": "Korie in Chrome (test)", "deviceId": "webcheck000test"}).encode(), headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))["token"]

url, steps = sys.argv[1], sys.argv[2:]
size = (1600, 900)
for s in steps:
    if s.startswith("w:"):
        a, b = s[2:].split("x"); size = (int(a), int(b))
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": size[0], "height": size[1]})
    if os.environ.get("SIGNED"):
        ctx.add_init_script(f"localStorage.setItem('korie.token', {json.dumps(admin_token('http://localhost:8100'))})")
    pg = ctx.new_page()
    pg.on("console", lambda m: m.type in ("error", "warning") and print(f"  console.{m.type}: {m.text[:300]}"))
    pg.on("pageerror", lambda e: print(f"  PAGE ERROR: {e}"))
    pg.on("response", lambda r: ("/api/" in r.url and r.status >= 400) and print(f"  HTTP {r.status} {r.request.method} {r.url.split('8100')[-1][:120]}"))
    pg.goto(url); pg.wait_for_timeout(1500)
    for s in steps:
        if s.startswith("w:"): continue
        if s.startswith("wait:"): pg.wait_for_timeout(int(s[5:]))
        elif s.startswith("shot:"):
            pg.screenshot(path=f"/tmp/web_{s[5:]}.png"); print(f"shot {s[5:]}")
        elif s.startswith("text:"): pg.keyboard.type(s[5:])
        elif s.startswith("click:"): pg.click(s[6:], timeout=4000)
        elif s.startswith("clicktext:"): pg.get_by_text(s[10:], exact=True).first.click(timeout=4000)
        elif s.startswith("goto:"): pg.goto(url.rstrip("/") + s[5:]); pg.wait_for_timeout(1200)
        elif s.startswith("eval:"): print("  =", pg.evaluate(s[5:]))
        elif s.startswith("mouse:"):
            x, y = s[6:].split(","); pg.mouse.move(int(x), int(y)); pg.mouse.move(int(x) + 5, int(y) + 5)
        elif s.startswith("select:"):
            sel, val = s[7:].split("=", 1); pg.select_option(sel, val); pg.wait_for_timeout(200)
        elif s.startswith("fill:"):
            sel, val = s[5:].split("=", 1); pg.fill(sel, val)
        elif s.startswith("label:"): pg.get_by_label(s[6:], exact=True).first.click(timeout=4000)
        elif s.startswith("role:"):
            r, n = s[5:].split("=", 1); pg.get_by_role(r, name=n).first.click(timeout=4000)
        else:
            pg.keyboard.press(s); pg.wait_for_timeout(350)
    foc = pg.evaluate("(()=>{const e=document.activeElement;return e?(e.className+' | '+(e.innerText||'').slice(0,60)):''})()")
    print("focus:", foc.replace("\n", " "))
    b.close()
