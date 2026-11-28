import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../player/player.dart';
import '../player/playlists.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import 'library.dart';
import 'widgets.dart';

List<Map> _maps(Object? v) => [for (final x in (v is List ? v : const [])) if (x is Map) x];

/// "S2 E5" from a season's name and an episode's title ("Season 2", "5. Breakage").
String episodeNumber(String season, String episode) {
  final s = RegExp(r'\d+').firstMatch(season)?.group(0);
  final e = RegExp(r'^(\d+)\.').firstMatch(episode)?.group(1);
  if (s == null || e == null) return episode;
  return 'S$s E$e';
}

/// Playing a title straight away (a featured picture's Play, a Continue Watching card): a film
/// carries on where it was left (its first button), a series at the episode its add-on points to.
class TvActions {
  static AddonHost get host => AddonHost.instance;

  static Future<Map> detail(TvSource s) async {
    if (!host.handles(s.addon).contains('detail')) return const {};
    final d = await host.call(s.addon, 'detail', [s.data]);
    return d is Map ? d : const {};
  }

  static Future<List<Map>> episodes(TvSource s, Object? season) async => _maps(await host.call(s.addon, 'episodes', [s.data, season]));

  /// A film, or an episode of [series], as something to play and put in a playlist.
  static PlayEntry entry(TvSource s, Map it, {TvItem? series, String season = ''}) {
    final isEpisode = series != null && it != s.data;
    final name = '${it['title'] ?? ''}';
    return PlayEntry(
      addon: s.addon,
      data: it.cast<String, Object?>(),
      title: isEpisode ? series.title : (name.isEmpty ? (series?.title ?? '') : name),
      sub: isEpisode ? '${episodeNumber(season, name)}${name.contains('. ') ? ' · ${name.substring(name.indexOf('. ') + 2)}' : ''}' : '',
      image: '${it['thumb'] ?? it['backdrop'] ?? it['poster'] ?? series?.wide ?? ''}',
    );
  }

  /// Asks the add-on to play [it] (it answers with korie.play); Korie notes what was chosen.
  static Future<void> act(TvSource s, Map it, String button, {TvItem? series, String season = ''}) async {
    KoriePlayer.instance.choose(entry(s, it, series: series, season: season));
    await host.call(s.addon, 'action', [it, button]);
  }

  static Future<void> play(TvItem item) async {
    final s = item.sources.first;
    final d = await detail(s);
    final seasons = _maps(d['seasons']);
    if (seasons.isNotEmpty) {
      final focus = d['focus'] is Map ? d['focus'] as Map : const {};
      final si = seasons.indexWhere((x) => x['id'] == focus['season']);
      final eps = await episodes(s, seasons[si < 0 ? 0 : si]['id']);
      if (eps.isEmpty) return;
      final ei = eps.indexWhere((x) => x['id'] == focus['episode']);
      final ep = eps[ei < 0 ? 0 : ei];
      await act(s, ep, _started(ep) ? 'resume' : 'play', series: item, season: '${seasons[si < 0 ? 0 : si]['name'] ?? ''}');
      return;
    }
    final buttons = _maps(d['buttons']);
    await act(s, s.data, buttons.isEmpty ? 'play' : '${buttons.first['id'] ?? 'play'}', series: item);
  }

  static bool _started(Map ep) {
    final p = ep['progress'];
    return p is num && p > 0 && p < 1;
  }
}

/// A title's page: the backdrop behind, title, facts, the add-on's buttons (Resume / Play from the
/// Start), the add-ons that have it, then seasons and episodes for a series, and More Like This.
class TvTitle extends StatefulWidget {
  const TvTitle({super.key, required this.item, required this.library, required this.section, required this.sectionIcon});
  final TvItem item;
  final TvLibrary library;
  final String section;
  final IconData sectionIcon;
  @override
  State<TvTitle> createState() => _TvTitleState();
}

class _TvTitleState extends State<TvTitle> {
  TvItem get item => widget.item;
  int source = 0;
  bool loaded = false;
  List<Map> buttons = [];
  List<Map> seasons = [];
  Map focus = const {};
  int season = 0;
  List<Map> eps = [];
  Map? next; // the series' episode to Resume / Play
  String nextLabel = '';
  List<TvItem> similar = [];
  final first = FocusNode(debugLabel: 'title.first');
  int _load = 0;
  bool moved = false; // down at More Like This: the picture behind dims

