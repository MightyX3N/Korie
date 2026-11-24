#!/bin/bash
# Publishes a new version: raise the two lines in VERSION (name, then code, one higher each time),
# then run this. It writes update.json (what Settings → About → Update in Korie reads) and pushes;
# the Release workflow on GitHub then builds the APK, signs it with the key in the repository secret
# KORIE_KEYSTORE_B64, and publishes the release.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME=$(sed -n 1p VERSION); CODE=$(sed -n 2p VERSION)
python3 tools/pack-addons.py
cat > update.json <<JSON
{
  "version": "$NAME",
  "code": $CODE,
  "apk": "https://github.com/MightyX3N/Korie/releases/download/v$NAME/korie.apk"
}
JSON
git add -A
git commit -m "Korie $NAME"
git push
