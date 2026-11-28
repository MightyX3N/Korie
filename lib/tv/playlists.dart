part of 'tv.dart';

/// Playlists in Korie TV: the profile's playlists as cards (four pictures each), then New
/// Playlist. OK opens one; holding OK renames or deletes it.
class _PlaylistsView extends StatefulWidget {
  const _PlaylistsView({super.key, required this.g});
  final TvGeo g;
  @override
  State<_PlaylistsView> createState() => _PlaylistsViewState();
}

class _PlaylistsViewState extends State<_PlaylistsView> implements _Reloadable {
  final firstCard = FocusNode(debugLabel: 'playlists.first');
  Playlists get pl => Playlists.instance;

  @override
  void initState() {
    super.initState();
    pl.addListener(_changed);
  }

  @override
  void dispose() {
    pl.removeListener(_changed);
    firstCard.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  FutureOr<void> reload() {
    _changed();
  }

  @override
  void focusFirst({bool onlyIfLost = false}) {
    if (!mounted || !(ModalRoute.of(context)?.isCurrent ?? true)) return; // a page or the player is above
    final f = FocusManager.instance.primaryFocus;
    if (onlyIfLost && f?.context?.findAncestorStateOfType<_PlaylistsViewState>() == this) return;
    firstCard.requestFocus();
  }

  Future<void> _new() async {
    final name = await askText(context, title: 'New Playlist', hint: 'Name', done: 'Make');
    if (name == null || name.trim().isEmpty || !mounted) return;
    final p = pl.create(name.trim());
    _open(p);
  }

  /// The playlist's cover from the art of what is in it: one fills it, two side by side, three
  /// with one large, four in a grid.
  Widget _cover(List<String> pics, double card) {
    Widget pic(int k, double w, double h) => TvImage(pics[k], width: w, height: h);
    final half = card / 2;
    return switch (pics.length) {
      1 => pic(0, card, card),
      2 => Row(children: [for (var k = 0; k < 2; k++) SizedBox(width: half, height: card, child: pic(k, half, card))]),
      3 => Row(
        children: [
          SizedBox(width: half, height: card, child: pic(0, half, card)),
          Column(children: [for (var k = 1; k < 3; k++) SizedBox(width: half, height: half, child: pic(k, half, half))]),
        ],
      ),
      _ => Column(
        children: [
          for (var r = 0; r < 2; r++)
            Row(children: [for (var k = r * 2; k < r * 2 + 2; k++) SizedBox(width: half, height: half, child: pic(k, half, half))]),
        ],
      ),
    };
  }

  void _open(Playlist p) => Navigator.of(context).push(
    PageRouteBuilder(pageBuilder: (_, _, _) => _PlaylistPage(playlist: p), transitionDuration: Duration.zero, reverseTransitionDuration: Duration.zero),
  );

  Future<void> _options(Playlist p) async {
    final pick = await askChoice(context, title: p.name, choices: const ['Rename', 'Delete']);
    if (!mounted) return;
    if (pick == 0) {
      final name = await askText(context, title: 'Rename', value: p.name, done: 'Save');
      if (name != null && name.trim().isNotEmpty) pl.rename(p, name.trim());
    } else if (pick == 1) {
      final sure = await askChoice(context, title: 'Delete ${p.name}?', message: 'The films and episodes stay in their add-ons.', choices: const ['Delete', 'Cancel']);
      if (sure == 0) pl.delete(p);
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    final lists = pl.lists;
    final card = g.dp(250);
    return TvColumn(
      g: g,
      children: [
        SizedBox(height: g.top - g.dp(10)),
        TvRowView(
          g: g,
          title: 'Your Playlists',
          count: lists.length + 1,
          itemW: card,
          itemH: card + g.dp(62),
          builder: (context, i, onFocus) {
            if (i == lists.length) {
              return Focusable(
                focusNode: i == 0 ? firstCard : null,
                onFocus: onFocus,
                onTap: _new,
                builder: (context, f) => Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    AnimatedScale(
                      scale: f ? 1.06 : 1,
                      duration: const Duration(milliseconds: 150),
                      child: Container(
                        width: card,
                        height: card,
                        decoration: BoxDecoration(
                          color: f ? const Color(0xFFF2F2F4) : Colors.transparent,
                          borderRadius: BorderRadius.circular(g.dp(18)),
                          border: Border.all(color: f ? Colors.white : const Color(0x40FFFFFF), width: g.dp(2)),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(Icons.add_rounded, size: g.dp(32), color: f ? const Color(0xFF111114) : Colors.white),
                            SizedBox(height: g.dp(8)),
                            Text('New Playlist', style: tx(g.dp(16), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white)),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              );
            }
            final p = lists[i];
            final pics = [for (final e in p.items) if (e.image.isNotEmpty) e.image].take(4).toList();
            final total = p.items.length;
            return HoldFocusable(
              focusNode: i == 0 ? firstCard : null,
              onFocus: onFocus,
              onTap: () => _open(p),
              onHold: () => _options(p),
              builder: (context, f) => Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedScale(
                    scale: f ? 1.06 : 1,
                    duration: const Duration(milliseconds: 150),
                    child: Container(
                      width: card,
                      height: card,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        color: const Color(0xFF26262C),
                        borderRadius: BorderRadius.circular(g.dp(18)),
                        border: f ? Border.all(color: Colors.white, width: g.dp(2)) : null,
                        boxShadow: f ? [BoxShadow(color: const Color(0x99000000), blurRadius: g.dp(30), offset: Offset(0, g.dp(14)))] : null,
                      ),
                      child: pics.isEmpty
                          ? Icon(Icons.playlist_play_rounded, size: g.dp(64), color: const Color(0x66FFFFFF))
                          : _cover(pics, card),
                    ),
                  ),
                  SizedBox(height: g.dp(10)),
                  Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(17), w: FontWeight.w700)),
                  Text(total == 1 ? '1 item' : '$total items', style: tx(g.dp(14), opacity: 0.6)),
                ],
              ),
            );
          },
        ),
        Padding(
          padding: EdgeInsets.only(left: g.side, top: g.dp(10)),
          child: Text(
            lists.isEmpty
                ? 'Add films and episodes with Add to Playlist on their page (on an episode: hold OK). Each profile has its own playlists.'
                : 'OK opens a playlist  ·  Hold OK: rename or delete  ·  Each profile has its own',
            style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.55),
          ),
        ),
      ],
    );
  }
}

