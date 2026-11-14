#!/usr/bin/env python3
"""Writes Jellyfin's plugin catalogue (manifest.json) from Korie's GitHub releases.

    python3 tools/manifest.py releases.json > manifest.json

releases.json is GitHub's list of releases (gh api repos/<owner>/<repo>/releases). Each release
has korie_<version>.zip and korie_<version>.md5 attached by the release workflow.
"""
import json
import sys

GUID = "6b0b6a2e-3f0e-4c2a-9a4e-6f2b7e5d1c11"
TARGET_ABI = "12.4.0.0"

releases = json.load(open(sys.argv[1], encoding="utf-8"))
versions = []
for r in releases:
    if r.get("draft"):
        continue
    v = r["tag_name"].lstrip("v")
    assets = {a["name"]: a["browser_download_url"] for a in r.get("assets", [])}
    zip_name = f"korie_{v}.zip"
    if zip_name not in assets:
        continue
    checksum = ""
    for line in (r.get("body") or "").splitlines():
        if line.lower().startswith("md5:"):
            checksum = line.split(":", 1)[1].strip()
    versions.append({
        "version": v + ".0" if v.count(".") == 2 else v,
        "changelog": (r.get("body") or "").split("md5:")[0].strip()[:2000],
        "targetAbi": TARGET_ABI,
        "sourceUrl": assets[zip_name],
        "checksum": checksum,
        "timestamp": r["published_at"],
    })

print(json.dumps([{
    "guid": GUID,
    "name": "Korie",
    "description": "Libraries read the way your folders are laid out (groups of shows, films in parts, your own .nfo files), and add-ons such as DRTV, Stremio and RomM from the Korie Store.",
    "overview": "Your folders as they are, plus add-ons from the Korie Store",
    "owner": "MightyX3N",
    "category": "General",
    "imageUrl": "https://mightyx3n.github.io/Korie/icon.png",
    "versions": versions,
}], indent=2))
