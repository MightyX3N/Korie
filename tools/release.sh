#!/bin/bash
# Publishes the version in the VERSION file (line 1: name, line 2: code, one higher each time):
# builds the APK, writes update.json (what Settings → About → Update in Korie reads), commits and
# pushes it, and makes the GitHub release that holds the APK. Needs the gh command, signed in.
#
#     tools/release.sh "What is new"
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=$(sed -n 1p VERSION); CODE=$(sed -n 2p VERSION)
./build.sh
python3 tools/pack-addons.py
cat > update.json <<JSON
{
  "version": "$NAME",
  "code": $CODE,
  "apk": "https://github.com/MightyX3N/Korie/releases/download/v$NAME/korie.apk"
}
JSON
gh release create "v$NAME" build/korie.apk --repo MightyX3N/Korie --title "Korie $NAME" --notes "${1:-Korie $NAME}"
git add -A
git commit -m "Korie $NAME"
git push
echo "Released Korie $NAME"
