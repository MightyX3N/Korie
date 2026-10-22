# Presentation feature (port of pb-marketer-tv into Hume Launcher)

Source: ~/pb-marketer-tv (Kotlin, Gradle, ExoPlayer, NanoHTTPD, ZXing). Port to plain Java in
package com.petrobot.hume.present, built by ./build.sh (no Gradle).

## Keep (same logic)
- Pairing: 6-digit PIN shown on TV -> POST /api/pair -> bearer token (prefs "pairing").
- SQLite signage.db: tables media, playlists (singleton playlist id "default", name "Default").
- Media stored in files/media/<uuid>.<ext>; sanitizeDisplayName / guessMimeType as in SignageRepository.kt.
- API (port 8080): GET /api/info, POST /api/pair, GET/POST /api/media, DELETE /api/media/{id},
  GET/PUT /api/playlist (+ /api/playlists aliases), GET /api/playback/status,
  POST /api/playback/control {play,pause,next,previous,restart,showConnectionInfo}.
- Slide model + validation: PlaylistRules.kt, JsonCodecs.kt (fields: id,type,durationSec,mediaId,url,
  fitMode,muted,loop,webpageAutoScroll,webpageScrollSpeedPxPerSec,webpageScrollPauseSec,enabled,order).
- Player: PlaybackEngine.kt logic (image timer, video ends -> next, webpage auto-scroll JS with pauses
  every 0.85 viewport, 1920 viewport scaling, legacy WebView @layer CSS rewrite, error -> advance 5 s,
  connection panel with QR + URL + PIN).

## Remove
- AdminLockManager (upload/admin lock PIN) and /api/lock, /api/unlock.
- TelemetryManager + /api/debug*, Debug tab.
- App updater (/api/app-update, REQUEST_INSTALL_PACKAGES, FileProvider).

## Replacements
- NanoHTTPD -> small Java HTTP server (streaming multipart upload to file).
- ExoPlayer -> android.widget.VideoView / MediaPlayer.
- ZXing -> vendored Nayuki QR generator (MIT, keep licence header).

## Launcher integration
- Settings: "Presentation" section: Enable (starts server), Start on boot, Show connection info.
- PresentationActivity (fullscreen) launched from a Control Center tile / app tile; BOOT_COMPLETED
  receiver + HOME onCreate auto-start when "Start on boot" is on.
- Web UI rewritten Apple-style (SF/Inter, light+dark, segmented tabs Files | Playlist, glass cards),
  same flows as admin.js (upload w/ progress, filter, add slide, reorder, per-slide fields, save,
  playback controls, pairing screen).
