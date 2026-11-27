import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:path_provider/path_provider.dart';

import '../android.dart';
import '../store.dart';
import '../tv/widgets.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import 'web_view.dart';

/// What was typed in the address box: an address (https:// added when missing) or a search.
String addressFor(String text) {
  final t = text.trim();
  if (t.isEmpty) return '';
  if (RegExp(r'^[a-z][a-z0-9+.-]*://', caseSensitive: false).hasMatch(t)) return t;
  final looksLikeHost = !t.contains(' ') && (t.contains('.') || t.startsWith('localhost')) && !t.endsWith('.');
  if (looksLikeHost) {
    // Devices at home (an IP address, a .local name, localhost) nearly always serve plain http.
    final host = t.split(RegExp(r'[:/]')).first;
    final local = RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(host) || host.endsWith('.local') || host == 'localhost';
    return '${local ? 'http' : 'https'}://$t';
  }
  return 'https://www.google.com/search?q=${Uri.encodeQueryComponent(t)}';
}

String hostOf(String url) => Uri.tryParse(url)?.host.replaceFirst(RegExp(r'^www\.'), '') ?? url;

class BrowserTab {
  BrowserTab({required this.id, required this.url, this.title = '', this.thumb});
  final String id;
  String url, title;
  String? thumb; // a picture of the page, a file
  Map<String, Object?> toJson() => {'id': id, 'url': url, 'title': title, 'thumb': thumb};
  static BrowserTab? fromJson(Object? j) {
    if (j is! Map || j['url'] == null) return null;
    return BrowserTab(id: '${j['id']}', url: '${j['url']}', title: '${j['title'] ?? ''}', thumb: j['thumb'] as String?);
  }
}

class Favourite {
  const Favourite(this.title, this.url);
  final String title, url;
}

const _defaultFavourites = [
  Favourite('DR TV', 'https://www.dr.dk/drtv'),
  Favourite('Wikipedia', 'https://www.wikipedia.org'),
  Favourite('YouTube', 'https://www.youtube.com'),
];

enum _Mode { newTab, page, tabs }

/// Korie's web browser: tabs (kept per profile), a new-tab page with search and favourites, and
/// pages where the arrow keys move a pointer and OK clicks, as TV browsers do. Up at the top edge
/// of a page reaches the bar; Back goes back a page, and from the first page leaves.
/// Tells that a page stopped working (its renderer crashed).
void pageCrashed(BuildContext context, bool reloaded) {
  final o = Navigator.of(context).overlay;
  if (o == null) return;
  showToast(o, reloaded ? 'The page stopped working and was opened again' : 'This page keeps stopping, so it was closed');
}

class KorieBrowser extends StatefulWidget {
  const KorieBrowser({super.key, required this.store, this.open});
  final Store store;

  /// Opens this address in a new tab (an add-on's page, say).
  final String? open;
  @override
  State<KorieBrowser> createState() => _KorieBrowserState();
}

class _KorieBrowserState extends State<KorieBrowser> {
  Store get store => widget.store;
  List<BrowserTab> tabs = [];
  int current = -1;
  _Mode mode = _Mode.newTab;
  List<Favourite> favourites = [];
  final web = WebPage();
  bool get loading => web.loading;
  bool get canBack => web.canBack;
  bool get canForward => web.canForward;
  Offset cursor = const Offset(400, 260);
  bool pointerShown = false;
  bool hint = false;
  Timer? _hintTimer;
  final pageNode = FocusNode(debugLabel: 'browser.page');
  final addressNode = FocusNode(debugLabel: 'browser.address');
  final searchNode = FocusNode(debugLabel: 'browser.search');
  final tabsNode = FocusNode(debugLabel: 'browser.tabs');
  final pageKey = GlobalKey();
  Directory? _thumbs;

  BrowserTab? get tab => current >= 0 && current < tabs.length ? tabs[current] : null;

