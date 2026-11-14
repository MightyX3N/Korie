# Korie

A Jellyfin plugin that makes Jellyfin take your media the way it already is, and adds other
services to it.

- **Your folders as they are.** Groups of shows (`TV/Danish/Matador/Season 1`) are read as
  groups, not as one big series. A film in several files (`CD 1.avi`, `CD 2.avi`, `Part 2.mkv`)
  is one film. Your own `.nfo` files are used, also when they're named after the first part.
- **Add-ons.** DRTV, Stremio, RomM, Free Films and more from the
  [Korie Store](https://github.com/MightyX3N/Korie-Store), or any other repository you add.
  Each add-on you turn on shows up in Jellyfin as a channel: its films, series (with seasons
  and episodes), categories and live TV. What an add-on lists is kept on the server and
  refreshed in the background, so opening it never waits for the internet.
- **A Korie page in the dashboard** for the Store, your add-ons, their settings and repositories.

## Installing

Korie needs Jellyfin 12.4 or later.

1. In Jellyfin: **Dashboard → Plugins → Repositories → +**, name it Korie and use
   `https://mightyx3n.github.io/Korie/manifest.json`.
2. **Catalogue → Korie → Install**, then restart Jellyfin.
3. **Dashboard → Korie**: install add-ons from the Store, turn them on, and restart Jellyfin once
   more so new add-ons show as channels.

Libraries need nothing: rescan them and Korie's way of reading folders is used.

## Add-ons

Add-ons are written in Lua and run sandboxed inside the plugin: see
[docs/ADDONS.md](https://github.com/MightyX3N/Korie-Store/blob/main/docs/ADDONS.md) in the Korie Store.

## Building

    dotnet build Korie.Jellyfin/Korie.Jellyfin.csproj -c Release -o out

Copy `out/Korie.Jellyfin.dll` and `out/MoonSharp.Interpreter.dll` into a folder in Jellyfin's
`plugins` folder. A version tag (`git tag v0.2.0 && git push --tags`) makes GitHub build a
release and update the plugin catalogue on GitHub Pages.

## Licence

GPL-3.0, like Jellyfin's plugins. Lua runs on [MoonSharp](https://www.moonsharp.org/) (BSD licence).
