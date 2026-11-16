#!/bin/sh
# Fetches the Jellyfin Kotlin SDK the Android TV app uses (its JSON reading), and builds Check.java.
set -e
cd "$(dirname "$0")"; mkdir -p sdk; cd sdk
M=https://repo1.maven.org/maven2
for j in org/jellyfin/sdk/jellyfin-model-jvm/1.8.12/jellyfin-model-jvm-1.8.12.jar \
         org/jellyfin/sdk/jellyfin-api-jvm/1.8.12/jellyfin-api-jvm-1.8.12.jar \
         org/jetbrains/kotlin/kotlin-stdlib/2.2.10/kotlin-stdlib-2.2.10.jar \
         org/jetbrains/kotlinx/kotlinx-serialization-json-jvm/1.9.0/kotlinx-serialization-json-jvm-1.9.0.jar \
         org/jetbrains/kotlinx/kotlinx-serialization-core-jvm/1.9.0/kotlinx-serialization-core-jvm-1.9.0.jar; do
  [ -f "$(basename $j)" ] || curl -fsSLO "$M/$j"
done
javac -cp "$(ls *.jar | tr '\n' ':')" -d . ../Check.java
echo "SDK ready in $(pwd)"
