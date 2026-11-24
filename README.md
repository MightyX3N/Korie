# Korie

One home screen for Android TVs, car boxes, phones and tablets, in the style of Apple TV: a glass
dock, a full-screen carousel, Control Center and profiles. It works with a remote and with touch,
and everything it shows to watch or listen to comes from **add-ons**.

Korie is **based on [Hume Launcher](https://github.com/petrobot-admin/hume-launcher) by Petrobot**
(Apache License 2.0). Hume is the TV home screen underneath; Korie adds touch, the map, add-ons and
its own player on top of it.

## What Korie adds to Hume

- **Any device**: installs on phones, tablets and car boxes as well as TVs; the layout is sized from
  the real screen (notches included) and runs full screen.
- **Touch**: tap, hold and swipe everywhere, a Back button on pages and a button for the Android
  keyboard in Search. The remote works as in Hume.
- **Map on Home**: the carousel's place can show a north-up map (always, or only during a route),
  drawn with osmdroid from OpenStreetMap.
- **Add-ons**: small Lua scripts that supply titles, stations and actions. Search, the carousel and
  Recommendations are fed by them. Install from this repository's list or from the Download folder.
- **Player**: films, series and radio play inside Korie (AndroidX Media3), with progress reported
  back to the add-on and a now-playing pill on Home for background sound.

Everything Hume does is still there: **[docs/features.md](docs/features.md)**.

## Add-ons

| Add-on | What it does |
|---|---|
| [Jellyfin](addons/jellyfin) | Films and series from your own Jellyfin server: finds it on the network, Quick Connect or password, one sign-in per profile, Continue Watching from the server |
| [Radio](addons/radio) | Stations of a chosen country from Radio Browser; can start the last station with Korie |
| [Open Films](addons/openfilms) | Two open films from the Blender Foundation, as the smallest example |

How to write one: **[docs/addons.md](docs/addons.md)**. Packed add-ons are in
[addons/dist](addons/dist), listed in [addons/index.json](addons/index.json).

## Build

```sh
# needs JDK 17+ and Android SDK build-tools 34.0.0 and 36.0.0 + platform android-34
./build.sh                                   # → build/korie.apk
adb install -r build/korie.apk
python3 tools/pack-addons.py                 # → addons/dist/*.korie
```

Plain Java, no Gradle. See **[docs/getting-started.md](docs/getting-started.md)**.

## Requirements

Android 7.0+ (API 24).

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE).

## Credits

- [Hume Launcher](https://github.com/petrobot-admin/hume-launcher) by Petrobot (Apache-2.0), the base of this app
- [osmdroid](https://github.com/osmdroid/osmdroid) (Apache-2.0) · map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- [LuaJ](https://github.com/luaj/luaj) (MIT) · [AndroidX Media3](https://github.com/androidx/media) (Apache-2.0)
- Inter font (SIL OFL) · Nayuki QR Code generator (MIT)
- Weather from Open-Meteo, MET Norway and wttr.in · stations from [Radio Browser](https://www.radio-browser.info/)
