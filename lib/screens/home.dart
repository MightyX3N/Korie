import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../android.dart';
import '../geo.dart';
import '../home_cache.dart';
import '../addons/host.dart';
import '../island.dart';
import '../net.dart';
import '../ui/ask.dart';
import '../store.dart';
import '../tv/library.dart';
import '../tv/tv.dart';
import '../tv/widgets.dart' show tvIcon;
import '../ui/common.dart';
import '../ui/menu.dart';
import '../ui/tile.dart';
import 'folder.dart';
import 'profiles.dart';
import 'settings.dart';

/// Home: the carousel at the top, the dock (the first row of apps) on glass, every other app
/// below it, as in Hume. More Apps (hidden apps) is the last card.
class Home extends StatefulWidget {
  const Home({super.key, required this.store});
  final Store store;
  static final homeKey = GlobalKey<HomeState>();
  @override
  State<Home> createState() => HomeState();
}

class HomeState extends State<Home> with TickerProviderStateMixin {
  Store get store => widget.store;
  List<App> apps = [];

  /// The apps Android has, and Korie's own cards that sit among them: Korie TV and add-ons' tiles.
  List<App> _android = [], _extra = [];
  List<TvTile> _tiles = [];
  final Map<String, Uint8List?> _tileArt = {};
  final Map<String, FocusNode> nodes = {};
  final carouselNode = FocusNode(debugLabel: 'carousel');

  List<ShelfItem> shelf = [];
  bool shelfGranted = false;
  int heroIndex = 0;
  final Map<String, ui.Image?> tiny = {};

  int focusedIndex = 0;
  bool carouselFocused = false;
  String? movingId;

