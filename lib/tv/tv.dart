import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../store.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import 'library.dart';
import 'title.dart';
import '../player/playlists.dart';
import 'widgets.dart';

part 'playlists.dart';

/// Korie TV: one place for everything add-ons give to watch, like Apple's TV app. The capsule
/// top left names the section; Left from the content (or OK on the capsule, or Back) opens the
/// sidebar: Search, Home, Movies, Series, then sections add-ons add. Back in the sidebar leaves.
class KorieTv extends StatefulWidget {
  const KorieTv({super.key, required this.store, this.page = 'home'});
  final Store store;
  final String page;
  @override
  State<KorieTv> createState() => _KorieTvState();
}

class _Entry {
  const _Entry(this.page, this.title, this.icon);
  final String page, title, icon;
}

class _KorieTvState extends State<KorieTv> {
  final library = TvLibrary(AddonHost.instance);
  late String page = widget.page;
  List<TvSection> sections = [];
  bool sidebar = false;
  final strip = FocusNode(debugLabel: 'tv.strip', skipTraversal: false);
  final back = FocusNode(debugLabel: 'tv.back');

  /// Where the focus was on the page, to go back to when the sidebar closes.
  FocusNode? _was;
  void _track() {
    final f = FocusManager.instance.primaryFocus;
    final st = f?.context?.findAncestorStateOfType<State>();
    if (f == null || f.context == null || st == null) return;
    if (f.context!.findAncestorStateOfType<_PageViewState>() != null || f.context!.findAncestorStateOfType<_PageViewStateSearch>() != null || f.context!.findAncestorStateOfType<_PlaylistsViewState>() != null) _was = f;
  }
  final capsule = FocusNode(debugLabel: 'tv.capsule');
  final Map<String, FocusNode> sideNodes = {};
  final pageKey = GlobalKey();
  _Reloadable? get view => pageKey.currentState as _Reloadable?;
  StreamSubscription? _updates;

  List<_Entry> get entries => [
    const _Entry('search', 'Search', 'search'),
    const _Entry('home', 'Home', 'home'),
    const _Entry('movies', 'Movies', 'movies'),
    const _Entry('series', 'Series', 'series'),
    const _Entry('playlists', 'Playlists', 'playlist'),
    for (final s in sections) _Entry(s.page, s.title, s.icon),
  ];

  _Entry get current => entries.firstWhere((e) => e.page == page, orElse: () => const _Entry('home', 'Home', 'home'));

  FocusNode sideNode(String p) => sideNodes.putIfAbsent(p, () => FocusNode(debugLabel: 'tv.side.$p'));

  @override
  void initState() {
    super.initState();
    library.sections().then((v) {
      if (mounted) setState(() => sections = v);
    });
    AddonHost.instance.addListener(_hostChanged);
    FocusManager.instance.addListener(_track);
    _updates = AddonHost.instance.updates.stream.listen((u) {
      if (u.what == 'home' || u.what == 'tv') view?.reload();
    });
  }

  @override
  void dispose() {
    AddonHost.instance.removeListener(_hostChanged);
    FocusManager.instance.removeListener(_track);
    _updates?.cancel();
    strip.dispose();
    back.dispose();
    capsule.dispose();
    for (final n in sideNodes.values) {
      n.dispose();
    }
    super.dispose();
  }

  void _hostChanged() => view?.reload();

