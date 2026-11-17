#!/usr/bin/env python3
"""Drives the real Jellyfin Android TV app in the emulator with remote-control keys only, and after
every press writes down which element has focus (from Android's own accessibility tree, not from
looking at pictures). Usage: atv.py <outdir> <step> [<step> ...] where a step is a key name
(UP DOWN LEFT RIGHT OK BACK HOME; "!KEY" presses it without waiting or reading the focus), "text:<words>", "wait:<seconds>", or "shot:<name>"."""
import os, re, subprocess, sys, time

ADB = os.environ.get("ADB", "adb")
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
KEYS = {"UP": 19, "DOWN": 20, "LEFT": 21, "RIGHT": 22, "OK": 23, "BACK": 4, "HOME": 3, "ENTER": 66, "PLAY": 85}
logf = open(os.path.join(OUT, "focus.log"), "a")


def sh(*a, **k):
    return subprocess.run([ADB, *a], capture_output=True, text=k.get("text", True), timeout=180)


def focus():
    """The focused element: its text (or the texts inside it), id and class, from uiautomator."""
    for _ in range(3):
        r = sh("exec-out", "uiautomator", "dump", "/dev/tty")
        x = r.stdout
        if "<hierarchy" in x:
            break
        time.sleep(2)
    nodes = re.findall(r"<node [^>]*>", x)
    # the deepest focused node, and the texts of the nodes nested in it
    idx = [i for i, n in enumerate(nodes) if 'focused="true"' in n]
    if not idx:
        return "(nothing focused)"
    n = nodes[idx[-1]]
    text = re.search(r'text="([^"]*)"', n).group(1)
    desc = re.search(r'content-desc="([^"]*)"', n).group(1)
    rid = re.search(r'resource-id="([^"]*)"', n).group(1).split("/")[-1]
    cls = re.search(r'class="([^"]*)"', n).group(1).split(".")[-1]
    bounds = re.search(r'bounds="([^"]*)"', n).group(1)
    inner = []
    if not text:
        # texts of the children: the xml is nested, so take the nodes after it until depth returns
        start = x.find(n)
        depth, j = 0, start
        seg = x[start:]
        for m in re.finditer(r"<node [^>]*?(/?)>|</node>", seg):
            if m.group(0).startswith("</"):
                depth -= 1
            elif m.group(1) != "/":
                depth += 1
            t = re.search(r'text="([^"]+)"', m.group(0))
            if t and m.start() > 0:
                inner.append(t.group(1))
            if depth <= 0 and m.start() > 0:
                break
    label = text or desc or " / ".join(inner[:3])
    return f'"{label}" [{cls}{"#" + rid if rid else ""} {bounds}]'


def note(s):
    print(s, flush=True)
    logf.write(s + "\n")
    logf.flush()


shots = len([f for f in os.listdir(OUT) if f.endswith(".png")])
for step in sys.argv[2:]:
    if step.startswith("wait:"):
        time.sleep(float(step[5:]))
        continue
    if step.startswith("shot:"):
        shots += 1
        png = sh("exec-out", "screencap", "-p", text=False).stdout
        open(os.path.join(OUT, f"{shots:02d}_{step[5:]}.png"), "wb").write(png)
        note(f"  [screenshot {shots:02d}_{step[5:]}]")
        continue
    if step == "CLEAR":
        sh("shell", "input", "keyevent", "123")
        for _ in range(4):
            sh("shell", "input", "keyevent", *(["67"] * 10))
        time.sleep(2)
        continue
    if step.startswith("slow:"):
        for ch in step[5:]:
            sh("shell", "input", "text", ch)
            time.sleep(1.2)
        time.sleep(2)
        note(f"typed {step[5:]!r:<24} -> focus {focus()}")
        continue
    if step.startswith("text:"):
        sh("shell", "input", "text", step[5:].replace(" ", "%s"))
        time.sleep(2)
        note(f"typed {step[5:]!r:<24} -> focus {focus()}")
        continue
    if step.startswith("!"):
        # quick: press and move on, no focus dump (for things that hide again, like a player's controls)
        sh("shell", "input", "keyevent", str(KEYS[step[1:]]))
        time.sleep(0.6)
        note(f"{step:<6} (quick)")
        continue
    t0 = time.time()
    sh("shell", "input", "keyevent", str(KEYS[step]))
    time.sleep(2.5)
    note(f"{step:<6} -> focus {focus()}")