  late final AnimationController scrollAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 260));
  double scrollFrom = 0, scrollTo = 0;
  double get scroll => ui.lerpDouble(scrollFrom, scrollTo, Curves.easeOutCubic.transform(scrollAnim.value))!;

  Timer? shelfTimer;
  late final AppLifecycleListener life;
  StreamSubscription? _addonUpdates;
  String _homeAddons = '';

  /// An add-on that answers "home" was added, removed or (re)started.
  void _addonsChanged() {
    _loadExtras();
    final h = AddonHost.instance.handlersOf('home').map((a) => a.id).join(',');
    if (h == _homeAddons) return;
    _homeAddons = h;
    _loadShelf();
  }

  @override
  void initState() {
    super.initState();
    store.addListener(_changed);
    Android.onAppsChanged(_loadApps);
    // What was loaded at start (or last time) is on screen at once; fresh lists follow.
    final cache = HomeCache.instance;
    _android = cache.apps;
    _extra = cache.extra;
    apps = [..._android, ..._extra];
    _show(cache.deviceGranted, cache.device, cache.addons[store.current.id] ?? const []);
    if (apps.isNotEmpty) _focusFirstApp();
    _ready = true;
    _loadApps();
    _loadShelf();
    shelfTimer = Timer.periodic(const Duration(minutes: 2), (_) => _loadShelf());
    AddonHost.instance.addListener(_addonsChanged);
    _addonUpdates = AddonHost.instance.updates.stream.listen((u) {
      if (u.what == 'home') _loadShelf();
      if (u.what == 'tiles' || u.what == 'tv') _loadExtras();
    });
    _loadExtras();
    life = AppLifecycleListener(
      onResume: () async {
        _loadApps();
        _loadShelf();
        // The TV woke up with Korie open: Who's Watching, as when it starts.
        if (await Android.wokeUp() && store.pickOnWake && mounted) {
          final nav = Navigator.of(context);
          nav.popUntil((r) => r.isFirst);
          nav.push(_fade(Profiles(store: store, atStart: true, overHome: true)));
        }
      },
    );
  }

  @override
  void dispose() {
    store.removeListener(_changed);
    shelfTimer?.cancel();
    AddonHost.instance.removeListener(_addonsChanged);
    _addonUpdates?.cancel();
    life.dispose();
    scrollAnim.dispose();
    carouselNode.dispose();
    for (final n in nodes.values) {
      n.dispose();
    }
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
    _loadShelf();
  }

  bool _firstFocus = true;

  /// Past initState: changes go through setState from here on.
  bool _ready = false;

  Future<void> _loadApps() async {
    final a = await HomeCache.instance.refreshApps();
    if (!mounted) return;
    if (a.isEmpty && _android.isNotEmpty) return; // keep what we had rather than an empty dock
    _android = a;
    setState(() => apps = [...a, ..._extra]);
    _focusFirstApp();
  }

  /// Start on the first app in the dock once the apps are there.
  void _focusFirstApp() {
    if (!_firstFocus) return;
    _firstFocus = false;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ids = shown;
      if (ids.isNotEmpty && mounted) nodeFor(ids.first).requestFocus();
    });
  }

  bool _extrasBusy = false, _extrasAgain = false;

  /// Korie TV's card (when an add-on gives anything to watch) and add-ons' own tiles.
  Future<void> _loadExtras() async {
    // Until the add-ons have started, the cards kept from last time stay as they are.
    if (!AddonHost.instance.ready) return;
    if (_extrasBusy) {
      _extrasAgain = true;
      return;
    }
    _extrasBusy = true;
    try {
      final lib = TvLibrary(AddonHost.instance);
      final tiles = await lib.tiles();
      final extra = <App>[if (lib.hasContent) App(id: Store.tvId, label: 'Korie TV', system: true)];
      for (final t in tiles) {
        if (!_tileArt.containsKey(t.image)) {
          Uint8List? b;
          try {
            b = t.image.startsWith('http') ? await fetchBytes(t.image) : (t.image.isEmpty ? null : await File(t.image).readAsBytes());
          } catch (_) {}
          _tileArt[t.image] = b;
        }
        extra.add(App(id: t.appId, label: t.title, banner: _tileArt[t.image], system: true));
      }
      if (!mounted) return;
      final same = extra.length == _extra.length && [for (var i = 0; i < extra.length; i++) extra[i].id == _extra[i].id && extra[i].label == _extra[i].label && extra[i].banner == _extra[i].banner].every((x) => x);
      _tiles = tiles;
      if (same) return;
      _extra = extra;
      HomeCache.instance.setExtra(extra);
      setState(() => apps = [..._android, ...extra]);
    } finally {
      _extrasBusy = false;
      if (_extrasAgain) {
        _extrasAgain = false;
        _loadExtras();
      }
    }
  }

  /// Korie's own cards among the apps: no App Info or Uninstall for these.
  static bool isOwn(String id) => id == Store.settingsId || id == Store.folderId || id == Store.tvId || id.startsWith('addon:');

  Future<void> _loadShelf() async {
    final cache = HomeCache.instance;
    final profile = store.current.id;
    // The apps' part and the add-ons' part come in their own time; each shows as soon as it is there.
    final device = cache.refreshDevice().then((r) {
      if (mounted) _show(r.granted, r.items, cache.addons[profile] ?? const []);
    });
    final addons = cache.refreshAddons(profile).then((a) {
      if (mounted) _show(cache.deviceGranted, cache.device, a);
    });
    await Future.wait([device, addons]);
  }

  /// The carousel from the apps' items and the add-ons' items: Continue Watching from apps
  /// first, then the add-ons' items, then the apps' own rows.
  void _show(bool granted, List<ShelfItem> device, List<ShelfItem> fromAddons) {
    final removed = store.removed;
    final fromApps = device.where((i) => !removed.contains(i.key)).where((i) => i.isContinue ? store.showContinue : store.showAppRows).toList();
    final items = [...fromApps.where((i) => i.isContinue), ...fromAddons.where((i) => !removed.contains(i.key)), ...fromApps.where((i) => !i.isContinue)];
    void apply() {
      shelfGranted = granted;
      shelf = items;
      if (heroIndex >= shelf.length) heroIndex = 0;
    }

    _ready ? setState(apply) : apply();
    // The blurred picture behind the dock, made in the background for items that have none yet.
    () async {
      var any = false;
      for (final i in items) {
        if (tiny.containsKey(i.key)) continue;
        tiny[i.key] = await tinyImage(i.art);
        any = true;
      }
      if (any && mounted) setState(() {});
    }();
  }

  /// OK on a carousel item: an app's item opens in its app. An add-on's item plays at once: a film
  /// with Resume (or Play), a series at the episode the add-on points to (the one in progress or
  /// next up, its "focus"). [choose] (the hold menu's Episodes) lists seasons and episodes
  /// instead, opened at that same season and episode.
  Future<void> _openShelf(ShelfItem it, {bool choose = false}) async {
    final id = it.addon;
    if (id == null) return Android.openItem(it);
    final host = AddonHost.instance;
    final item = it.data ?? const {};
    final detail = host.handles(id).contains('detail') ? await host.call(id, 'detail', [item]) : null;
    if (!mounted) return;
    final d = detail is Map ? detail : const {};
    final buttons = [for (final b in (d['buttons'] is List ? d['buttons'] as List : const [])) if (b is Map) b];
    final seasons = [for (final b in (d['seasons'] is List ? d['seasons'] as List : const [])) if (b is Map) b];
    if (seasons.isNotEmpty) {
      final focus = d['focus'] is Map ? d['focus'] as Map : const {};
      var si = seasons.indexWhere((x) => x['id'] == focus['season']);
      if (choose || si < 0 || focus['episode'] == null) {
        final picked = seasons.length == 1 ? 0 : await askChoice(context, title: it.title, choices: [for (final x in seasons) '${x['name'] ?? x['id']}'], selected: si);
        if (picked == null || !mounted) return;
        si = picked;
      }
      final raw = await host.call(id, 'episodes', [item, seasons[si]['id']]);
      if (!mounted || raw is! List) return;
      final eps = [for (final x in raw) if (x is Map) x];
      if (eps.isEmpty) return;
      final ei = eps.indexWhere((x) => x['id'] == focus['episode']);
      if (!choose && ei >= 0) {
        await host.call(id, 'action', [eps[ei], 'resume']);
        return;
      }
      final e = await askChoice(context, title: '${it.title} · ${seasons[si]['name'] ?? ''}', choices: [for (final x in eps) '${x['title'] ?? ''}'], selected: ei);
      if (e == null) return;
      await host.call(id, 'action', [eps[e], 'play']);
      return;
    }
    if (buttons.isEmpty) {
      await host.call(id, 'action', [item, 'play']);
      return;
    }
    var pick = 0; // the first button: Resume when started, else Play
    if (choose && buttons.length > 1) {
      final c = await askChoice(context, title: it.title, choices: [for (final b in buttons) b['sub'] == null ? '${b['label']}' : '${b['label']} · ${b['sub']}']);
      if (c == null) return;
      pick = c;
    }
    await host.call(id, 'action', [item, buttons[pick]['id'] ?? 'play']);
  }

  // ------------------------------------------------------------- the grid

  /// Ids in Home order, hidden apps left out; More Apps last when anything is hidden.
  List<String> get shown {
    final hidden = store.hidden;
    final byId = {for (final a in apps) a.id: a};
    final ids = store.order(apps).where((id) => byId.containsKey(id) && !hidden.contains(id)).toList();
    if (hidden.any(byId.containsKey)) ids.add(Store.folderId);
    return ids;
  }

  FocusNode nodeFor(String id) => nodes.putIfAbsent(id, () => FocusNode(debugLabel: id));

  CardLook lookFor(String id) {
    if (id == Store.settingsId) {
      return const CardLook(label: 'Korie Settings', icon: Icons.tune_rounded, colors: [Color(0xFF7A6BFF), Color(0xFF3F33C9)]);
    }
    if (id == Store.folderId) {
      return const CardLook(label: 'More Apps', icon: Icons.apps_rounded, colors: [Color(0xFF6B70F0), Color(0xFF4A4FD0)]);
    }
    if (id == Store.tvId) {
      return const CardLook(label: 'Korie TV', icon: Icons.live_tv_rounded, colors: [Color(0xFF34386E), Color(0xFF15162E)], caption: 'Korie TV');
    }
    final a = apps.firstWhere((x) => x.id == id);
    if (id.startsWith('addon:') && a.banner == null) {
      final t = _tiles.where((t) => t.appId == id).firstOrNull;
      final c = t?.colors ?? const [];
      return CardLook(
        label: a.label,
        icon: tvIcon(t?.icon ?? 'list'),
        colors: c.length >= 2 ? [Color(c[0]), Color(c[1])] : (c.length == 1 ? [Color(c[0]), Color(c[0])] : null),
        caption: a.label,
      );
    }
    return CardLook(label: a.label, app: a);
  }

  void _focused(int i, Geo g) {
    final row = i ~/ g.cols;
    setState(() {
      focusedIndex = i;
      carouselFocused = false;
    });
    _scrollTo(g.scrollFor(row));
  }

  void _scrollTo(double target) {
    if ((target - scrollTo).abs() < 0.5) return;
    scrollFrom = scroll;
    scrollTo = target;
    scrollAnim.forward(from: 0);
  }

  void open(String id) {
    if (id == Store.settingsId) {
      Navigator.of(context).push(_fade(Settings(store: store)));
    } else if (id == Store.folderId) {
      Navigator.of(context).push(_fade(Folder(store: store, apps: apps)));
    } else if (id == Store.tvId) {
      Navigator.of(context).push(_fade(KorieTv(store: store)));
    } else if (id.startsWith('addon:')) {
      final t = _tiles.where((t) => t.appId == id).firstOrNull;
      if (t == null) return;
      if (t.section != null) {
        Navigator.of(context).push(_fade(KorieTv(store: store, page: t.section!)));
      } else {
        AddonHost.instance.call(t.addon, 'tile', [t.id]);
      }
    } else {
      Android.launch(id);
    }
  }

  Future<void> options(String id, Geo g, int index) async {
    final look = lookFor(id);
    final own = id == Store.settingsId || id == Store.folderId;
    final app = isOwn(id) ? null : apps.firstWhere((a) => a.id == id);
    final rect = _cardRect(index, g);
    await showOptions(
      context,
      geo: g,
      anchor: rect,
      title: look.label,
      items: [
        MenuItem('Open', () => open(id)),
        if (id != Store.folderId) MenuItem('Move', () => setState(() => movingId = id)),
        if (!own) MenuItem('Hide', () => store.setHidden(id, true)),
        if (!isOwn(id)) MenuItem('App Info', () => Android.appInfo(id)),
        if (app != null && !app.system) MenuItem('Uninstall', () => Android.uninstall(id)),
        MenuItem('Reset Layout', store.resetLayout),
      ],
    );
    // Back on the card that was held (or the first app if it was hidden).
    if (!mounted) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ids = shown;
      final target = ids.contains(id) ? id : (ids.isEmpty ? null : ids[(index).clamp(0, ids.length - 1)]);
      if (target != null) nodeFor(target).requestFocus();
    });
  }

  Rect _cardRect(int i, Geo g) {
    final r = i ~/ g.cols, c = i % g.cols;
    return Rect.fromLTWH(g.colLeft(c), g.rowTop(r) - scroll, g.tileW, g.tileH);
  }

  void move(TraversalDirection d, Geo g) {
    final ids = shown.where((x) => x != Store.folderId).toList();
    final from = ids.indexOf(movingId!);
    var to = switch (d) {
      TraversalDirection.left => from - 1,
      TraversalDirection.right => from + 1,
      TraversalDirection.up => from - g.cols,
      TraversalDirection.down => from + g.cols,
    };
    if (to > ids.length - 1 && from ~/ g.cols < (ids.length - 1) ~/ g.cols) to = ids.length - 1;
    if (to < 0 || to > ids.length - 1 || to == from) return;
    ids.insert(to, ids.removeAt(from));
    final hidden = store.order(apps).where(store.hidden.contains);
    store.saveOrder([...ids, ...hidden]);
    _focused(to, g);
  }

  /// Back on Home: stop moving, or go back to the first app in the dock.
  void back() {
    if (movingId != null) {
      setState(() => movingId = null);
      return;
    }
    final ids = shown;
    if (ids.isNotEmpty) nodeFor(ids.first).requestFocus();
  }

  /// The Home button while Korie is open: close what is open and go to the first dock app.
  void homePressed() {
    Navigator.of(context).popUntil((r) => r.isFirst);
    setState(() => movingId = null);
    back();
  }

  // ------------------------------------------------------------- carousel keys

  bool _carouselPressed = false, _carouselHeld = false;

  /// Left/Right browse the carousel and Down returns to the dock app you came from (as in Hume);
  /// OK opens the item, holding OK (or Menu) offers its options.
  KeyEventResult _carouselKey(FocusNode n, KeyEvent e, Geo g) {
    final k = e.logicalKey;
    if (shelf.isEmpty) return KeyEventResult.ignored;
    if (e is! KeyUpEvent && (k == LogicalKeyboardKey.arrowLeft || k == LogicalKeyboardKey.arrowRight)) {
      setState(() => heroIndex = (heroIndex + (k == LogicalKeyboardKey.arrowRight ? 1 : -1)) % shelf.length);
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.arrowDown && e is KeyDownEvent) {
      final ids = shown;
      if (ids.isNotEmpty) nodeFor(ids[focusedIndex.clamp(0, g.cols - 1).clamp(0, ids.length - 1)]).requestFocus();
      return KeyEventResult.handled;
    }
    final ok = k == LogicalKeyboardKey.select || k == LogicalKeyboardKey.enter || k == LogicalKeyboardKey.numpadEnter || k == LogicalKeyboardKey.gameButtonA;
    if (ok) {
      if (e is KeyDownEvent) {
        _carouselPressed = true;
        _carouselHeld = false;
      } else if (e is KeyRepeatEvent && _carouselPressed && !_carouselHeld) {
        _carouselHeld = true;
        _itemOptions(g);
      } else if (e is KeyUpEvent) {
        if (_carouselPressed && !_carouselHeld) _openShelf(shelf[heroIndex]);
        _carouselPressed = false;
      }
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.contextMenu && e is KeyDownEvent) {
      _itemOptions(g);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  Future<void> _itemOptions(Geo g) async {
    final it = shelf[heroIndex];
    await showOptions(
      context,
      geo: g,
      anchor: Rect.fromLTWH(g.side, g.h - g.dp(120), g.dp(200), g.dp(32)),
      title: it.title,
      items: [
        MenuItem(it.button, () => _openShelf(it)),
        if (it.addon != null) MenuItem(it.data?['type'] == 'series' ? 'Episodes' : 'More', () => _openShelf(it, choose: true)),
        MenuItem('Remove', () => store.removeItem(it.key)),
      ],
    );
    if (mounted) WidgetsBinding.instance.addPostFrameCallback((_) => carouselNode.requestFocus());
  }

  // ------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) => back(),
      child: Material(
        color: Colors.black,
        child: LayoutBuilder(
          builder: (context, c) {
            final g = Geo(c.maxWidth, c.maxHeight);
            return AnimatedBuilder(animation: scrollAnim, builder: (context, _) => _page(context, g));
          },
        ),
      ),
    );
  }

  Widget _page(BuildContext context, Geo g) {
    final ids = shown;
    final s = scroll;
    final row = focusedIndex ~/ g.cols;
    final hasItem = shelf.isNotEmpty;
    final item = hasItem ? shelf[heroIndex.clamp(0, shelf.length - 1)] : null;
    final heroShown = hasItem && s < 1 && (carouselFocused || row == 0);
    final screen = Size(g.w, g.h);
    final wall = wallpaperGradient(store.wallpaper);
    final blurred = heroShown && item != null ? tiny[item.key] : null;
    final slide = carouselFocused ? g.h - g.dockTop + g.dp(40) : 0.0;

    return Stack(
      children: [
        // Background: the item's artwork while the dock or carousel has the focus, otherwise the wallpaper.
        Positioned.fill(
          child: DecoratedBox(decoration: BoxDecoration(gradient: wall)),
        ),
        Positioned.fill(
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: heroShown && item?.art != null
                ? _Artwork(key: ValueKey(item!.key), bytes: item.art!, width: g.w)
                : const SizedBox.expand(key: ValueKey('none')),
          ),
        ),

        // The carousel's focus target: the whole band above the dock, so Up from any dock app lands here.
        Positioned(
          left: 0,
          right: 0,
          top: g.dp(60),
          height: g.dockTop - g.dp(64),
          child: Focus(
            focusNode: carouselNode,
            // Only reachable from the dock (as in Hume): on the rows below, the grid has slid up
            // under this band, and Left/Right would otherwise find it as the nearest thing.
            canRequestFocus: hasItem && (row == 0 || carouselFocused),
            skipTraversal: !(hasItem && (row == 0 || carouselFocused)),
            onKeyEvent: (n, e) => _carouselKey(n, e, g),
            onFocusChange: (v) {
              setState(() => carouselFocused = v);
              if (v) _scrollTo(0);
            },
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: item == null ? null : () => _openShelf(item),
              onHorizontalDragEnd: (d) {
                if (shelf.isEmpty) return;
                final v = d.primaryVelocity ?? 0;
                if (v.abs() > 200) setState(() => heroIndex = (heroIndex + (v < 0 ? 1 : -1)) % shelf.length);
              },
              child: const SizedBox.expand(),
            ),
          ),
        ),

        // Title, app and time left; overview and button only while the carousel itself is focused.
        if (item != null)
          AnimatedPositioned(
            duration: const Duration(milliseconds: 260),
            curve: Curves.easeOutCubic,
            left: g.side,
            bottom: carouselFocused ? g.dp(40) : g.h - (g.dockTop - g.dp(36)),
            child: IgnorePointer(
              child: AnimatedOpacity(
                opacity: heroShown ? 1 : 0,
                duration: const Duration(milliseconds: 200),
                child: _HeroInfo(item: item, g: g, open: carouselFocused),
              ),
            ),
          ),
        if (item != null && shelf.length > 1)
          AnimatedPositioned(
            duration: const Duration(milliseconds: 260),
            left: 0,
            right: 0,
            bottom: carouselFocused ? g.dp(22) : g.h - (g.dockTop - g.dp(12)),
            child: IgnorePointer(
              child: AnimatedOpacity(
                opacity: heroShown ? 1 : 0,
                duration: const Duration(milliseconds: 200),
                child: _Dots(n: shelf.length, at: heroIndex, g: g),
              ),
            ),
          ),

        // Dock and app grid. Scrolls by itself (no scroll view), so focus never jumps the page;
        // slides away while the carousel has the focus.
        TweenAnimationBuilder<double>(
          tween: Tween(end: slide),
          duration: const Duration(milliseconds: 280),
          curve: Curves.easeOutCubic,
          builder: (context, v, _) => Positioned.fill(
            child: Transform.translate(
              offset: Offset(0, v - s),
              child: GestureDetector(
                behavior: HitTestBehavior.translucent,
                onVerticalDragUpdate: (d) {
                  final last = (ids.length - 1) ~/ g.cols;
                  final max = g.scrollFor(last);
                  scrollFrom = (scroll - d.delta.dy).clamp(0, max);
                  scrollTo = scrollFrom;
                  scrollAnim.value = 1;
                  setState(() {});
                },
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    if (s > 1)
                      Positioned(
                        left: 0,
                        right: 0,
                        top: g.dockTop - g.dp(26),
                        child: Icon(Icons.keyboard_arrow_up_rounded, size: g.dp(26), color: Colors.white70),
                      ),
                    Positioned(
                      left: g.dockOuter,
                      top: g.dockTop,
                      width: g.w - 2 * g.dockOuter,
                      height: g.dockH,
                      child: GlassPanel(
                        rect: Rect.fromLTWH(g.dockOuter, g.dockTop - s + v, g.w - 2 * g.dockOuter, g.dockH),
                        screen: screen,
                        radius: g.radius * 2.2,
                        blurred: blurred,
                        wallpaper: wall,
                      ),
                    ),
                    for (final (i, id) in ids.indexed)
                      Positioned(
                        key: ValueKey(id),
                        left: g.colLeft(i % g.cols),
                        top: g.rowTop(i ~/ g.cols),
                        child: AppCard(
                          look: lookFor(id),
                          geo: g,
                          focusNode: nodeFor(id),
                          showLabel: i >= g.cols,
                          firstInRow: i % g.cols == 0,
                          lastInRow: i % g.cols == g.cols - 1 || i == ids.length - 1,
                          moving: movingId == id,
                          onFocused: () => _focused(i, g),
                          onOpen: () => open(id),
                          onHold: () => options(id, g, i),
                          onMove: (d) => move(d, g),
                          onMoveDone: () => setState(() => movingId = null),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Status capsule: time and profile, fading as the page scrolls down (as in Hume).
        Positioned(
          right: g.dockOuter + g.dp(2),
          top: g.dp(20),
          child: Opacity(
            opacity: (1 - s / (g.dockTop * 0.4)).clamp(0.0, 1.0),
            child: _Capsule(
              store: store,
              g: g,
              onSettings: () => Navigator.of(context).push(_fade(Settings(store: store))),
              onProfile: () => Navigator.of(context).push(_fade(Profiles(store: store))),
            ),
          ),
        ),

        if (movingId != null)
          Positioned(
            left: 0,
            right: 0,
            bottom: g.dp(30),
            child: Center(
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: g.dp(16), vertical: g.dp(9)),
                decoration: BoxDecoration(
                  color: const Color(0xCC1A1A20),
                  borderRadius: BorderRadius.circular(g.dp(18)),
                  border: Border.all(color: const Color(0x33FFFFFF)),
                ),
                child: Text('Use arrows to move  ·  OK when done', style: tx(g.dp(12))),
              ),
            ),
          ),
      ],
    );
  }
}

/// Screens open at once: no full-screen fade (an extra off-screen layer every frame on a TV GPU).
PageRoute<T> _fade<T>(Widget page) =>
    PageRouteBuilder<T>(pageBuilder: (_, _, _) => page, transitionDuration: Duration.zero, reverseTransitionDuration: Duration.zero);

PageRoute<T> fadeRoute<T>(Widget page) => _fade(page);

/// The item's artwork with Hume's shading baked in front: left reading shade, bottom shade for
/// the dock, top shade for the clock.
class _Artwork extends StatelessWidget {
  const _Artwork({super.key, required this.bytes, required this.width});
  final Uint8List bytes;
  final double width;
  @override
  Widget build(BuildContext context) {
    final dpr = MediaQuery.devicePixelRatioOf(context);
    return Stack(
      fit: StackFit.expand,
      children: [
        Image.memory(bytes, fit: BoxFit.cover, cacheWidth: (width * dpr).round(), gaplessPlayback: true),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [Color(0xCC000000), Color(0x66000000), Color(0x00000000)], stops: [0, 0.375, 0.75]),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0x14000000), Color(0x40000000), Color(0xB3000000)],
            ),
          ),
        ),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0x66000000), Color(0x00000000)], stops: [0, 0.2]),
          ),
        ),
      ],
    );
  }
}

