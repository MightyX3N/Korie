#!/bin/bash
# Runs the Jellyfin add-on against a real Jellyfin server: bash tools/jellyfin-test/run.sh <user> <password> [address]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=build/jellyfin-test
mkdir -p "$OUT"
LUAJ=$(ls libs/luaj-*.jar | head -1)
javac -encoding UTF-8 -nowarn -d "$OUT" -classpath "$LUAJ" \
    src/com/petrobot/hume/AddonLua.java src/com/petrobot/hume/AddonPack.java tools/jellyfin-test/RealTest.java
java -Dfile.encoding=UTF-8 -classpath "$OUT:$LUAJ" RealTest "$@"
