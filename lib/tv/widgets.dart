import 'dart:io';

import 'package:material_ui/material_ui.dart';

import '../ui/common.dart';
import 'library.dart';

/// Korie TV's sizes, drawn on a 1280 x 720 design and scaled to the screen's height. Rows scroll
/// sideways, so a wider screen simply shows more of each row.
class TvGeo {
  TvGeo(double width, double height)
    : w = width.isFinite && width >= 100 ? width : 1280,
      h = height.isFinite && height >= 100 ? height : 720 {
    u = h / 720;
  }
  final double w, h;
  late final double u;
  double dp(double v) => v * u;

  double get side => dp(54);

  /// Where a row's title sits when the page has moved down to it: below the capsule.
  double get top => dp(96);

  double get posterW => dp(148);
  double get posterH => dp(222);
  double get wideW => dp(214);
  double get wideH => dp(120);
  double get gap => dp(22);

  /// Room above and below the cards for the focused one's growth and shadow.
  double get padTop => dp(10);
  double get padBottom => dp(16);
  double get rowTitleH => dp(36);

  double get squareW => dp(150);
  double get squareH => squareW + dp(44);

  double rowHeight(bool wide, {bool square = false}) => rowTitleH + padTop + (square ? squareH : (wide ? wideH : posterH)) + padBottom;
}

IconData tvIcon(String name) => switch (name) {
  'search' => Icons.search_rounded,
  'home' => Icons.home_outlined,
  'movies' || 'film' => Icons.movie_outlined,
  'series' || 'tv' => Icons.tv_rounded,
  'live' => Icons.sensors_rounded,
  'radio' => Icons.radio_rounded,
  'music' => Icons.music_note_rounded,
  'star' => Icons.star_outline_rounded,
  'sport' => Icons.sports_soccer_rounded,
  'kids' => Icons.child_care_rounded,
  'news' => Icons.newspaper_rounded,
  'podcast' => Icons.podcasts_rounded,
  'book' => Icons.menu_book_rounded,
  'game' => Icons.sports_esports_outlined,
  'playlist' => Icons.playlist_play_rounded,
  _ => Icons.list_rounded,
};

/// A picture from the web or from an add-on's folder, dark until it is there.
class TvImage extends StatelessWidget {
  const TvImage(this.url, {super.key, required this.width, required this.height, this.fit = BoxFit.cover, this.fallback});
  final String url;
  final double width, height;
  final BoxFit fit;
  final Widget? fallback;

  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final empty = SizedBox(width: width, height: height, child: fallback);
    if (url.isEmpty) return empty;
    final cw = (width * dpr).round();
    Widget err(BuildContext _, Object _, StackTrace? _) => empty;
    Widget frame(BuildContext _, Widget child, int? f, bool sync) =>
        sync ? child : AnimatedOpacity(opacity: f == null ? 0 : 1, duration: const Duration(milliseconds: 250), child: child);
    if (url.startsWith('http')) {
      return Image.network(url, width: width, height: height, fit: fit, cacheWidth: cw, gaplessPlayback: true, errorBuilder: err, frameBuilder: frame);
    }
    return Image.file(File(url), width: width, height: height, fit: fit, cacheWidth: cw, gaplessPlayback: true, errorBuilder: err, frameBuilder: frame);
  }
}

/// A full-screen picture behind a page, shaded on the left for reading and at the bottom for rows.
class TvBackdrop extends StatelessWidget {
  const TvBackdrop({super.key, required this.url, required this.g, this.dim = 0});
  final String url;
  final TvGeo g;
  final double dim;
  @override
  Widget build(BuildContext context) => Stack(
    fit: StackFit.expand,
    children: [
      const ColoredBox(color: Color(0xFF111116)),
      AnimatedSwitcher(
        duration: const Duration(milliseconds: 450),
        child: url.isEmpty ? const SizedBox.expand() : TvImage(url, key: ValueKey(url), width: g.w, height: g.h),
      ),
      if (url.isNotEmpty) ...[
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [Color(0xC7000000), Color(0x73000000), Color(0x00000000)], stops: [0, 0.29, 0.64]),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x40000000), Color(0x00000000), Color(0x40000000), Color(0xF5111116)],
              stops: [0, 0.3, 0.62, 1],
            ),
          ),
        ),
      ],
      AnimatedContainer(duration: const Duration(milliseconds: 300), color: Color.fromRGBO(17, 17, 22, dim)),
    ],
  );
}