class _HeroInfo extends StatelessWidget {
  const _HeroInfo({required this.item, required this.g, required this.open});
  final ShelfItem item;
  final Geo g;
  final bool open;
  @override
  Widget build(BuildContext context) {
    final icon = item.appIcon == null
        ? SizedBox(width: g.dp(30), height: g.dp(30))
        : ClipRRect(
            borderRadius: BorderRadius.circular(g.dp(7)),
            child: Image.memory(item.appIcon!, width: g.dp(30), height: g.dp(30), gaplessPlayback: true),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        icon,
        SizedBox(height: g.dp(12)),
        SizedBox(
          width: g.dp(420),
          child: Text(
            item.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: tx(g.dp(36), w: FontWeight.w800, height: 1.05, spacing: -g.dp(36) * 0.02),
          ),
        ),
        SizedBox(height: g.dp(10)),
        Text(item.meta, style: tx(g.dp(12.5), opacity: 0.8)),
        if (open && item.overview.isNotEmpty) ...[
          SizedBox(height: g.dp(6)),
          SizedBox(
            width: g.dp(380),
            child: Text(
              item.overview,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: tx(g.dp(12.5), w: FontWeight.w400, opacity: 0.8, height: 1.3),
            ),
          ),
        ],
        if (open) ...[
          SizedBox(height: g.dp(14)),
          Container(
            height: g.dp(32),
            padding: EdgeInsets.only(left: g.dp(18), right: g.dp(20)),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(g.dp(16))),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '▶  ${item.button}',
                  style: tx(g.dp(13), w: FontWeight.w600, color: const Color(0xFF111114)),
                ),
                if (item.appIcon != null) ...[
                  SizedBox(width: g.dp(9)),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(g.dp(5)),
                    child: Image.memory(item.appIcon!, width: g.dp(22), height: g.dp(22), gaplessPlayback: true),
                  ),
                ],
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _Dots extends StatelessWidget {
  const _Dots({required this.n, required this.at, required this.g});
  final int n, at;
  final Geo g;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      for (var i = 0; i < n; i++)
        Container(
          width: g.dp(4),
          height: g.dp(4),
          margin: EdgeInsets.symmetric(horizontal: g.dp(2.5)),
          decoration: BoxDecoration(shape: BoxShape.circle, color: i == at ? Colors.white : Colors.white38),
        ),
    ],
  );
}

