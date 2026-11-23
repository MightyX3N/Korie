#!/bin/bash
# Runs the add-ons' Lua on the computer (no Android needed): bash tools/addon-test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=build/addon-test
mkdir -p "$OUT"
LUAJ=$(ls libs/luaj-*.jar | head -1)
javac -encoding UTF-8 -nowarn -d "$OUT" -classpath "$LUAJ" \
    src/com/petrobot/hume/AddonLua.java src/com/petrobot/hume/AddonPack.java tools/addon-test/AddonTest.java
java -Dfile.encoding=UTF-8 -classpath "$OUT:$LUAJ" AddonTest