/// The white edge in front of a focused card (its shadow goes behind it: see [_card]).
BoxDecoration _lit(TvGeo g, double radius) => BoxDecoration(
  borderRadius: BorderRadius.circular(radius),
  border: Border.all(color: const Color(0xE6FFFFFF), width: g.dp(2)),
);

/// A card's own background, with a shadow under it while it has the focus.
BoxDecoration _card(TvGeo g, double radius, bool focused, {Gradient? gradient}) => BoxDecoration(
  color: gradient == null ? const Color(0xFF26262C) : null,
  gradient: gradient,
  borderRadius: BorderRadius.circular(radius),
  boxShadow: focused ? [BoxShadow(color: const Color(0x99000000), blurRadius: g.dp(30), offset: Offset(0, g.dp(14)))] : null,
);

/// A tall poster with its genre inside, as in Apple's TV app.
class PosterCard extends StatelessWidget {
  const PosterCard({super.key, required this.item, required this.g, required this.onTap, this.onHold, this.onFocus, this.focusNode, this.autofocus = false});
  final TvItem item;
  final TvGeo g;
  final VoidCallback onTap;
  final VoidCallback? onHold;
  final ValueChanged<bool>? onFocus;
  final FocusNode? focusNode;
  final bool autofocus;

  @override
  Widget build(BuildContext context) {
    final w = g.posterW, h = g.posterH, r = g.dp(16);
    final genre = item.genres.isEmpty ? '' : item.genres.first;
    return HoldFocusable(
      onTap: onTap,
      onHold: onHold,
      onFocus: onFocus,
      focusNode: focusNode,
      autofocus: autofocus,
      builder: (context, f) => AnimatedScale(
        scale: f ? 1.09 : 1,
        duration: const Duration(milliseconds: 160),
        child: Container(
          width: w,
          height: h,
          foregroundDecoration: f ? _lit(g, r) : null,
          decoration: _card(g, r, f),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            fit: StackFit.expand,
            children: [
              TvImage(
                item.poster,
                width: w,
                height: h,
                fallback: Center(
                  child: Padding(
                    padding: EdgeInsets.all(g.dp(12)),
                    child: Text(item.title, textAlign: TextAlign.center, maxLines: 4, overflow: TextOverflow.ellipsis, style: tx(g.dp(17), w: FontWeight.w700)),
                  ),
                ),
              ),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0xB3000000)], stops: [0.7, 1]),
                ),
              ),
              if (genre.isNotEmpty)
                Positioned(
                  left: g.dp(6),
                  right: g.dp(6),
                  bottom: g.dp(10),
                  child: Text(genre, textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(13), w: FontWeight.w600, opacity: 0.9)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A wide card: Continue Watching (with progress and time left) and More Like This.
class WideCard extends StatelessWidget {
  const WideCard({super.key, required this.item, required this.g, required this.onTap, this.onHold, this.onFocus, this.focusNode, this.autofocus = false});
  final TvItem item;
  final TvGeo g;
  final VoidCallback onTap;
  final VoidCallback? onHold;
  final ValueChanged<bool>? onFocus;
  final FocusNode? focusNode;
  final bool autofocus;

  String get line {
    // "S2 E5 · 32m": the episode's number (not its name) and the time left.
    final ep = item.episode.split(' · ').first;
    final number = RegExp(r'^S\d+ ?E\d+$').hasMatch(ep) ? ep : '';
    if (item.remaining > 0) return [if (number.isNotEmpty) number, duration(item.remaining)].join(' · ');
    if (number.isNotEmpty) return number;
    if (item.runtime > 0) return duration(item.runtime);
    if (item.isSeries) return 'Series';
    return item.year;
  }

  @override
  Widget build(BuildContext context) {
    final w = g.wideW, h = g.wideH, r = g.dp(14);
    final p = item.progress;
    return HoldFocusable(
      onTap: onTap,
      onHold: onHold,
      onFocus: onFocus,
      focusNode: focusNode,
      autofocus: autofocus,
      builder: (context, f) => AnimatedScale(
        scale: f ? 1.08 : 1,
        duration: const Duration(milliseconds: 160),
        child: Container(
          width: w,
          height: h,
          foregroundDecoration: f ? _lit(g, r) : null,
          decoration: _card(g, r, f),
          clipBehavior: Clip.antiAlias,
          child: Stack(
            fit: StackFit.expand,
            children: [
              TvImage(item.wide, width: w, height: h),
              const DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x00000000), Color(0xD1000000)], stops: [0.3, 1]),
                ),
              ),
              Positioned(
                left: g.dp(12),
                right: g.dp(12),
                bottom: g.dp(32),
                child: Text(
                  item.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: tx(g.dp(15), w: FontWeight.w800, spacing: -g.dp(0.15)).copyWith(shadows: const [Shadow(color: Color(0x99000000), blurRadius: 6)]),
                ),
              ),
              Positioned(
                left: g.dp(12),
                right: g.dp(12),
                bottom: g.dp(10),
                child: Row(
                  children: [
                    Icon(Icons.play_arrow_rounded, size: g.dp(14), color: Colors.white),
                    SizedBox(width: g.dp(5)),
                    if (p >= 0) ...[
                      Container(
                        width: g.dp(36),
                        height: g.dp(4),
                        decoration: BoxDecoration(color: const Color(0x59FFFFFF), borderRadius: BorderRadius.circular(g.dp(2))),
                        alignment: Alignment.centerLeft,
                        child: FractionallySizedBox(
                          widthFactor: p.clamp(0.04, 1.0),
                          child: Container(decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(g.dp(2)))),
                        ),
                      ),
                      SizedBox(width: g.dp(7)),
                    ],
                    Expanded(child: Text(line, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(13), w: FontWeight.w600, opacity: 0.9))),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A logo (a radio station, a channel) on a square, its name under it.
class SquareCard extends StatelessWidget {
  const SquareCard({super.key, required this.item, required this.g, required this.onTap, this.onFocus, this.focusNode});
  final TvItem item;
  final TvGeo g;
  final VoidCallback onTap;
  final ValueChanged<bool>? onFocus;
  final FocusNode? focusNode;
  @override
  Widget build(BuildContext context) {
    final w = g.squareW, r = g.dp(18);
    final letter = item.title.isEmpty ? '?' : item.title.characters.first.toUpperCase();
    return HoldFocusable(
      onTap: onTap,
      onHold: null,
      onFocus: onFocus,
      focusNode: focusNode,
      builder: (context, f) => SizedBox(
        width: w,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AnimatedScale(
              scale: f ? 1.08 : 1,
              duration: const Duration(milliseconds: 160),
              child: Container(
                width: w,
                height: w,
                padding: EdgeInsets.all(g.dp(18)),
                foregroundDecoration: f ? _lit(g, r) : null,
                decoration: _card(g, r, f, gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF34343C), Color(0xFF232328)])),
                child: TvImage(
                  item.poster,
                  width: w - g.dp(36),
                  height: w - g.dp(36),
                  fit: BoxFit.contain,
                  fallback: Center(child: Text(letter, style: tx(g.dp(48), w: FontWeight.w800, opacity: 0.8))),
                ),
              ),
            ),
            SizedBox(height: g.dp(10)),
            Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(15), w: FontWeight.w600, opacity: f ? 1 : 0.85)),
          ],
        ),
      ),
    );
  }
}

