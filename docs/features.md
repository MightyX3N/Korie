# Features

## Home screen

- **Dock**: the first row of apps sits on a frosted Liquid Glass panel that shows a blurred,
  colour-boosted copy of whatever is behind it, with lensed edges and a specular rim.
- **Grid**: 6 cards per row in Apple's 5:3 shape; spacing, margins, corner radii and the dock
  position were measured from Apple's tvOS 26 screenshots and the HIG (60 pt / 80 pt safe area).
- **Focus**: the card lifts to 1.2× with a soft shadow and a single subtle glare sweep; pressing OK
  dips the card (the HIG's "pressed" state) and zooms it to full screen while the app opens.
- **Names** appear under focused cards below the dock (none inside the dock, as on tvOS).
- **More Apps**: hidden apps live in a folder card at the end of the grid.
- **System apps** (Settings, Play Store, etc.) get tvOS-style cards — a gradient with a white glyph.
- **Background**: Aurora, Midnight, Sunset, Ocean or Graphite (Settings → Background).

### Remote

| Where | Key | Action |
|---|---|---|
| Any card | OK | Open (zoom animation) |
| Any card | Hold OK / Menu | Options menu: Open, Move, Hide, App Info, Uninstall, Reset Layout |
| Move mode | Arrows / OK | Move the wiggling card / finish |
| Dock | Up | Top shelf (or the tab bar if the shelf is empty) |
| Tab bar | Left / Right | Suggestions ⇄ Continue Watching |
| Status row | Left / Right | Control Center button ⇄ profile avatar |
| Anywhere | Home | Back to the first app in the dock |

## Top shelf

Shown behind the dock while a dock app is focused; below the dock the launcher background returns.

- **Suggestions**: up to 10 titles popular in India on your services. Source: **JustWatch**
  (no key; unofficial API) or **TMDB** (free key). Full-screen artwork with the service's icon,
  title, year · type · genre · rating; when focused, the description and a **▶ Open** button that
  goes to the title's page in the app (exact title link with JustWatch; search with TMDB).
- **Continue Watching**: what you played recently in each app, from the "now playing" information
  apps publish (title, artwork, position). **▶ Resume** opens the app; an Up Next strip with
  progress bars appears when focused; Menu → *Remove from Continue Watching*.
- Left / Right browse with a slide animation; the carousel keeps its place when you come back.

## Profiles

- Up to **3 profiles**, each with a **unique emoji** on a pastel circle.
- Each profile keeps its own **app layout and hidden apps, background, top-shelf tab and
  Continue Watching**.
- The avatar (top right) opens the switcher: a two-column popover with a green check on the
  current profile and **+ Add User**. Menu on a profile: Change Emoji, Rename, Change Colour,
  Delete.
- With two or more profiles, the switcher appears when the TV wakes (Settings → Show profiles on
  wake).

## Control Center

Opened from the button next to the time. Tiles: **Power Off** (sleep), **Wi-Fi**, **Do Not
Disturb**, **Audio**, **Sleep Timer** (Off → 15 → 30 → 60 → 90 min), and shortcuts for
**Bluetooth/controllers**, **Accessibility**, **launcher Settings** and **Search**.

## Settings

Opened from the gear in Control Center. Sections:

- **Profiles** — current profile, show profiles on wake.
- **Presentation** — see [presentation.md](presentation.md).
- **Suggestions** — on/off, source, content (movies/series), services, languages (TMDB),
  auto-advance, refresh, TMDB token.
- **Continue Watching** — access status, clear history.
- **Home** — background, reset app layout.
- **System** — TV settings, about (version).

The left side shows the Petrobot icon above the title, with "Hume Launcher by Petrobot".

## Display scaling

All sizes are expressed relative to the screen's resolution (a 960×540 design grid), so the layout
keeps its proportions on 720p, 1080p and 4K outputs and rebuilds itself if the display changes.