/// One playlist: Play, Shuffle, and its films and episodes in order. OK on one plays from it;
/// holding OK moves it or takes it out.
class _PlaylistPage extends StatefulWidget {
  const _PlaylistPage({required this.playlist});
  final Playlist playlist;
  @override
  State<_PlaylistPage> createState() => _PlaylistPageState();
}

class _PlaylistPageState extends State<_PlaylistPage> {
  Playlist get p => widget.playlist;
  Playlists get pl => Playlists.instance;
  final first = FocusNode(debugLabel: 'playlist.play');

  @override
  void initState() {
    super.initState();
    pl.addListener(_changed);
  }

  @override
  void dispose() {
    pl.removeListener(_changed);
    first.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _options(int i) async {
    final e = p.items[i];
    final pick = await askChoice(context, title: e.sub.isEmpty ? e.title : '${e.title} · ${e.sub}', choices: const ['Move Earlier', 'Move Later', 'Take Out of the Playlist']);
    if (pick == 0) pl.move(p, i, -1);
    if (pick == 1) pl.move(p, i, 1);
    if (pick == 2) pl.remove(p, i);
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF111116),
      child: LayoutBuilder(
        builder: (context, c) {
          final g = TvGeo(c.maxWidth, c.maxHeight);
          final w = g.dp(300), h = g.dp(169);
          return FocusTraversalGroup(
            policy: tvTraversal,
            child: Stack(
              children: [
                TvColumn(
                  g: g,
                  children: [
                    Padding(
                      padding: EdgeInsets.only(left: g.side, top: g.dp(110)),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(48), w: FontWeight.w800, spacing: -g.dp(1))),
                          SizedBox(height: g.dp(6)),
                          Text(p.items.length == 1 ? '1 item' : '${p.items.length} items, played in this order', style: tx(g.dp(16), w: FontWeight.w600, opacity: 0.7)),
                          SizedBox(height: g.dp(20)),
                          if (p.items.isNotEmpty)
                            Wrap(
                              spacing: g.dp(14),
                              children: [
                                TvPill(g: g, label: 'Play', icon: Icons.play_arrow_rounded, focusNode: first, autofocus: true, onTap: () => PlayQueue.instance.start(p)),
                                TvPill(g: g, label: 'Shuffle', icon: Icons.shuffle_rounded, onTap: () => PlayQueue.instance.start(p, shuffle: true)),
                              ],
                            )
                          else
                            Text('Empty: add films and episodes with Add to Playlist on their page.', style: tx(g.dp(16), opacity: 0.7)),
                        ],
                      ),
                    ),
                    if (p.items.isNotEmpty) SizedBox(height: g.dp(24)),
                    if (p.items.isNotEmpty)
                      TvRowView(
                        g: g,
                        title: '',
                        count: p.items.length,
                        itemW: w,
                        itemH: h + g.dp(70),
                        builder: (context, i, onFocus) {
                          final e = p.items[i];
                          return HoldFocusable(
                            onFocus: onFocus,
                            onTap: () => PlayQueue.instance.start(p, from: i),
                            onHold: () => _options(i),
                            builder: (context, f) => SizedBox(
                              width: w,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  AnimatedScale(
                                    scale: f ? 1.06 : 1,
                                    duration: const Duration(milliseconds: 150),
                                    child: Container(
                                      width: w,
                                      height: h,
                                      clipBehavior: Clip.antiAlias,
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF26262C),
                                        borderRadius: BorderRadius.circular(g.dp(14)),
                                        border: f ? Border.all(color: Colors.white, width: g.dp(2)) : null,
                                      ),
                                      child: e.image.isEmpty ? null : TvImage(e.image, width: w, height: h),
                                    ),
                                  ),
                                  SizedBox(height: g.dp(10)),
                                  Text('${i + 1}. ${e.title}', maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(16), w: FontWeight.w700)),
                                  if (e.sub.isNotEmpty) Text(e.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(14), opacity: 0.6)),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    Padding(
                      padding: EdgeInsets.only(left: g.side, top: g.dp(6), bottom: g.dp(30)),
                      child: Text('OK plays from there  ·  Hold OK: move it or take it out', style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.55)),
                    ),
                  ],
                ),
                Positioned(
                  left: g.dp(22),
                  top: g.dp(30),
                  child: TvCapsule(g: g, icon: Icons.playlist_play_rounded, label: 'Playlists', onTap: () => Navigator.of(context).maybePop()),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