/// A button on a featured picture or a title's page: white when focused, glass otherwise.
class TvPill extends StatelessWidget {
  const TvPill({super.key, required this.g, required this.label, required this.onTap, this.icon, this.sub, this.focusNode, this.autofocus = false, this.onFocus});
  final TvGeo g;
  final String label;
  final String? sub;
  final IconData? icon;
  final VoidCallback onTap;
  final FocusNode? focusNode;
  final bool autofocus;
  final ValueChanged<bool>? onFocus;

  @override
  Widget build(BuildContext context) => Focusable(
    onTap: onTap,
    focusNode: focusNode,
    autofocus: autofocus,
    onFocus: onFocus,
    builder: (context, f) {
      final c = f ? const Color(0xFF111114) : Colors.white;
      return AnimatedScale(
        scale: f ? 1.06 : 1,
        duration: const Duration(milliseconds: 150),
        child: Container(
          height: g.dp(50),
          padding: EdgeInsets.only(left: g.dp(icon == null ? 26 : 22), right: g.dp(26)),
          decoration: BoxDecoration(
            color: f ? Colors.white : const Color(0x29FFFFFF),
            borderRadius: BorderRadius.circular(g.dp(25)),
            border: Border.all(color: f ? Colors.white : const Color(0x1FFFFFFF)),
            boxShadow: f ? [BoxShadow(color: const Color(0x73000000), blurRadius: g.dp(30), offset: Offset(0, g.dp(12)))] : null,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: g.dp(22), color: c), SizedBox(width: g.dp(8))],
              Text(label, style: tx(g.dp(18), w: FontWeight.w700, color: c)),
              if (sub != null && sub!.isNotEmpty) ...[SizedBox(width: g.dp(10)), Text(sub!, style: tx(g.dp(18), w: FontWeight.w500, color: c, opacity: 0.6))],
            ],
          ),
        ),
      );
    },
  );
}