  /// Which part of the page had the focus last: coming into the seasons from the buttons or the
  /// episodes lands on the season being shown, not on whichever tab is nearest.
  String _zone = '';
  final List<FocusNode> _tabs = [];
  FocusNode _tab(int i) {
    while (_tabs.length <= i) {
      _tabs.add(FocusNode(debugLabel: 'title.season${_tabs.length}'));
    }
    return _tabs[i];
  }

  void _in(String zone) => _zone = zone;

  @override
  void initState() {
    super.initState();
    _detail();
    widget.library.similar(item).then((v) {
      if (mounted) setState(() => similar = v);
    });
  }

  @override
  void dispose() {
    first.dispose();
    for (final n in _tabs) {
      n.dispose();
    }
    super.dispose();
  }

  TvSource get src => item.sources[source];

  Future<void> _detail() async {
    final ticket = ++_load;
    final d = await TvActions.detail(src);
    if (!mounted || ticket != _load) return;
    buttons = _maps(d['buttons']);
    seasons = _maps(d['seasons']);
    focus = d['focus'] is Map ? d['focus'] as Map : const {};
    next = null;
    if (seasons.isNotEmpty) {
      final si = seasons.indexWhere((x) => x['id'] == focus['season']);
      season = si < 0 ? 0 : si;
      await _episodes(season);
      if (!mounted || ticket != _load) return;
      final ei = eps.indexWhere((x) => x['id'] == focus['episode']);
      next = eps.isEmpty ? null : eps[ei < 0 ? 0 : ei];
      nextLabel = next == null ? '' : episodeNumber('${seasons[season]['name'] ?? ''}', '${next!['title'] ?? ''}');
    }
    setState(() => loaded = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) return; // the player may be above
      if (FocusManager.instance.primaryFocus?.context?.findAncestorStateOfType<_TvTitleState>() != this) first.requestFocus();
    });
  }

  Future<void> _episodes(int i) async {
    final v = await TvActions.episodes(src, seasons[i]['id']);
    if (!mounted) return;
    setState(() {
      season = i;
      eps = v;
    });
  }

  void _act(Map it, String button) =>
      TvActions.act(src, it, button, series: item, season: seasons.isEmpty ? '' : '${seasons[season]['name'] ?? ''}');

  void _addToPlaylist(Map it) =>
      addToPlaylist(context, TvActions.entry(src, it, series: item, season: seasons.isEmpty ? '' : '${seasons[season]['name'] ?? ''}'));

  void _info() => askChoice(context, title: item.title, message: item.overview, choices: const ['Close']);

  void _open(TvItem other) => Navigator.of(context).pushReplacement(
    PageRouteBuilder(
      pageBuilder: (_, _, _) => TvTitle(item: other, library: widget.library, section: widget.section, sectionIcon: widget.sectionIcon),
      transitionDuration: Duration.zero,
    ),
  );

  List<Widget> _buttons(TvGeo g) {
    if (!loaded) return [SizedBox(height: g.dp(50))];
    if (seasons.isNotEmpty) {
      final n = next;
      if (n == null) return [];
      final p = n['progress'];
      final started = p is num && p > 0 && p < 1;
      return [
        TvPill(
          g: g,
          label: started ? 'Resume' : 'Play',
          sub: nextLabel,
          icon: Icons.play_arrow_rounded,
          focusNode: first,
          onFocus: (v) => v ? _in('buttons') : null,
          onTap: () => _act(n, started ? 'resume' : 'play'),
        ),
        if (item.overview.isNotEmpty) TvRound(g: g, icon: Icons.info_outline_rounded, onFocus: (v) => v ? _in('buttons') : null, onTap: _info),
      ];
    }
    final list = buttons.isEmpty ? [{'id': 'play', 'label': 'Play'}] : buttons;
    return [
      for (final (i, b) in list.indexed)
        TvPill(
          g: g,
          label: '${b['label'] ?? b['id']}',
          sub: b['sub'] == null ? null : '${b['sub']}',
          icon: i == 0 ? Icons.play_arrow_rounded : null,
          focusNode: i == 0 ? first : null,
          onTap: () => _act(src.data, '${b['id'] ?? 'play'}'),
        ),
      TvPill(g: g, label: 'Add to Playlist', icon: Icons.playlist_add_rounded, onTap: () => _addToPlaylist(src.data)),
      if (item.overview.isNotEmpty) TvRound(g: g, icon: Icons.info_outline_rounded, onTap: _info),
    ];
  }

  Widget _info_(TvGeo g) {
    final r = item.rating;
    // Text keeps to a readable width; the buttons may use the whole width of the screen.
    return Padding(
      padding: EdgeInsets.only(left: g.side, top: g.dp(100)),
      child: SizedBox(
        width: g.w - 2 * g.side,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: g.dp(700),
              child: Text(
                item.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: tx(g.dp(item.isSeries ? 56 : 62), w: FontWeight.w800, height: 1.02, spacing: -g.dp(1.6)),
              ),
            ),
            SizedBox(height: g.dp(14)),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: g.dp(8),
              children: [
                Text(item.meta, style: tx(g.dp(16), w: FontWeight.w600, opacity: 0.9)),
                if (item.official.isNotEmpty)
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: g.dp(6), vertical: g.dp(1)),
                    decoration: BoxDecoration(border: Border.all(color: const Color(0x99FFFFFF)), borderRadius: BorderRadius.circular(g.dp(4))),
                    child: Text(item.official, style: tx(g.dp(12), w: FontWeight.w600)),
                  ),
                if (r != null) Text('★ ${r.toStringAsFixed(1)}', style: tx(g.dp(16), w: FontWeight.w600, opacity: 0.9)),
              ],
            ),
            if (item.overview.isNotEmpty) ...[
              SizedBox(height: g.dp(12)),
              SizedBox(
                width: g.dp(560),
                child: Text(item.overview, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(16), w: FontWeight.w400, opacity: 0.85, height: 1.45)),
              ),
            ],
            SizedBox(height: g.dp(22)),
            Wrap(spacing: g.dp(14), runSpacing: g.dp(12), children: _buttons(g)),
            if (item.sources.length > 1) ...[
              SizedBox(height: g.dp(16)),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Watch on', style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.6)),
                  for (final (i, s) in item.sources.indexed) ...[
                    SizedBox(width: g.dp(10)),
                    Focusable(
                      onTap: () {
                        if (i == source) return;
                        setState(() {
                          source = i;
                          loaded = false;
                        });
                        _detail();
                      },
                      builder: (context, f) => Container(
                        height: g.dp(32),
                        padding: EdgeInsets.symmetric(horizontal: g.dp(14)),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: f ? Colors.white : (i == source ? const Color(0x40FFFFFF) : const Color(0x14FFFFFF)),
                          borderRadius: BorderRadius.circular(g.dp(16)),
                        ),
                        child: Text(s.name, style: tx(g.dp(14), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white)),
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _episodes_(TvGeo g) {
    final w = g.dp(300), h = g.dp(169);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (seasons.length > 1)
          TvRowView(
            g: g,
            title: '',
            count: seasons.length,
            itemW: g.dp(122),
            itemH: g.dp(36),
            builder: (context, i, onFocus) => Focusable(
              focusNode: _tab(i),
              onTap: () => _episodes(i),
              onFocus: (v) {
                if (!v) return;
                if (_zone != 'tabs' && i != season) {
                  // Came in from above or below: go to the season being shown instead.
                  _zone = 'tabs';
                  _tab(season).requestFocus();
                  return;
                }
                _zone = 'tabs';
                onFocus(v);
                if (i != season) _episodes(i);
              },
              builder: (context, f) => Container(
                width: g.dp(122),
                height: g.dp(36),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: f ? const Color(0xFFF2F2F4) : (i == season ? const Color(0x33FFFFFF) : Colors.transparent),
                  borderRadius: BorderRadius.circular(g.dp(18)),
                ),
                child: Text(
                  '${seasons[i]['name'] ?? ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: tx(g.dp(16), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white, opacity: f || i == season ? 1 : 0.8),
                ),
              ),
            ),
          )
        else if (seasons.length == 1)
          Padding(
            padding: EdgeInsets.only(left: g.side, top: g.dp(8)),
            child: Text('${seasons.first['name'] ?? 'Episodes'}', style: tx(g.dp(18), w: FontWeight.w700)),
          ),
        TvRowView(
          key: ValueKey('season$season'),
          g: g,
          title: '',
          count: eps.length,
          start: next == null ? 0 : eps.indexWhere((e) => e['id'] == next!['id']).clamp(0, eps.length),
          itemW: w,
          itemH: h + g.dp(96),
          builder: (context, i, onFocus) {
            final e = eps[i];
            final p = e['progress'];
            final prog = p is num && p > 0 ? p.toDouble().clamp(0.0, 1.0) : -1.0;
            final name = '${e['title'] ?? ''}';
            final m = RegExp(r'^(\d+)\.\s*(.*)$').firstMatch(name);
            final label = m == null ? 'EPISODE ${i + 1}' : 'EPISODE ${m.group(1)}';
            return HoldFocusable(
              onTap: () => _act(e, 'play'),
              // Holding OK on an episode: Add to Playlist.
              onHold: () => _addToPlaylist(e),
              onFocus: (v) {
                if (v) _in('episodes');
                onFocus(v);
              },
              builder: (context, f) => SizedBox(
                width: w,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AnimatedScale(
                      scale: f ? 1.06 : 1,
                      duration: const Duration(milliseconds: 160),
                      child: Container(
                        width: w,
                        height: h,
                        clipBehavior: Clip.antiAlias,
                        foregroundDecoration: f
                            ? BoxDecoration(
                                borderRadius: BorderRadius.circular(g.dp(14)),
                                border: Border.all(color: const Color(0xE6FFFFFF), width: g.dp(2)),
                              )
                            : null,
                        decoration: BoxDecoration(color: const Color(0xFF26262C), borderRadius: BorderRadius.circular(g.dp(14))),
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            TvImage('${e['thumb'] ?? ''}', width: w, height: h),
                            if (prog > 0)
                              Positioned(
                                left: g.dp(10),
                                right: g.dp(10),
                                bottom: g.dp(9),
                                child: Container(
                                  height: g.dp(4),
                                  alignment: Alignment.centerLeft,
                                  decoration: BoxDecoration(color: const Color(0x59FFFFFF), borderRadius: BorderRadius.circular(g.dp(2))),
                                  child: FractionallySizedBox(
                                    widthFactor: prog,
                                    child: Container(decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(g.dp(2)))),
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                    SizedBox(height: g.dp(12)),
                    Text(prog >= 1 ? '$label · WATCHED' : label, style: tx(g.dp(13), w: FontWeight.w700, opacity: 0.6)),
                    SizedBox(height: g.dp(3)),
                    Text(m?.group(2) ?? name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(17), w: FontWeight.w700)),
                    SizedBox(height: g.dp(4)),
                    Text('${e['overview'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(14), w: FontWeight.w400, opacity: 0.7, height: 1.4)),
                  ],
                ),
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _similar(TvGeo g) => TvRowView(
    g: g,
    title: 'More Like This',
    count: similar.length,
    itemW: g.wideW,
    itemH: g.wideH,
    builder: (context, i, onFocus) => WideCard(
      item: similar[i],
      g: g,
      onFocus: (v) {
        if (v) _in('similar');
        onFocus(v);
      },
      onTap: () => _open(similar[i]),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF111116),
      child: LayoutBuilder(
        builder: (context, c) {
          final g = TvGeo(c.maxWidth, c.maxHeight);
          final series = seasons.isNotEmpty;
          // A film's page fits on one screen: the facts at the top, More Like This at the bottom.
          final rowH = g.rowHeight(true);
          final parts = <Widget>[
            if (series) ...[_info_(g), SizedBox(height: g.dp(18)), _episodes_(g)] else SizedBox(height: g.h - rowH - g.dp(24), child: Align(alignment: Alignment.topLeft, child: _info_(g))),
            if (similar.isNotEmpty) _similar(g),
          ];
          return FocusTraversalGroup(
            policy: tvTraversal,
            child: Stack(
              children: [
                Positioned.fill(child: TvBackdrop(url: item.backdrop.isNotEmpty ? item.backdrop : item.poster, g: g, dim: moved ? 0.82 : (series ? 0.25 : 0))),
                Positioned.fill(
                  child: TvColumn(
                    g: g,
                    free: series ? parts.length - 1 : parts.length,
                    bottom: g.dp(24),
                    onAt: (i) => setState(() => moved = series && similar.isNotEmpty && i == parts.length - 1),
                    children: parts,
                  ),
                ),
                Positioned(
                  left: g.dp(22),
                  top: g.dp(30),
                  child: TvCapsule(g: g, icon: widget.sectionIcon, label: widget.section, onTap: () => Navigator.of(context).maybePop()),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
