# Korie

A home screen (launcher) for Android TV and Google TV, made to look and work like Apple's tvOS
Home Screen, with add-ons for your own films, series, radio and more. Written in Flutter; car
head units, phones and desktop come later.

- **Home**: the carousel at the top (what you are watching, from your apps and add-ons), the dock
  as the first row of apps, every other app below it. Hold OK on an app to move, hide or uninstall it.
- **Setup**: add-ons, who uses Korie (Korie profiles with an optional PIN, or an add-on's users
  such as Jellyfin's, linked by name), a look, permissions, location, Korie as Home.
- **Top-right island**: time, Settings and the profile; what plays in other apps, add-ons' news
  and updates.
- **Korie TV**: one tile on Home for everything add-ons give to watch, like Apple's TV app: a
  sidebar (Search, Home, Movies, Series and sections add-ons add, such as Radio), a featured
  picture with Play on each page, Continue Watching, rows of posters by genre, and pages for films
  and series with their seasons, episodes and More Like This. Titles that several add-ons have
  show once. Add-ons can also put their own tiles on Home. (Korie's own video player comes next.)
- **Browser**: a tile on Home with tabs, a new-tab page with search and favourites, and a
  pointer moved with the arrows (OK clicks; Up at the top of a page reaches the bar). Add-ons can
  open pages in it as a tab, or full screen with every key and a game controller going to the
  page, as the ZeroPlay add-on does: Back closes it, Home keeps it running in the background
  (shown in the island; Settings › Background sets how many and for how long). It uses the TV's
  own web engine.
- **Add-ons**: small Lua programs from the Korie add-on list (`addons/`), the Download folder or a
  `.korie` file. See [docs/addons.md](docs/addons.md).

The remote works with Flutter's own focus (arrow keys and OK).

## Updating

Korie checks `update.json` in this repository; when a newer version is there, "Update ready"
shows in the top-right corner. Korie 1.8 finds Korie 2 the same way.

## Releases

Change the version in `pubspec.yaml` (`2.0.0+20`: name and build number) and `VERSION`, and push
to `main`. The Release workflow builds the APK, signs it with the repository secret
`KORIE_KEYSTORE_B64` (the keystore, base64), publishes a GitHub release and then updates
`update.json`.

## Build

    flutter build apk --release

Release builds are signed with `android/korie.keystore` (not in git) or the file named by
`KORIE_KEYSTORE`.

## Licence

Korie's own code is released into the public domain under the Unlicense (see LICENSE).

Parts made by others keep their own licences:
- Inter font: SIL Open Font License 1.1 (assets/fonts/Inter-OFL.txt)
- Flutter and its packages: BSD-3-Clause; lua_dart and Lua 5.5: MIT; archive: MIT;
  path_provider and shared_preferences: BSD-3-Clause
- City search: Open-Meteo geocoding (GeoNames data, CC BY 4.0)