class TvRound extends StatelessWidget {
  const TvRound({super.key, required this.g, required this.icon, required this.onTap, this.onFocus});
  final TvGeo g;
  final IconData icon;
  final VoidCallback onTap;
  final ValueChanged<bool>? onFocus;
  @override
  Widget build(BuildContext context) => Focusable(
    onTap: onTap,
    onFocus: onFocus,
    builder: (context, f) => AnimatedScale(
      scale: f ? 1.1 : 1,
      duration: const Duration(milliseconds: 150),
      child: Container(
        width: g.dp(50),
        height: g.dp(50),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: f ? Colors.white : const Color(0x29FFFFFF),
          border: Border.all(color: f ? Colors.white : const Color(0x1FFFFFFF)),
        ),
        child: Icon(icon, size: g.dp(24), color: f ? const Color(0xFF111114) : Colors.white),
      ),
    ),
  );
}

/// Top left: the section's name on a glass capsule. OK on it opens the sidebar.
class TvCapsule extends StatelessWidget {
  const TvCapsule({super.key, required this.g, required this.icon, required this.label, required this.onTap, this.focusNode});
  final TvGeo g;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final FocusNode? focusNode;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(Icons.chevron_left_rounded, size: g.dp(22), color: Colors.white70),
      SizedBox(width: g.dp(4)),
      Focusable(
        onTap: onTap,
        focusNode: focusNode,
        builder: (context, f) => Container(
          height: g.dp(44),
          padding: EdgeInsets.only(left: g.dp(5), right: g.dp(18)),
          decoration: BoxDecoration(
            color: f ? const Color(0xFFF2F2F4) : const Color(0x8C2A2A30),
            borderRadius: BorderRadius.circular(g.dp(22)),
            border: Border.all(color: f ? Colors.transparent : const Color(0x2EFFFFFF)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: g.dp(34),
                height: g.dp(34),
                decoration: BoxDecoration(shape: BoxShape.circle, color: f ? const Color(0x1A000000) : const Color(0x29FFFFFF)),
                child: Icon(icon, size: g.dp(19), color: f ? const Color(0xFF111114) : Colors.white),
              ),
              SizedBox(width: g.dp(10)),
              Text(label, style: tx(g.dp(18), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white)),
            ],
          ),
        ),
      ),
    ],
  );
}

