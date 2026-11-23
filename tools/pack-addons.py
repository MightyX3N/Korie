#!/usr/bin/env python3
"""Packs every add-on folder in addons/ into addons/dist/<id>.korie and writes addons/index.json,
the list Settings → Add-ons in Korie reads. Run it after changing an add-on, then commit both.

    python3 tools/pack-addons.py [folder]

A .korie file is the add-on's folder zipped. File times inside are fixed, so packing the same
files twice gives the same bytes.
"""
import json
import os
import sys
import zipfile

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "addons")
DIST = os.path.join(ROOT, "dist")
KNOWN_USES = ["internet", "apps"]


def main():
    os.makedirs(DIST, exist_ok=True)
    index = []
    for name in sorted(os.listdir(ROOT)):
        folder = os.path.join(ROOT, name)
        manifest = os.path.join(folder, "addon.json")
        if name == "dist" or not os.path.isfile(manifest):
            continue
        with open(manifest, encoding="utf-8") as f:
            m = json.load(f)
        if m.get("id") != name:
            sys.exit(f"{name}: the folder name must be the add-on's id ({m.get('id')!r})")
        if not os.path.isfile(os.path.join(folder, m.get("main", "main.lua"))):
            sys.exit(f"{name}: {m.get('main', 'main.lua')} is missing")
        unknown = [u for u in m.get("uses", []) if u not in KNOWN_USES]
        if unknown:
            sys.exit(f"{name}: unknown entries under uses: {unknown} (known: {KNOWN_USES})")
        out = os.path.join(DIST, name + ".korie")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            for base, dirs, files in os.walk(folder):
                dirs.sort()
                for fn in sorted(files):
                    if fn.startswith("."):
                        continue
                    path = os.path.join(base, fn)
                    info = zipfile.ZipInfo(os.path.relpath(path, folder).replace(os.sep, "/"), (2020, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    with open(path, "rb") as f:
                        z.writestr(info, f.read())
        index.append({
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "version": str(m.get("version", "1.0")),
            "author": m.get("author", ""),
            "description": m.get("description", ""),
            "uses": m.get("uses", []),
            "file": "dist/" + name + ".korie",
        })
        print(f"packed {name} {m.get('version', '1.0')}  ({os.path.getsize(out) // 1024} KB)")
    with open(os.path.join(ROOT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"name": "Korie add-ons", "addons": index}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote addons/index.json with {len(index)} add-ons")


if __name__ == "__main__":
    main()
