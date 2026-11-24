#!/bin/bash
# Publishes the version in the VERSION file (line 1: name, line 2: code, one higher each time):
# builds the APK, puts it on the repository's "apk" branch (a branch that holds only the APKs),
# writes update.json (what Settings → About → Update in Korie reads), commits and pushes both.
# It must be built with the same debug.keystore as the versions before it, or Android refuses the update.
#
#     tools/release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=$(sed -n 1p VERSION); CODE=$(sed -n 2p VERSION)
./build.sh
python3 tools/pack-addons.py
W=$(mktemp -d)
if git fetch origin apk 2>/dev/null; then git worktree add -f "$W" -B apk origin/apk; else git worktree add -f --detach "$W"; git -C "$W" checkout --orphan apk; git -C "$W" rm -rfq .; fi
cp build/korie.apk "$W/korie-$NAME.apk"
git -C "$W" add "korie-$NAME.apk"
git -C "$W" commit -m "Korie $NAME"
git -C "$W" push origin apk
git worktree remove --force "$W"
cat > update.json <<JSON
{
  "version": "$NAME",
  "code": $CODE,
  "apk": "https://raw.githubusercontent.com/MightyX3N/Korie/apk/korie-$NAME.apk"
}
JSON
git add -A
git commit -m "Korie $NAME"
git push
echo "Released Korie $NAME"
