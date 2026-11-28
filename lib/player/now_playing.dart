import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../tv/widgets.dart';
import '../ui/common.dart';
import 'player.dart';
import 'playlists.dart';

/// Now Playing (OK on the island while sound plays): the station or song large, pause/play,
/// Stop, Add to Playlist. Back goes back and the sound keeps playing.
class NowPlaying extends StatefulWidget {
  const NowPlaying({super.key});
  @override
  State<NowPlaying> createState() => _NowPlayingState();
}

class _NowPlayingState extends State<NowPlaying> {
  AudioPlayback get a => KoriePlayer.instance.audio;

  @override
  void initState() {
    super.initState();
    a.addListener(_changed);
  }

  @override
  void dispose() {
    a.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    // Stopped (held OK on the island, or it ended): nothing to show.
    if (a.now == null) {
      // Only this page: a video may already be opening above it.
      final route = ModalRoute.of(context);
      if (route == null) return;
      if (route.isCurrent) {
        Navigator.of(context).pop();
      } else if (route.isActive) {
        Navigator.of(context).removeRoute(route);
      }
      return;
    }
    setState(() {});
  }

  static const _colors = [Color(0xFF95E34C), Color(0xFFE8564F), Color(0xFFE6C24E), Color(0xFF4FE07E), Color(0xFF4FD3E6), Color(0xFF5562E6), Color(0xFFD46BE0)];

  /// "DR P3" → P3, "Nova" → N: as the radio tiles show it.
  static String letters(String name) {
    final words = name.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return '?';
    final last = words.last;
    if (last.length <= 3 && RegExp(r'\d').hasMatch(last)) return last.toUpperCase();
    return words.take(2).map((w) => w[0]).join().toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final r = a.now;
    if (r == null) return const ColoredBox(color: Colors.black);
    final e = a.entry;
    final image = r.image.isNotEmpty ? r.image : (e?.image ?? '');
    final color = _colors[r.title.hashCode.abs() % _colors.length];
    final source = AddonHost.instance.installed[r.addon]?.manifest.name ?? '';
    return Material(
      color: const Color(0xFF0D0F0B),
      child: LayoutBuilder(
        builder: (context, c) {
          final g = TvGeo(c.maxWidth, c.maxHeight);
          final art = g.dp(340);
          return DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(center: const Alignment(-0.4, -0.2), radius: 1.2, colors: [Color.lerp(color, Colors.black, 0.55)!, const Color(0xFF0D0F0B)]),
            ),
            child: FocusTraversalGroup(
              policy: tvTraversal,
              child: Stack(
                children: [
                  Positioned(
                    left: g.dp(110),
                    top: (g.h - art) / 2 - g.dp(20),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(g.dp(36)),
                      child: SizedBox(
                        width: art,
                        height: art,
                        child: image.isNotEmpty
                            ? TvImage(image, width: art, height: art, fit: BoxFit.cover, fallback: _letters(g, r.title, color))
                            : _letters(g, r.title, color),
                      ),
                    ),
                  ),
                  Positioned(
                    left: g.dp(110) + art + g.dp(70),
                    right: g.dp(80),
                    top: (g.h - art) / 2,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text([if (source.isNotEmpty) source.toUpperCase(), if (a.buffering) 'LOADING' else if (a.duration <= 0) 'LIVE'].join(' · '), style: tx(g.dp(15), w: FontWeight.w700, opacity: 0.65)),
                        SizedBox(height: g.dp(10)),
                        Text(r.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(48), w: FontWeight.w800, spacing: -g.dp(1))),
                        if (r.subtitle.isNotEmpty) ...[
                          SizedBox(height: g.dp(8)),
                          Text(r.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(20), w: FontWeight.w600, opacity: 0.85)),
                        ],
                        SizedBox(height: g.dp(40)),
                        Row(
                          children: [
                            _round(g, a.playing ? Icons.pause_rounded : Icons.play_arrow_rounded, a.toggle, size: 72, autofocus: true),
                            SizedBox(width: g.dp(16)),
                            _round(g, Icons.stop_rounded, () => a.stop(), size: 56),
                            if (PlayQueue.instance.following != null) ...[
                              SizedBox(width: g.dp(16)),
                              TvPill(g: g, label: 'Next', icon: Icons.skip_next_rounded, onTap: () => PlayQueue.instance.next()),
                            ],
                            if (e != null) ...[
                              SizedBox(width: g.dp(24)),
                              TvPill(g: g, label: 'Add to Playlist', icon: Icons.playlist_add_rounded, onTap: () => addToPlaylist(context, e)),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: g.dp(18),
                    child: Center(child: Text('Back: keep listening and go back  ·  Stop ends it', style: tx(g.dp(13), w: FontWeight.w600, opacity: 0.55))),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _letters(TvGeo g, String title, Color color) => Container(
    color: color,
    alignment: Alignment.center,
    child: Text(letters(title), style: tx(g.dp(120), w: FontWeight.w800, color: const Color(0xFF111111))),
  );

  Widget _round(TvGeo g, IconData icon, VoidCallback onTap, {double size = 56, bool autofocus = false}) => Focusable(
    autofocus: autofocus,
    onTap: onTap,
    builder: (context, f) => AnimatedScale(
      scale: f ? 1.08 : 1,
      duration: const Duration(milliseconds: 120),
      child: Container(
        width: g.dp(size),
        height: g.dp(size),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: f ? const Color(0xFFF2F2F4) : const Color(0x33FFFFFF),
          border: Border.all(color: f ? Colors.white : const Color(0x38FFFFFF)),
        ),
        child: Icon(icon, size: g.dp(size * 0.48), color: f ? const Color(0xFF111114) : Colors.white),
      ),
    ),
  );
}