/// A row title and its cards, scrolling sideways so the focused card is always whole on screen.
class TvRowView extends StatefulWidget {
  const TvRowView({super.key, required this.g, required this.title, required this.count, required this.itemW, required this.itemH, required this.builder, this.start = 0});
  final TvGeo g;
  final String title;
  final int count;

  /// The card to show first (a series' page opens its episodes at the one to watch).
  final int start;
  final double itemW, itemH;
  final Widget Function(BuildContext context, int index, ValueChanged<bool> onFocus) builder;
  @override
  State<TvRowView> createState() => _TvRowViewState();
}

class _TvRowViewState extends State<TvRowView> {
  final scroll = ScrollController();
  int _shown = 0;

  @override
  void initState() {
    super.initState();
    _showStart();
  }

  @override
  void didUpdateWidget(TvRowView old) {
    super.didUpdateWidget(old);
    if (old.start != widget.start || old.count != widget.count) _showStart();
  }

  void _showStart() {
    if (widget.start <= 0 || widget.start == _shown) return;
    _shown = widget.start;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !scroll.hasClients) return;
      final g = widget.g;
      final to = (widget.start * (widget.itemW + g.gap) - g.dp(24)).clamp(0.0, scroll.position.maxScrollExtent);
      scroll.jumpTo(to);
    });
  }

  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  void _focused(int i) {
    if (!scroll.hasClients) return;
    final g = widget.g;
    final view = scroll.position.viewportDimension;
    final left = g.side + i * (widget.itemW + g.gap);
    // Keep a little of the card before and after in sight, as Apple does.
    final peek = g.gap + g.dp(24);
    var to = scroll.offset;
    if (left + widget.itemW + peek > to + view) to = left + widget.itemW + peek - view;
    if (left - peek < to) to = left - peek;
    if (i == 0) to = 0;
    to = to.clamp(0.0, scroll.position.maxScrollExtent);
    if ((to - scroll.offset).abs() > 0.5) scroll.animateTo(to, duration: const Duration(milliseconds: 260), curve: Curves.easeOutCubic);
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (widget.title.isNotEmpty)
        SizedBox(
          height: g.rowTitleH,
          child: Padding(
            padding: EdgeInsets.only(left: g.side),
            child: Align(
              alignment: Alignment.bottomLeft,
              child: Text(widget.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(21), w: FontWeight.w700, opacity: 0.92, spacing: -g.dp(0.2))),
            ),
          ),
        ),
        SizedBox(
          height: g.padTop + widget.itemH + g.padBottom,
          child: SingleChildScrollView(
            controller: scroll,
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            padding: EdgeInsets.fromLTRB(g.side, g.padTop, g.side, g.padBottom),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < widget.count; i++) ...[
                  if (i > 0) SizedBox(width: g.gap),
                  widget.builder(context, i, (v) {
                    if (v) _focused(i);
                  }),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// A page of parts stacked from the top (a featured picture, rows…) that moves as the focus goes
/// down: the first [free] parts show with the page at the top; from there on the focused part
/// moves up to just below the capsule. Parts that would be cut by the top or bottom edge are
/// hidden, so nothing on screen is ever cut off.
class TvColumn extends StatefulWidget {
  const TvColumn({super.key, required this.g, required this.children, this.free = 1, this.onAt, this.bottom = 0});
  final TvGeo g;
  final List<Widget> children;
  final int free;
  final double bottom;
  final ValueChanged<int>? onAt;
  @override
  State<TvColumn> createState() => TvColumnState();
}

class TvColumnState extends State<TvColumn> {
  final scroll = ScrollController();
  final _column = GlobalKey();
  List<GlobalKey> _keys = [];
  int at = 0;
  double _target = 0;
  List<bool> _whole = const [];

  /// Room after the last part, so that it too can move up to just below the capsule.
  double _tail = 0;

  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  void _in(int i) {
    if (i != at) {
      setState(() => at = i);
      widget.onAt?.call(i);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) => _move());
  }

  void _move() {
    if (!mounted || !scroll.hasClients) return;
    var to = 0.0;
    if (at >= widget.free && at < _keys.length) {
      final box = _keys[at].currentContext?.findRenderObject() as RenderBox?;
      final col = _column.currentContext?.findRenderObject() as RenderBox?;
      if (box != null && col != null) to = box.localToGlobal(Offset.zero, ancestor: col).dy - widget.g.top;
    }
    to = to.clamp(0.0, scroll.position.maxScrollExtent);
    _target = to;
    _checkWhole();
    if ((to - scroll.offset).abs() > 0.5) scroll.animateTo(to, duration: const Duration(milliseconds: 320), curve: Curves.easeOutCubic);
  }

  /// Which parts are wholly on screen with the page where it is going.
  void _checkWhole() {
    final col = _column.currentContext?.findRenderObject() as RenderBox?;
    if (col == null || !scroll.hasClients) return;
    final view = scroll.position.viewportDimension;
    final last = _keys.isEmpty ? null : _keys.last.currentContext?.findRenderObject() as RenderBox?;
    if (last != null && _keys.length > widget.free) {
      final tail = (view - widget.g.top - last.size.height).clamp(widget.bottom, view);
      if ((tail - _tail).abs() > 1) setState(() => _tail = tail);
    }
    final whole = [
      for (var i = 0; i < _keys.length; i++)
        () {
          final box = _keys[i].currentContext?.findRenderObject() as RenderBox?;
          if (box == null) return true;
          final top = box.localToGlobal(Offset.zero, ancestor: col).dy - _target;
          final bottom = top + box.size.height;
          // A little room for the focused card's growth below.
          return bottom <= view + widget.g.dp(4) && (top >= -widget.g.dp(4) || i < at);
        }(),
    ];
    if (whole.length != _whole.length || [for (var i = 0; i < whole.length; i++) whole[i] != _whole[i]].any((x) => x)) {
      setState(() => _whole = whole);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_keys.length != widget.children.length) _keys = [for (final _ in widget.children) GlobalKey()];
    final moved = at >= widget.free;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _checkWhole();
    });
    return SingleChildScrollView(
      controller: scroll,
      clipBehavior: Clip.none,
      child: Column(
        key: _column,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final (i, c) in widget.children.indexed)
            Focus(
              canRequestFocus: false,
              skipTraversal: true,
              onFocusChange: (v) {
                if (v) _in(i);
              },
              child: KeyedSubtree(
                key: _keys[i],
                child: AnimatedOpacity(
                  opacity: (moved && i < at) || (i < _whole.length && !_whole[i] && i != at) ? 0 : 1,
                  duration: const Duration(milliseconds: 220),
                  child: c,
                ),
              ),
            ),
          SizedBox(height: _tail > widget.bottom ? _tail : widget.bottom),
        ],
      ),
    );
  }
}

/// Moving the focus never scrolls by itself: Korie TV's rows and pages move the way it wants
/// (whole cards, the focused row under the capsule) instead of just enough to show the item.
final tvTraversal = ReadingOrderTraversalPolicy(
  requestFocusCallback: (node, {alignment, alignmentPolicy, curve, duration}) => node.requestFocus(),
);