/// Time and profile picture on a faint glass capsule, top right.
class _Capsule extends StatefulWidget {
  const _Capsule({required this.store, required this.g, required this.onProfile, required this.onSettings});
  final Store store;
  final Geo g;
  final VoidCallback onProfile, onSettings;
  @override
  State<_Capsule> createState() => _CapsuleState();
}

/// The top-right island: time, Settings and the profile, and in front of them what is playing
/// (another app's music, Korie's radio, a paused video), an add-on's news, or updates.
class _CapsuleState extends State<_Capsule> {
  Island get island => Island.instance;

  @override
  void initState() {
    super.initState();
    island.addListener(_changed);
  }

  @override
  void dispose() {
    island.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.g;
    final item = island.top;
    const dark = Color(0xFF111114);
    // Everything inside sits on one line of the same height, with the same room on every side
    // ([pad]), and nothing grows past it when focused: focus is shown by turning white.
    final pad = g.dp(4);
    final inner = g.dp(24);
    Widget round(IconData icon, bool f) => Container(
      width: inner,
      height: inner,
      decoration: BoxDecoration(shape: BoxShape.circle, color: f ? Colors.white : Colors.transparent),
      child: Icon(icon, size: g.dp(15), color: f ? dark : Colors.white),
    );
    final pic = g.dp(18);
    Widget picture(IslandItem it) {
      final r = BorderRadius.circular(g.dp(5));
      if (it.art != null) return ClipRRect(borderRadius: r, child: Image.memory(it.art!, width: pic, height: pic, fit: BoxFit.cover, gaplessPlayback: true));
      if (it.image != null && it.image!.startsWith('http')) {
        return ClipRRect(borderRadius: r, child: Image.network(it.image!, width: pic, height: pic, fit: BoxFit.cover, errorBuilder: (_, _, _) => SizedBox(width: pic)));
      }
      return Container(
        width: pic,
        height: pic,
        decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF2E6FE0)),
        child: Icon(it.icon ?? Icons.music_note_rounded, size: g.dp(12), color: Colors.white),
      );
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOut,
      height: inner + 2 * pad,
      width: item == null ? null : g.dp(290),
      padding: EdgeInsets.fromLTRB(item == null ? g.dp(12) : pad, pad, pad, pad),
      decoration: BoxDecoration(
        color: const Color(0x61141620),
        borderRadius: BorderRadius.circular((inner + 2 * pad) / 2),
        border: Border.all(color: const Color(0x47FFFFFF)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (item != null) ...[
            Expanded(
              child: HoldFocusable(
                key: ValueKey(item.key),
                onTap: () => item.onOk?.call(),
                onHold: item.onHold == null ? null : () => item.onHold!.call(),
                builder: (context, f) => Container(
                  height: inner,
                  padding: EdgeInsets.only(left: (inner - pic) / 2, right: g.dp(8)),
                  decoration: BoxDecoration(color: f ? Colors.white : Colors.transparent, borderRadius: BorderRadius.circular(inner / 2)),
                  child: Row(
                    children: [
                      picture(item),
                      SizedBox(width: g.dp(7)),
                      Expanded(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(item.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(10), w: FontWeight.w700, color: f ? dark : Colors.white, height: 1.1)),
                            if (item.sub.isNotEmpty)
                              Text(item.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(8.5), opacity: 0.7, color: f ? dark : Colors.white, height: 1.1)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            if (item.playing != null) ...[
              SizedBox(width: g.dp(2)),
              item.onToggle == null
                  ? SizedBox(width: inner, child: Icon(item.playing! ? Icons.equalizer_rounded : Icons.pause_rounded, size: g.dp(15)))
                  : Focusable(
                      onTap: () => item.onToggle!.call(),
                      builder: (context, f) => round(
                        f ? (item.playing! ? Icons.pause_rounded : Icons.play_arrow_rounded) : (item.playing! ? Icons.equalizer_rounded : Icons.pause_rounded),
                        f,
                      ),
                    ),
            ],
            SizedBox(width: g.dp(8)),
          ],
          Clock(style: tx(g.dp(13))),
          SizedBox(width: g.dp(6)),
          Focusable(onTap: widget.onSettings, builder: (context, f) => round(Icons.settings_rounded, f)),
          SizedBox(width: g.dp(2)),
          Focusable(
            onTap: widget.onProfile,
            builder: (context, f) => Container(
              width: inner,
              height: inner,
              alignment: Alignment.center,
              decoration: BoxDecoration(shape: BoxShape.circle, color: f ? Colors.white : Colors.transparent),
              child: Avatar(profile: widget.store.current, size: g.dp(f ? 19 : 22)),
            ),
          ),
        ],
      ),
    );
  }
}