  void openSidebar() {
    setState(() => sidebar = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) sideNode(current.page).requestFocus();
    });
  }

  void closeSidebar() {
    if (!sidebar) return;
    setState(() => sidebar = false);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final w = _was;
      if (w != null && w.context != null && w.canRequestFocus) {
        w.requestFocus();
      } else {
        view?.focusFirst();
      }
    });
  }

  void go(String p) {
    _was = null;
    setState(() {
      page = p;
      sidebar = false;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => view?.focusFirst());
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: sidebar,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) openSidebar();
      },
      child: Material(
        color: const Color(0xFF111116),
        child: LayoutBuilder(
          builder: (context, c) {
            final g = TvGeo(c.maxWidth, c.maxHeight);
            return FocusTraversalGroup(
              policy: tvTraversal,
              child: Stack(
                children: [
                  Positioned.fill(
                    child: ExcludeFocus(
                      excluding: sidebar,
                      child: page == 'search'
                          ? _SearchView(key: pageKey, g: g, library: library, entry: current)
                          : page == 'playlists'
                          ? _PlaylistsView(key: pageKey, g: g)
                          : _PageView(key: pageKey, g: g, library: library, entry: current),
                    ),
                  ),
                  // Left from anything at the left edge lands here, which opens the sidebar.
                  Positioned(
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: g.dp(10),
                    child: Focus(
                      focusNode: strip,
                      canRequestFocus: !sidebar,
                      onFocusChange: (v) {
                        if (v) openSidebar();
                      },
                      child: const SizedBox.expand(),
                    ),
                  ),
                  Positioned(
                    left: g.dp(22),
                    top: g.dp(30),
                    child: ExcludeFocus(
                      excluding: sidebar,
                      child: TvCapsule(g: g, icon: tvIcon(current.icon), label: current.title, focusNode: capsule, onTap: openSidebar),
                    ),
                  ),
                  if (sidebar) ...[
                    Positioned.fill(
                      child: GestureDetector(onTap: closeSidebar, child: const ColoredBox(color: Color(0x73000000))),
                    ),
                    Positioned(left: g.dp(22), top: g.dp(24), bottom: g.dp(24), width: g.dp(250), child: _sidebar(g)),
                    // Right from the sidebar lands here, which closes it.
                    Positioned(
                      left: g.dp(282),
                      top: 0,
                      bottom: 0,
                      width: g.dp(10),
                      child: Focus(
                        focusNode: back,
                        onFocusChange: (v) {
                          if (v) closeSidebar();
                        },
                        child: const SizedBox.expand(),
                      ),
                    ),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _sidebar(TvGeo g) {
    final profile = widget.store.current;
    final own = entries.take(5).toList();
    final more = entries.skip(5).toList();
    Widget row(_Entry e) => Focusable(
      focusNode: sideNode(e.page),
      onTap: () => go(e.page),
      builder: (context, f) {
        final sel = e.page == page;
        final c = f ? const Color(0xFF111114) : Colors.white;
        return Container(
          height: g.dp(46),
          margin: EdgeInsets.only(bottom: g.dp(4)),
          padding: EdgeInsets.symmetric(horizontal: g.dp(16)),
          decoration: BoxDecoration(
            color: f ? const Color(0xFFF2F2F4) : (sel ? const Color(0x24FFFFFF) : Colors.transparent),
            borderRadius: BorderRadius.circular(g.dp(23)),
          ),
          child: Row(
            children: [
              Icon(tvIcon(e.icon), size: g.dp(21), color: c),
              SizedBox(width: g.dp(14)),
              Expanded(child: Text(e.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(17), w: FontWeight.w600, color: c))),
            ],
          ),
        );
      },
    );
    return Focus(
      canRequestFocus: false,
      skipTraversal: true,
      onFocusChange: (v) {
        // The focus left the sidebar some other way (a touch on the page): it closes.
        if (!v && sidebar && FocusManager.instance.primaryFocus != back) closeSidebar();
      },
      child: Container(
        padding: EdgeInsets.fromLTRB(g.dp(10), g.dp(14), g.dp(10), g.dp(14)),
        decoration: BoxDecoration(
          color: const Color(0xF02C2C32),
          borderRadius: BorderRadius.circular(g.dp(26)),
          border: Border.all(color: const Color(0x24FFFFFF)),
          boxShadow: [BoxShadow(color: const Color(0x80000000), blurRadius: g.dp(40))],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(g.dp(10), g.dp(4), g.dp(10), g.dp(14)),
              child: Row(
                children: [
                  Avatar(profile: profile, size: g.dp(32)),
                  SizedBox(width: g.dp(10)),
                  Expanded(child: Text(profile.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(16), w: FontWeight.w700))),
                  Clock(style: tx(g.dp(14), opacity: 0.6)),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final e in own) row(e),
                    if (more.isNotEmpty) ...[
                      Padding(
                        padding: EdgeInsets.fromLTRB(g.dp(16), g.dp(14), g.dp(16), g.dp(6)),
                        child: Text('From your add-ons', style: tx(g.dp(13), w: FontWeight.w600, opacity: 0.5)),
                      ),
                      for (final e in more) row(e),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

void _openTitle(BuildContext context, TvLibrary library, TvItem item, _Entry entry) => Navigator.of(context).push(
  PageRouteBuilder(
    pageBuilder: (_, _, _) => TvTitle(item: item, library: library, section: entry.title, sectionIcon: tvIcon(entry.icon)),
    transitionDuration: Duration.zero,
    reverseTransitionDuration: Duration.zero,
  ),
);

/// One section's page: featured pictures, then rows.
class _PageView extends StatefulWidget {
  const _PageView({super.key, required this.g, required this.library, required this.entry});
  final TvGeo g;
  final TvLibrary library;
  final _Entry entry;
  @override
  State<_PageView> createState() => _PageViewState();
}

class _PageViewState extends State<_PageView> implements _Reloadable {
  TvPage? data;
  String? loadedFor;
  int feat = 0;
  int at = 0;
  bool heroFocused = false;
  Timer? _turn;
  final first = FocusNode(debugLabel: 'tv.first');
  final firstCard = FocusNode(debugLabel: 'tv.firstCard');
  final column = GlobalKey<TvColumnState>();
  int _ticket = 0;

  /// The page was opened from the sidebar before its rows were there: they take the focus
  /// when they come.
  bool _wantFocus = false;

  @override
  void initState() {
    super.initState();
    reload();
    _turn = Timer.periodic(const Duration(seconds: 9), (_) {
      final f = data?.featured ?? const [];
      if (!heroFocused && at == 0 && f.length > 1 && mounted) setState(() => feat = (feat + 1) % f.length);
    });
  }

  @override
  void didUpdateWidget(_PageView old) {
    super.didUpdateWidget(old);
    if (old.entry.page != widget.entry.page) {
      setState(() {
        data = null;
        feat = 0;
        at = 0;
      });
      reload();
    }
  }

  @override
  void dispose() {
    _turn?.cancel();
    first.dispose();
    firstCard.dispose();
    super.dispose();
  }

  @override
  Future<void> reload() async {
    final ticket = ++_ticket;
    final p = widget.entry.page;
    final v = await widget.library.page(p);
    if (!mounted || ticket != _ticket || p != widget.entry.page) return;
    final firstLoad = loadedFor != p;
    setState(() {
      data = v;
      loadedFor = p;
      if (feat >= v.featured.length) feat = 0;
    });
    if (firstLoad || _wantFocus) WidgetsBinding.instance.addPostFrameCallback((_) => focusFirst(onlyIfLost: !_wantFocus));
  }

  /// The featured picture's Play, or the first card.
  @override
  void focusFirst({bool onlyIfLost = false}) {
    if (!mounted) return;
    // Under the player (or any page above Korie TV): its focus is not ours to take.
    if (!(ModalRoute.of(context)?.isCurrent ?? true)) return;
    final tv = context.findAncestorStateOfType<_KorieTvState>();
    final f = FocusManager.instance.primaryFocus;
    if (onlyIfLost && f != null && f.context != null && f.context!.findAncestorStateOfType<_PageViewState>() == this) return;
    if (onlyIfLost && (tv?.sidebar ?? false)) return;
    if (data == null) {
      _wantFocus = true;
      return;
    }
    _wantFocus = false;
    if (data!.featured.isNotEmpty) {
      first.requestFocus();
    } else if (data?.rows.isNotEmpty ?? false) {
      firstCard.requestFocus();
    } else {
      // Nothing to show: the capsule takes the focus (OK on it opens the sidebar).
      tv?.capsule.requestFocus();
    }
  }

  void _open(TvItem it) => _openTitle(context, widget.library, it, widget.entry);

  Widget _hero(TvGeo g, TvItem it, double height) {
    final f = data!.featured;
    final where = it.sources.map((s) => s.name).toSet().join(' and ');
    return SizedBox(
      height: height,
      child: Stack(
        children: [
          Positioned(
            left: g.side,
            bottom: g.dp(f.length > 1 ? 52 : 30),
            width: g.dp(600),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(it.title, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(62), w: FontWeight.w800, height: 1.02, spacing: -g.dp(1.6))),
                SizedBox(height: g.dp(14)),
                Text(it.meta, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(16), w: FontWeight.w600, opacity: 0.9)),
                if (it.overview.isNotEmpty) ...[
                  SizedBox(height: g.dp(10)),
                  SizedBox(
                    width: g.dp(540),
                    child: Text(it.overview, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(g.dp(16), w: FontWeight.w400, opacity: 0.85, height: 1.45)),
                  ),
                ],
                if (where.isNotEmpty) ...[SizedBox(height: g.dp(8)), Text('On $where', style: tx(g.dp(15), w: FontWeight.w600, opacity: 0.7))],
                SizedBox(height: g.dp(18)),
                Focus(
                  canRequestFocus: false,
                  skipTraversal: true,
                  onFocusChange: (v) => setState(() => heroFocused = v),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TvPill(g: g, label: it.progress > 0 ? 'Resume' : 'Play', icon: Icons.play_arrow_rounded, focusNode: first, onTap: () => TvActions.play(it)),
                      SizedBox(width: g.dp(14)),
                      TvRound(g: g, icon: Icons.info_outline_rounded, onTap: () => _open(it)),
                      if (f.length > 1) ...[
                        SizedBox(width: g.dp(14)),
                        TvRound(g: g, icon: Icons.chevron_right_rounded, onTap: () => setState(() => feat = (feat + 1) % f.length)),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (f.length > 1)
            Positioned(
              left: 0,
              right: 0,
              bottom: g.dp(10),
              child: Center(
                child: Container(
                  padding: EdgeInsets.symmetric(horizontal: g.dp(10), vertical: g.dp(7)),
                  decoration: BoxDecoration(color: const Color(0x8028282E), borderRadius: BorderRadius.circular(g.dp(10))),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (var i = 0; i < f.length; i++)
                        AnimatedContainer(
                          duration: const Duration(milliseconds: 250),
                          width: g.dp(i == feat ? 16 : 6),
                          height: g.dp(6),
                          margin: EdgeInsets.symmetric(horizontal: g.dp(3)),
                          decoration: BoxDecoration(color: i == feat ? Colors.white : const Color(0x73FFFFFF), borderRadius: BorderRadius.circular(g.dp(3))),
                        ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _row(TvGeo g, TvRow r, bool firstRow) => TvRowView(
    g: g,
    title: r.title,
    count: r.items.length,
    itemW: r.square ? g.squareW : (r.wide ? g.wideW : g.posterW),
    itemH: r.square ? g.squareH : (r.wide ? g.wideH : g.posterH),
    builder: (context, i, onFocus) {
      final it = r.items[i];
      final node = firstRow && i == 0 ? firstCard : null;
      // A logo plays at once (a station); there is no page to open for it.
      if (r.square) return SquareCard(item: it, g: g, focusNode: node, onFocus: onFocus, onTap: () => TvActions.play(it));
      if (r.wide) {
        return WideCard(
          item: it,
          g: g,
          focusNode: node,
          onFocus: onFocus,
          onTap: r.resume ? () => TvActions.play(it) : () => _open(it),
          onHold: r.resume ? () => _open(it) : null,
        );
      }
      return PosterCard(item: it, g: g, focusNode: node, onFocus: onFocus, onTap: () => _open(it));
    },
  );

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    final d = data;
    if (d == null) return const SizedBox.expand();
    if (d.isEmpty) {
      return Center(
        child: SizedBox(
          width: g.dp(520),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Nothing here yet', style: tx(g.dp(28), w: FontWeight.w800)),
              SizedBox(height: g.dp(10)),
              Text(
                widget.entry.page.contains('/')
                    ? '${widget.entry.title} has nothing to show yet. Is the TV online? Its settings are in Korie Settings → Add-ons.'
                    : 'Add-ons fill Korie TV: sign in to Jellyfin, or get more add-ons in Korie Settings → Add-ons. Press Left for the sidebar.',
                textAlign: TextAlign.center,
                style: tx(g.dp(16), w: FontWeight.w400, opacity: 0.75, height: 1.4),
              ),
            ],
          ),
        ),
      );
    }
    final f = d.featured;
    final it = f.isEmpty ? null : f[feat.clamp(0, f.length - 1)];
    // The featured picture fills the screen above the first row, which shows whole below it.
    final firstH = d.rows.isEmpty ? 0.0 : g.rowHeight(d.rows.first.wide, square: d.rows.first.square);
    final heroH = (g.h - firstH - g.dp(30)).clamp(g.dp(330), g.h);
    final parts = <Widget>[
      // Without a featured picture the first row starts where rows stop when the page moves.
      if (it != null) _hero(g, it, heroH) else SizedBox(height: g.top),
      for (final (i, r) in d.rows.indexed) _row(g, r, i == 0),
    ];
    final moved = at >= 2;
    return Stack(
      children: [
        Positioned.fill(child: TvBackdrop(url: it?.backdrop ?? '', g: g, dim: moved ? 0.82 : 0)),
        Positioned.fill(
          child: TvColumn(
            key: column,
            g: g,
            free: 2,
            bottom: g.dp(40),
            onAt: (i) => setState(() => at = i),
            children: parts,
          ),
        ),
      ],
    );
  }
}

/// Search: a box at the top (OK types), and posters of what matches below.
class _SearchView extends StatefulWidget {
  const _SearchView({super.key, required this.g, required this.library, required this.entry});
  final TvGeo g;
  final TvLibrary library;
  final _Entry entry;
  @override
  State<_SearchView> createState() => _PageViewStateSearch();
}

class _PageViewStateSearch extends State<_SearchView> implements _Reloadable {
  String text = '';
  List<TvItem> found = [];
  bool searched = false;
  final box = FocusNode(debugLabel: 'tv.searchbox');
  final firstResult = FocusNode(debugLabel: 'tv.firstResult');

  @override
  void dispose() {
    box.dispose();
    firstResult.dispose();
    super.dispose();
  }

  @override
  FutureOr<void> reload() {}

  @override
  void focusFirst({bool onlyIfLost = false}) => box.requestFocus();

  Future<void> _type() async {
    final t = await askText(context, title: 'Search', value: text, hint: 'Films, series and more', done: 'Search');
    if (t == null || !mounted) return;
    final v = await widget.library.search(t);
    if (!mounted) return;
    setState(() {
      text = t;
      found = v;
      searched = true;
    });
    // The first result takes the focus; with nothing found the box keeps it, to type again.
    WidgetsBinding.instance.addPostFrameCallback((_) => (v.isEmpty ? box : firstResult).requestFocus());
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    List<List<TvItem>> lines(List<TvItem> l, double w) {
      final per = ((g.w - 2 * g.side + g.gap) / (w + g.gap)).floor().clamp(1, 30);
      return [for (var i = 0; i < l.length; i += per) l.sublist(i, (i + per).clamp(0, l.length))];
    }

    final titles = lines(found.where((i) => i.isMovie || i.isSeries).toList(), g.posterW);
    final other = lines(found.where((i) => !i.isMovie && !i.isSeries).toList(), g.squareW);
    final parts = <Widget>[
      Padding(
        padding: EdgeInsets.fromLTRB(g.side, g.top, g.side, g.dp(10)),
        child: Focusable(
          focusNode: box,
          onTap: _type,
          builder: (context, f) => Container(
            height: g.dp(56),
            padding: EdgeInsets.symmetric(horizontal: g.dp(20)),
            decoration: BoxDecoration(
              color: f ? Colors.white : const Color(0x1FFFFFFF),
              borderRadius: BorderRadius.circular(g.dp(28)),
              border: Border.all(color: f ? Colors.white : const Color(0x1FFFFFFF)),
            ),
            child: Row(
              children: [
                Icon(Icons.search_rounded, size: g.dp(24), color: f ? const Color(0xFF111114) : Colors.white70),
                SizedBox(width: g.dp(12)),
                Expanded(
                  child: Text(
                    text.isEmpty ? 'Films, series and more' : text,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: tx(g.dp(19), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white, opacity: text.isEmpty ? 0.6 : 1),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      if (searched && found.isEmpty)
        Padding(
          padding: EdgeInsets.fromLTRB(g.side, g.dp(20), g.side, 0),
          child: Text('Nothing found for “$text”', style: tx(g.dp(18), opacity: 0.7)),
        ),
      for (final (n, line) in titles.indexed)
        TvRowView(
          g: g,
          title: n == 0 ? 'Films and Series' : '',
          count: line.length,
          itemW: g.posterW,
          itemH: g.posterH,
          builder: (context, i, onFocus) => PosterCard(
            item: line[i],
            g: g,
            focusNode: n == 0 && i == 0 ? firstResult : null,
            onFocus: onFocus,
            onTap: () => _openTitle(context, widget.library, line[i], widget.entry),
          ),
        ),
      for (final (n, line) in other.indexed)
        TvRowView(
          g: g,
          title: n == 0 ? (titles.isEmpty ? 'Results' : 'More') : '',
          count: line.length,
          itemW: g.squareW,
          itemH: g.squareH,
          builder: (context, i, onFocus) => SquareCard(
            item: line[i],
            g: g,
            focusNode: titles.isEmpty && n == 0 && i == 0 ? firstResult : null,
            onFocus: onFocus,
            onTap: () => TvActions.play(line[i]),
          ),
        ),
    ];
    return Stack(
      children: [
        const Positioned.fill(child: ColoredBox(color: Color(0xFF111116))),
        Positioned.fill(child: TvColumn(g: g, free: 2, bottom: g.dp(40), children: parts)),
      ],
    );
  }
}

abstract class _Reloadable {
  FutureOr<void> reload();
  void focusFirst({bool onlyIfLost = false});
}
