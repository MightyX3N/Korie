# Install and set up

## Requirements

- An Android TV box on Android 7.0+ (tested on a Xiaomi Mi Box, `MIBOX4`, Android 12).
- Developer options and **network debugging** turned on (Settings → Device Preferences → About →
  click *Build* seven times).
- A computer with `adb` (Android SDK platform-tools) on the same network.

## Build

```sh
./build.sh                        # uses JDK 17 and Android build-tools 34
VERSION_CODE=62 VERSION_NAME=6.9 ./build.sh
```

The script compiles resources (`aapt2`), Java (`javac`), dexes (`d8`), aligns and signs with
`signing.keystore`. **Keep `signing.keystore`** — updates must be signed with the same key.

## Install and make it the home screen

```sh
TV=192.168.1.13:5555
adb connect $TV
adb -s $TV install -r build/tvos-home.apk

# Android TV keeps its own launcher in front unless it is disabled:
adb -s $TV shell pm disable-user --user 0 com.google.android.tvlauncher
adb -s $TV shell pm set-home-activity com.petrobot.hume/.MainActivity
```

Press Home on the remote — Hume Launcher opens.

## One-time permissions

Hume asks for these **on screen** (setup's last page and Settings → Permissions): Android's prompts,
the system's own settings screens, or Hume's accessibility switch. The commands below are only a
last resort for TVs that have no such screen.

| Feature | Command |
|---|---|
| Continue Watching + Do Not Disturb | `adb shell cmd notification allow_listener com.petrobot.hume/com.petrobot.hume.MediaWatchService` |
| Power Off + Sleep Timer | `adb shell dpm set-active-admin com.petrobot.hume/.SleepReceiver\$Admin` |
| Wi-Fi name in Control Center | `adb shell pm grant com.petrobot.hume android.permission.ACCESS_FINE_LOCATION` |

## Optional: TMDB suggestions

Suggestions use JustWatch by default (no setup). To use TMDB instead, open **Settings → Source →
TMDB** and enter a free API key from themoviedb.org (Settings → API). The short v3 *API Key* is
easiest to type with a remote. It can also be set from a computer:

```sh
adb shell am start -n com.petrobot.hume/.SettingsActivity --es tmdb_token <token>
```

## Undo

```sh
adb shell pm enable com.google.android.tvlauncher     # bring back the stock launcher
adb uninstall com.petrobot.hume
```
