#!/bin/bash
# Builds and signs build/tvos-home.apk with plain SDK tools (no Gradle).
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="$HOME/.local/jdk-17.0.20.1+1/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
SDK="$HOME/Library/Android/sdk"
BT="$SDK/build-tools/34.0.0"
JAR="$SDK/platforms/android-34/android.jar"

rm -rf build && mkdir -p build/gen build/classes build/dex

"$BT/aapt2" compile --dir res -o build/res.zip
"$BT/aapt2" link -o build/unsigned.apk -I "$JAR" --manifest AndroidManifest.xml \
    -A assets --java build/gen --min-sdk-version 24 --target-sdk-version 34 \
    --version-code "${VERSION_CODE:-1}" --version-name "${VERSION_NAME:-1.0}" build/res.zip

javac -encoding UTF-8 --release 11 -classpath "$JAR" \
    -d build/classes $(find src build/gen -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output build/dex $(find build/classes -name '*.class')
(cd build/dex && zip -q ../unsigned.apk classes.dex)

"$BT/zipalign" -f 4 build/unsigned.apk build/aligned.apk

KS=signing.keystore
if [ ! -f "$KS" ]; then
    keytool -genkeypair -keystore "$KS" -storepass android -keypass android -alias home \
        -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=tvOS Home" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
    --out build/tvos-home.apk build/aligned.apk

echo "Built build/tvos-home.apk"
