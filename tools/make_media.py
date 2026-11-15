#!/usr/bin/env python3
"""Makes the Korie skin's own pictures: menu icons and the rounded shapes the screens are built
from. White on transparent, so the skin colours them with the theme's colours.

    python3 tools/make_media.py          (needs rsvg-convert and Pillow)

Writes kodi/skin-src/media/korie/. Run it again after changing an icon here.
"""
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "kodi" / "skin-src" / "media" / "korie"
OUT.mkdir(parents=True, exist_ok=True)

STROKE = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">%s</svg>'
FILLED = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="#fff">%s</svg>'

ICONS = {
    "home": (STROKE, '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
    "films": (STROKE, '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
    "series": (STROKE, '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 2l4 4 4-4"/>'),
    "live": (STROKE, '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 2l4 5 4-5"/><circle cx="12" cy="13.5" r="2.2"/>'),
    "music": (STROKE, '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
    "addons": (STROKE, '<path d="M10 3h4v3a2 2 0 1 0 4 0V3h3v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3v-7h3a2 2 0 1 0 0-4H3V3h7z"/>'),
    "search": (STROKE, '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
    "settings": (STROKE, '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    "lock": (STROKE, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    "plus": (STROKE, '<path d="M12 5v14M5 12h14"/>'),
    "back": (STROKE, '<path d="M15 18l-6-6 6-6"/>'),
    "check": (STROKE, '<path d="M5 12l5 5 9-10"/>'),
    "person": (STROKE, '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
    "server": (STROKE, '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
    "palette": (STROKE, '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2.5a2.5 2.5 0 0 0 2.5-2.5"/>'),
    "info": (STROKE, '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'),
    "play": (FILLED, '<path d="M7 4.5v15l13-7.5z"/>'),
    "audio": (STROKE, '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>'),
    "subtitles": (STROKE, '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15h4M13 15h4M7 11h10"/>'),
    "pause": (FILLED, '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>'),
    "back10": (STROKE, '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
    "forward10": (STROKE, '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>'),
    "chapters": (STROKE, '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>'),
    "tune": (STROKE, '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>'),
    "erase": (STROKE, '<path d="M21 5H9l-7 7 7 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-6 6M11 9l6 6"/>'),
    "stop": (FILLED, '<rect x="5" y="5" width="14" height="14" rx="2"/>'),
}

for name, (frame, body) in ICONS.items():
    svg = frame % body
    png = subprocess.run(["rsvg-convert", "-w", "96", "-h", "96"], input=svg.encode(), capture_output=True, check=True).stdout
    (OUT / ("icon-%s.png" % name)).write_bytes(png)

SCALE = 4  # draw big, shrink: smooth edges


def rounded(name, w, h, r, outline=0):
    big = Image.new("RGBA", (w * SCALE, h * SCALE), (255, 255, 255, 0))
    d = ImageDraw.Draw(big)
    box = (0, 0, w * SCALE - 1, h * SCALE - 1)
    if outline:
        d.rounded_rectangle(box, radius=r * SCALE, outline=(255, 255, 255, 255), width=outline * SCALE)
    else:
        d.rounded_rectangle(box, radius=r * SCALE, fill=(255, 255, 255, 255))
    big.resize((w, h), Image.LANCZOS).save(OUT / name)


# Shapes drawn with a <texture border="..."> so they stretch to any size without bending the corners
rounded("r10.png", 64, 64, 10)
rounded("r12.png", 64, 64, 12)
rounded("r16.png", 64, 64, 16)
rounded("r18.png", 64, 64, 18)
rounded("r28.png", 96, 96, 28)
rounded("pill.png", 128, 128, 64)
rounded("pill84.png", 200, 84, 42)  # buttons 84 high: stretch only the middle (border="42,0,42,0")
rounded("pill72.png", 200, 72, 36)  # the player's buttons: border="36,0,36,0"
rounded("ring28.png", 96, 96, 28, outline=3)
rounded("ring-circle.png", 64, 64, 32, outline=4)
# Masks for pictures (a diffuse texture is stretched to the picture, so one per shape of picture)
rounded("mask-poster.png", 180, 270, 10)
rounded("mask-wide.png", 420, 236, 12)
rounded("mask-square.png", 220, 220, 12)
rounded("mask-circle.png", 128, 128, 64)

# Fades for text over pictures
for name, horizontal in (("fade-left.png", True), ("fade-up.png", False)):
    size = 256
    img = Image.new("RGBA", (size, 4) if horizontal else (4, size))
    for i in range(size):
        a = int(255 * (1 - i / (size - 1)))
        for j in range(4):
            img.putpixel((i, j) if horizontal else (j, i), (255, 255, 255, a))
    img.save(OUT / name)

print("made", OUT)

# The player's progress bar: a round marker (drawn by Kodi's slider at its own size, so the
# slider's bar is a clear picture just as tall), and a chapter mark.
rounded("nub.png", 30, 30, 15)
rounded("nub-big.png", 40, 40, 20)
Image.new("RGBA", (8, 30), (255, 255, 255, 0)).save(OUT / "clear30.png")
Image.new("RGBA", (8, 40), (255, 255, 255, 0)).save(OUT / "clear40.png")
Image.new("RGBA", (3, 18), (255, 255, 255, 255)).save(OUT / "tick.png")
Image.new("RGBA", (8, 18), (255, 255, 255, 0)).save(OUT / "clear18.png")  # the chapter marks' bar: Kodi sizes marks by its height
print("made player pictures")