  @override
  void initState() {
    super.initState();
    tabs = [for (final j in (store.profileData('browser.tabs') as List? ?? const [])) ?BrowserTab.fromJson(j)];
    final favs = store.profileData('browser.favourites');
    favourites = favs is List
        ? [for (final f in favs) if (f is Map && f['url'] != null) Favourite('${f['title'] ?? ''}', '${f['url']}')]
        : [..._defaultFavourites];
    web
      ..onFinished = _pageDone
      ..onCrashed = _crashed
      ..addListener(_webChanged);
    getApplicationSupportDirectory().then((d) {
      _thumbs = Directory('${d.path}/browser')..createSync(recursive: true);
    });
    if (widget.open != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => openUrl(widget.open!, newTab: true));
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) => searchNode.requestFocus());
    }
  }

  void _webChanged() {
    final t = tab;
    if (t != null && web.url.isNotEmpty && mode == _Mode.page) t.url = web.url;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    web.removeListener(_webChanged);
    web.dispose();
    _hintTimer?.cancel();
    pageNode.dispose();
    addressNode.dispose();
    searchNode.dispose();
    tabsNode.dispose();
    super.dispose();
  }

  void _save() => store.setProfileData('browser.tabs', [for (final t in tabs) t.toJson()]);

  void _saveFavourites() => store.setProfileData('browser.favourites', [for (final f in favourites) {'title': f.title, 'url': f.url}]);

  void _crashed(bool reloaded) => pageCrashed(context, reloaded);

  void _pageDone() {
    final t = tab;
    if (t != null) {
      if (web.title.isNotEmpty) t.title = web.title;
      if (web.url.isNotEmpty) t.url = web.url;
      _save();
    }
    if (mounted) setState(() {});
  }

  /// Opens an address in this tab, or in a new one.
  Future<void> openUrl(String url, {bool newTab = false}) async {
    if (url.isEmpty) return;
    await _keepPicture();
    setState(() {
      if (newTab || tab == null) {
        tabs.add(BrowserTab(id: DateTime.now().microsecondsSinceEpoch.toString(), url: url, title: hostOf(url)));
        current = tabs.length - 1;
      } else {
        tab!.url = url;
      }
      mode = _Mode.page;
    });
    _save();
    await web.load(url);
    _showPage();
  }

  void _showPage() {
    setState(() {
      pointerShown = true;
      hint = true;
    });
    _hintTimer?.cancel();
    _hintTimer = Timer(const Duration(seconds: 6), () {
      if (mounted) setState(() => hint = false);
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => pageNode.requestFocus());
  }

  Future<void> switchTo(int i) async {
    await _keepPicture();
    setState(() {
      current = i;
      mode = _Mode.page;
    });
    await web.load(tabs[i].url);
    _showPage();
  }

  Future<void> closeTab(int i) async {
    final t = tabs.removeAt(i);
    if (t.thumb != null) {
      try {
        File(t.thumb!).deleteSync();
      } catch (_) {}
    }
    if (current >= tabs.length) current = tabs.length - 1;
    _save();
    setState(() {});
  }

  /// A picture of the page for the tab list, taken as it is left.
  Future<void> _keepPicture() async {
    final t = tab;
    final dir = _thumbs;
    if (mode != _Mode.page || t == null || dir == null) return;
    final bytes = await web.picture();
    if (bytes == null) return;
    final f = File('${dir.path}/${t.id}.jpg');
    await f.writeAsBytes(bytes);
    // A new name each time, so the picture shown is never an old one kept in memory.
    final named = File('${dir.path}/${t.id}-${DateTime.now().millisecondsSinceEpoch}.jpg');
    await f.rename(named.path);
    if (t.thumb != null && t.thumb != named.path) {
      try {
        File(t.thumb!).deleteSync();
      } catch (_) {}
    }
    t.thumb = named.path;
    _save();
  }

  Future<void> showNewTab() async {
    await _keepPicture();
    setState(() => mode = _Mode.newTab);
    WidgetsBinding.instance.addPostFrameCallback((_) => searchNode.requestFocus());
  }

  Future<void> showTabs() async {
    await _keepPicture();
    setState(() => mode = _Mode.tabs);
    WidgetsBinding.instance.addPostFrameCallback((_) => tabsNode.requestFocus());
  }

  Future<void> _type({bool newTab = false}) async {
    final t = await askText(context, title: newTab ? 'Search or Address' : 'Address', value: newTab ? '' : (tab?.url ?? ''), done: 'Go');
    if (t == null || !mounted) return;
    await openUrl(addressFor(t), newTab: newTab || tab == null || mode != _Mode.page);
  }

  bool get _isFavourite => tab != null && favourites.any((f) => f.url == tab!.url);

  void _toggleFavourite() {
    final t = tab;
    if (t == null) return;
    setState(() {
      if (_isFavourite) {
        favourites.removeWhere((f) => f.url == t.url);
      } else {
        favourites.add(Favourite(t.title.isEmpty ? hostOf(t.url) : t.title, t.url));
      }
    });
    _saveFavourites();
    final o = Navigator.of(context).overlay;
    if (o != null) showToast(o, _isFavourite ? 'Added to Favourites' : 'Removed from Favourites');
  }

  Future<void> _back() async {
    if (mode != _Mode.page && tab != null) {
      await switchTo(current);
      return;
    }
    if (mode == _Mode.page && web.canBack) {
      await web.back();
      return;
    }
    // A page with nothing to go back to: leave the Browser (the tabs are kept for next time).
    await _keepPicture();
    if (mounted) Navigator.of(context).pop();
  }

  // ------------------------------------------------------------------ the pointer

  /// Where the pointer is, in the page's own coordinates; arrows move it, faster while held.
  double _step = 16;

  KeyEventResult _pageKey(FocusNode n, KeyEvent e, Size size) {
    final k = e.logicalKey;
    final ok = k == LogicalKeyboardKey.select || k == LogicalKeyboardKey.enter || k == LogicalKeyboardKey.numpadEnter || k == LogicalKeyboardKey.gameButtonA;
    if (ok) {
      if (e is KeyDownEvent) _click();
      return KeyEventResult.handled;
    }
    final dir = switch (k) {
      LogicalKeyboardKey.arrowLeft => const Offset(-1, 0),
      LogicalKeyboardKey.arrowRight => const Offset(1, 0),
      LogicalKeyboardKey.arrowUp => const Offset(0, -1),
      LogicalKeyboardKey.arrowDown => const Offset(0, 1),
      _ => null,
    };
    if (dir == null) return KeyEventResult.ignored;
    if (e is KeyUpEvent) {
      _step = 16;
      return KeyEventResult.handled;
    }
    _step = e is KeyRepeatEvent ? math.min(_step * 1.2, 48) : 16;
    final next = cursor + dir * _step;
    // At the top edge, Up goes to the bar; at the other edges the page scrolls.
    if (next.dy < 0 && dir.dy < 0) {
      if (cursor.dy <= 2) {
        _scroll(const Offset(0, -1), size, toBar: true);
      } else {
        setState(() => cursor = Offset(cursor.dx, 0));
      }
      return KeyEventResult.handled;
    }
    if (next.dy > size.height - 4 && dir.dy > 0) {
      _scroll(const Offset(0, 1), size);
      setState(() => cursor = Offset(cursor.dx, size.height - 4));
      return KeyEventResult.handled;
    }
    if ((next.dx < 0 && dir.dx < 0) || (next.dx > size.width - 4 && dir.dx > 0)) {
      _scroll(dir, size);
    }
    setState(() {
      cursor = Offset(next.dx.clamp(0, size.width - 4), next.dy.clamp(0, size.height - 4));
      pointerShown = true;
    });
    return KeyEventResult.handled;
  }

  int _pointerId = 9000;

  Offset _global(Offset local) {
    final box = pageKey.currentContext?.findRenderObject() as RenderBox?;
    return box == null ? local : box.localToGlobal(local);
  }

  /// OK: a tap where the pointer is, as a finger would, so links, buttons and fields all work.
  void _click() {
    final p = _global(cursor);
    final id = ++_pointerId;
    final b = GestureBinding.instance;
    b.handlePointerEvent(PointerDownEvent(pointer: id, position: p, kind: PointerDeviceKind.touch));
    Future<void>.delayed(const Duration(milliseconds: 60), () {
      b.handlePointerEvent(PointerUpEvent(pointer: id, position: p, kind: PointerDeviceKind.touch));
    });
  }

  /// Scrolls the page under the pointer by dragging it, as a finger would: works for every page,
  /// also ones that scroll a part of themselves rather than the whole page.
  Future<void> _scroll(Offset dir, Size size, {bool toBar = false}) async {
    if (toBar) {
      final y = await web.scrollY();
      if (y <= 0) {
        addressNode.requestFocus();
        return;
      }
    }
    final start = _global(Offset(cursor.dx.clamp(20, size.width - 20), cursor.dy.clamp(20, size.height - 20)));
    final distance = dir * -(size.height * 0.22);
    final id = ++_pointerId;
    final b = GestureBinding.instance;
    b.handlePointerEvent(PointerDownEvent(pointer: id, position: start, kind: PointerDeviceKind.touch));
    const steps = 6;
    for (var i = 1; i <= steps; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 12));
      b.handlePointerEvent(PointerMoveEvent(pointer: id, position: start + distance * (i / steps), delta: distance / steps.toDouble(), kind: PointerDeviceKind.touch));
    }
    // Held a moment at the end: no fling, the page stops where the drag stopped.
    await Future<void>.delayed(const Duration(milliseconds: 80));
    b.handlePointerEvent(PointerUpEvent(pointer: id, position: start + distance, kind: PointerDeviceKind.touch));
  }

  // ------------------------------------------------------------------ build

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Material(
        color: const Color(0xFF111116),
        child: LayoutBuilder(
          builder: (context, c) {
            final g = TvGeo(c.maxWidth, c.maxHeight);
            final barH = g.dp(68);
            final pageSize = Size(g.w, g.h - barH);
            return Stack(
              children: [
                // The page stays in place under the other views, so going back to it is instant.
                Positioned(
                  left: 0,
                  top: barH,
                  width: pageSize.width,
                  height: pageSize.height,
                  // (always in place: the new-tab and tabs views cover it; hiding it stops its picture)
                  child: ExcludeFocus(
                    excluding: mode != _Mode.page,
                    child: Focus(
                      focusNode: pageNode,
                      onKeyEvent: (n, e) => _pageKey(n, e, pageSize),
                      onFocusChange: (_) => setState(() {}),
                      child: Stack(
                        children: [
                          Positioned.fill(
                            child: KeyedSubtree(key: pageKey, child: WebPageView(page: web)),
                          ),
                          if (pointerShown && pageNode.hasFocus) _pointer(g),
                          if (loading)
                            const Positioned(left: 0, right: 0, top: 0, child: LinearProgressIndicator(minHeight: 3, color: Color(0xFF4C8DF6), backgroundColor: Colors.transparent)),
                        ],
                      ),
                    ),
                  ),
                ),
                if (mode == _Mode.newTab) Positioned(left: 0, top: barH, right: 0, bottom: 0, child: ColoredBox(color: const Color(0xFF111116), child: _newTab(g))),
                if (mode == _Mode.tabs) Positioned(left: 0, top: barH, right: 0, bottom: 0, child: ColoredBox(color: const Color(0xFF111116), child: _tabsView(g))),
                Positioned(left: 0, top: 0, right: 0, height: barH, child: _bar(g)),
                if (mode == _Mode.page)
                  Positioned(
                    left: 0,
                    right: 0,
                    bottom: g.dp(22),
                    child: IgnorePointer(
                      child: AnimatedOpacity(
                        opacity: hint ? 1 : 0,
                        duration: const Duration(milliseconds: 400),
                        child: Center(
                          child: _pill(g, 'Arrows move the pointer  ·  OK clicks  ·  Up at the top: the bar  ·  Back goes back a page'),
                        ),
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _pill(TvGeo g, String text) => Container(
    padding: EdgeInsets.symmetric(horizontal: g.dp(16), vertical: g.dp(8)),
    decoration: BoxDecoration(
      color: const Color(0xDB14141A),
      borderRadius: BorderRadius.circular(g.dp(18)),
      border: Border.all(color: const Color(0x29FFFFFF)),
    ),
    child: Text(text, style: tx(g.dp(14), w: FontWeight.w600)),
  );

  Widget _pointer(TvGeo g) => Positioned(
    left: cursor.dx - g.dp(16),
    top: cursor.dy - g.dp(16),
    child: IgnorePointer(
      child: SizedBox(
        width: g.dp(48),
        height: g.dp(48),
        child: Stack(
          children: [
            Container(
              width: g.dp(32),
              height: g.dp(32),
              decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0x404C8DF6)),
            ),
            Positioned(left: g.dp(16), top: g.dp(16), child: CustomPaint(size: Size(g.dp(26), g.dp(30)), painter: _Arrow())),
          ],
        ),
      ),
    ),
  );

  Widget _round(TvGeo g, IconData icon, VoidCallback? onTap, {FocusNode? node, bool on = true}) => Focusable(
    focusNode: node,
    onTap: on ? onTap : null,
    builder: (context, f) => Container(
      width: g.dp(40),
      height: g.dp(40),
      decoration: BoxDecoration(shape: BoxShape.circle, color: f ? const Color(0xFFF2F2F4) : const Color(0x1FFFFFFF)),
      child: Icon(icon, size: g.dp(21), color: f ? const Color(0xFF111114) : Colors.white.withValues(alpha: on ? 1 : 0.35)),
    ),
  );

  Widget _bar(TvGeo g) {
    final t = tab;
    final address = mode == _Mode.page && t != null ? t.url : (mode == _Mode.tabs ? 'Tabs' : 'New Tab');
    return FocusTraversalGroup(
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: g.dp(24)),
        decoration: const BoxDecoration(color: Color(0xF016161C), border: Border(bottom: BorderSide(color: Color(0x1AFFFFFF)))),
        child: Row(
          children: [
            _round(g, Icons.chevron_left_rounded, () => web.back(), on: mode == _Mode.page && canBack),
            SizedBox(width: g.dp(10)),
            _round(g, Icons.chevron_right_rounded, () => web.forward(), on: mode == _Mode.page && canForward),
            SizedBox(width: g.dp(10)),
            _round(g, Icons.refresh_rounded, () => web.reload(), on: mode == _Mode.page),
            SizedBox(width: g.dp(18)),
            Expanded(
              child: Focusable(
                focusNode: addressNode,
                onTap: () => _type(newTab: mode != _Mode.page),
                builder: (context, f) => Container(
                  height: g.dp(40),
                  padding: EdgeInsets.symmetric(horizontal: g.dp(18)),
                  decoration: BoxDecoration(color: f ? const Color(0xFFF2F2F4) : const Color(0x1FFFFFFF), borderRadius: BorderRadius.circular(g.dp(20))),
                  child: Row(
                    children: [
                      Icon(
                        mode == _Mode.page && (t?.url.startsWith('https') ?? false) ? Icons.lock_outline_rounded : Icons.search_rounded,
                        size: g.dp(16),
                        color: f ? const Color(0xFF111114) : Colors.white70,
                      ),
                      SizedBox(width: g.dp(10)),
                      Expanded(
                        child: Text(
                          address,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: tx(g.dp(16), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white, opacity: mode == _Mode.page ? 0.95 : 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            SizedBox(width: g.dp(18)),
            _round(g, _isFavourite ? Icons.star_rounded : Icons.star_outline_rounded, _toggleFavourite, on: mode == _Mode.page),
            SizedBox(width: g.dp(10)),
            Focusable(
              onTap: showTabs,
              builder: (context, f) => Container(
                height: g.dp(40),
                padding: EdgeInsets.symmetric(horizontal: g.dp(14)),
                decoration: BoxDecoration(color: f ? const Color(0xFFF2F2F4) : const Color(0x1FFFFFFF), borderRadius: BorderRadius.circular(g.dp(20))),
                child: Row(
                  children: [
                    Icon(Icons.filter_none_rounded, size: g.dp(17), color: f ? const Color(0xFF111114) : Colors.white),
                    SizedBox(width: g.dp(8)),
                    Text('${tabs.length}', style: tx(g.dp(15), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white)),
                  ],
                ),
              ),
            ),
            SizedBox(width: g.dp(10)),
            _round(g, Icons.add_rounded, showNewTab),
          ],
        ),
      ),
    );
  }

  Widget _thumb(TvGeo g, BrowserTab t, double w, bool f) {
    final h = w * 0.5625;
    return AnimatedScale(
      scale: f ? 1.06 : 1,
      duration: const Duration(milliseconds: 160),
      child: Container(
        width: w,
        height: h,
        clipBehavior: Clip.antiAlias,
        foregroundDecoration: f ? BoxDecoration(borderRadius: BorderRadius.circular(g.dp(14)), border: Border.all(color: const Color(0xE6FFFFFF), width: g.dp(2))) : null,
        decoration: BoxDecoration(color: const Color(0xFF26262C), borderRadius: BorderRadius.circular(g.dp(14))),
        child: t.thumb != null && File(t.thumb!).existsSync()
            ? Image.file(File(t.thumb!), fit: BoxFit.cover, alignment: Alignment.topCenter, width: w, height: h)
            : Center(child: Text(hostOf(t.url), style: tx(g.dp(16), w: FontWeight.w700, opacity: 0.7))),
      ),
    );
  }

  Widget _tabCard(TvGeo g, int i, double w, {FocusNode? node}) {
    final t = tabs[i];
    return HoldFocusable(
      focusNode: node,
      onTap: () => switchTo(i),
      onHold: () => closeTab(i),
      builder: (context, f) => SizedBox(
        width: w,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _thumb(g, t, w, f),
            SizedBox(height: g.dp(10)),
            Text(t.title.isEmpty ? hostOf(t.url) : t.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(15), w: FontWeight.w700)),
            SizedBox(height: g.dp(2)),
            Text(hostOf(t.url), maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(13), opacity: 0.6)),
          ],
        ),
      ),
    );
  }

  static const _colors = [Color(0xFFE3171B), Color(0xFF3A3A40), Color(0xFF6A4CF0), Color(0xFF1F8A70), Color(0xFFD9733A), Color(0xFF2E6FE0)];

  Widget _favourite(TvGeo g, Favourite f, int i) {
    // "DR TV" → DR, "Wikipedia" → W: a short first word as it is, else the first letters.
    final words = f.title.trim().split(RegExp(r'\s+')).where((w) => w.isNotEmpty).toList();
    final letters = words.isEmpty
        ? '?'
        : (words.first.length <= 3 && words.length > 1 ? words.first.toUpperCase() : words.take(2).map((w) => w.characters.first.toUpperCase()).join());
    return HoldFocusable(
      onTap: () => openUrl(f.url, newTab: true),
      onHold: () {
        setState(() => favourites.remove(f));
        _saveFavourites();
      },
      builder: (context, foc) => SizedBox(
        width: g.dp(120),
        child: Column(
          children: [
            AnimatedScale(
              scale: foc ? 1.08 : 1,
              duration: const Duration(milliseconds: 160),
              child: Container(
                width: g.dp(120),
                height: g.dp(120),
                alignment: Alignment.center,
                foregroundDecoration: foc ? BoxDecoration(borderRadius: BorderRadius.circular(g.dp(24)), border: Border.all(color: const Color(0xE6FFFFFF), width: g.dp(2))) : null,
                decoration: BoxDecoration(color: _colors[f.url.hashCode.abs() % _colors.length], borderRadius: BorderRadius.circular(g.dp(24))),
                child: Text(letters, style: tx(g.dp(40), w: FontWeight.w800)),
              ),
            ),
            SizedBox(height: g.dp(10)),
            Text(f.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.85)),
          ],
        ),
      ),
    );
  }

  Widget _newTab(TvGeo g) {
    final parts = <Widget>[
      Padding(
        padding: EdgeInsets.only(top: g.dp(44), bottom: g.dp(8)),
        child: Center(
          child: Focusable(
            focusNode: searchNode,
            autofocus: true,
            onTap: () => _type(newTab: true),
            builder: (context, f) => Container(
              width: g.dp(760),
              height: g.dp(60),
              padding: EdgeInsets.symmetric(horizontal: g.dp(26)),
              decoration: BoxDecoration(
                color: f ? const Color(0xFFF2F2F4) : const Color(0x1FFFFFFF),
                borderRadius: BorderRadius.circular(g.dp(30)),
              ),
              child: Row(
                children: [
                  Icon(Icons.search_rounded, size: g.dp(24), color: f ? const Color(0xFF111114) : Colors.white70),
                  SizedBox(width: g.dp(14)),
                  Text('Search the web or type an address', style: tx(g.dp(20), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white, opacity: 0.6)),
                ],
              ),
            ),
          ),
        ),
      ),
      if (favourites.isNotEmpty)
        TvRowView(
          g: g,
          title: 'Favourites',
          count: favourites.length,
          itemW: g.dp(120),
          itemH: g.dp(152),
          builder: (context, i, onFocus) => Focus(
            canRequestFocus: false,
            skipTraversal: true,
            onFocusChange: onFocus,
            child: _favourite(g, favourites[i], i),
          ),
        ),
      if (tabs.isNotEmpty)
        TvRowView(
          g: g,
          title: 'Open Tabs',
          count: tabs.length,
          itemW: g.dp(260),
          itemH: g.dp(146) + g.dp(48),
          builder: (context, i, onFocus) => Focus(canRequestFocus: false, skipTraversal: true, onFocusChange: onFocus, child: _tabCard(g, i, g.dp(260))),
        ),
    ];
    return FocusTraversalGroup(
      policy: tvTraversal,
      child: TvColumn(g: g, free: 2, bottom: g.dp(30), children: parts),
    );
  }

  Widget _tabsView(TvGeo g) {
    final w = g.dp(360);
    final per = math.max(1, ((g.w - 2 * g.side + g.dp(34)) / (w + g.dp(34))).floor());
    final cards = <Widget>[
      for (var i = 0; i < tabs.length; i++) _tabCard(g, i, w, node: i == current ? tabsNode : null),
      Focusable(
        onTap: showNewTab,
        builder: (context, f) => Container(
          width: w,
          height: w * 0.5625,
          decoration: BoxDecoration(
            color: f ? const Color(0xFFF2F2F4) : Colors.transparent,
            borderRadius: BorderRadius.circular(g.dp(14)),
            border: Border.all(color: f ? Colors.white : const Color(0x40FFFFFF), width: g.dp(2)),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.add_rounded, size: g.dp(30), color: f ? const Color(0xFF111114) : Colors.white),
              SizedBox(height: g.dp(8)),
              Text('New Tab', style: tx(g.dp(16), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white)),
            ],
          ),
        ),
      ),
    ];
    final lines = [for (var i = 0; i < cards.length; i += per) cards.sublist(i, math.min(i + per, cards.length))];
    return FocusTraversalGroup(
      policy: tvTraversal,
      child: TvColumn(
        g: g,
        free: 2,
        bottom: g.dp(30),
        children: [
          SizedBox(height: g.dp(30)),
          for (final line in lines)
            Padding(
              padding: EdgeInsets.fromLTRB(g.side, g.dp(10), g.side, g.dp(26)),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [for (final (i, c) in line.indexed) ...[if (i > 0) SizedBox(width: g.dp(34)), c]]),
            ),
          Center(child: _pill(g, 'OK opens a tab  ·  Hold OK: close it  ·  Back returns to the page')),
        ],
      ),
    );
  }
}

class _Arrow extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / 26, sy = size.height / 30;
    final p = Path()
      ..moveTo(2 * sx, 2 * sy)
      ..lineTo(22 * sx, 14 * sy)
      ..lineTo(13 * sx, 16 * sy)
      ..lineTo(9 * sx, 25 * sy)
      ..close();
    canvas.drawPath(p, Paint()..color = Colors.white);
    canvas.drawPath(
      p,
      Paint()
        ..color = const Color(0xFF111114)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2 * sx
        ..strokeJoin = StrokeJoin.round,
    );
  }

  @override
  bool shouldRepaint(_Arrow old) => false;
}

/// An add-on's page full screen: just the page. Every key and a controller go to the page itself
/// (a game stream plays with them); only Back on the remote leaves.
class FullPage extends StatefulWidget {
  const FullPage({super.key, required this.url, this.title = ''});
  final String url, title;
  @override
  State<FullPage> createState() => _FullPageState();
}

class _FullPageState extends State<FullPage> {
  final web = WebPage();
  bool hint = true;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    web.onCrashed = (reloaded) => pageCrashed(context, reloaded);
    // Once the page is on screen it gets every key and the controller (see MainActivity).
    Future<void>.delayed(const Duration(milliseconds: 800), () async {
      await web.focus();
      await Android.webDirect(true);
    });
    _t = Timer(const Duration(seconds: 5), () {
      if (mounted) setState(() => hint = false);
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    Android.webDirect(false);
    web.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Material(
    color: Colors.black,
    child: LayoutBuilder(
      builder: (context, c) {
        final g = TvGeo(c.maxWidth, c.maxHeight);
        return Stack(
          children: [
            Positioned.fill(
              child: WebPageView(page: web, url: widget.url),
            ),
            Positioned(
              left: 0,
              right: 0,
              top: g.dp(22),
              child: IgnorePointer(
                child: AnimatedOpacity(
                  opacity: hint ? 1 : 0,
                  duration: const Duration(milliseconds: 500),
                  child: Center(
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: g.dp(16), vertical: g.dp(8)),
                      decoration: BoxDecoration(
                        color: const Color(0xCC14141A),
                        borderRadius: BorderRadius.circular(g.dp(20)),
                        border: Border.all(color: const Color(0x29FFFFFF)),
                      ),
                      child: Text(
                        '${widget.title.isEmpty ? '' : '${widget.title}  ·  '}Back on the remote leaves',
                        style: tx(g.dp(14), w: FontWeight.w600),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
    ),
  );
}
