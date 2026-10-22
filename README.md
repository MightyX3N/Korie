# Hume Launcher

A tvOS 26–style home screen for Android TV, built for the Xiaomi Mi Box (Android 12) and other
Android TV boxes. Plain Java, no Gradle, no third-party runtime libraries.

![Home screen](docs/images/home-dock-glass.jpg)

- **Home**: glass dock, 6-across app grid with Apple's measured proportions, focus lift and
  zoom-to-open animation, More Apps folder.
- **Top shelf**: Suggestions (popular in India on your services) or Continue Watching.
- **Profiles**: up to 3, each with its own layout, background and Continue Watching.
- **Control Center**: sleep, Wi-Fi, Do Not Disturb, audio, sleep timer, shortcuts.
- **Inputs**: a movable Inputs card and status-row button to switch HDMI/AV/TV inputs.
- **Weather**: an overview card under the status row and a 5-day forecast (Open-Meteo, no key).
- **Presentation mode**: send images, videos and webpages from a browser and play them full
  screen; optionally starts on boot.

Documentation: **[docs/](docs/README.md)** — [install](docs/install.md) ·
[features](docs/features.md) · [presentation](docs/presentation.md) ·
[architecture](docs/architecture.md)

```sh
./build.sh                                   # → build/tvos-home.apk
adb install -r build/tvos-home.apk
```
