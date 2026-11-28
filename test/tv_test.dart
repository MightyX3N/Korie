// Korie TV with the remote only: a real add-on (real Lua on Korie's add-on host) fills it, and the
// arrow keys, OK and Back go everywhere: the featured picture, the rows, the sidebar, a section,
// a title's page and back.
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/addons/host.dart';
import 'package:korie/addons/korie_ui.dart';
import 'package:korie/store.dart';
import 'package:korie/tv/title.dart';
import 'package:korie/tv/tv.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'addons_test.dart' show packText;

const demo = '''
local function film(id, title, genres, added, extra)
  local f = { id = id, type = "movie", title = title, genres = genres, added = added, year = "2024", runtime = 100,
    overview = "About " .. title, backdrop = "", poster = "" }
  for k, v in pairs(extra or {}) do f[k] = v end
  return f
end
local list = {
  film("a", "Alpha", "Drama, Crime", "2026-11-05", { backdrop = "x" }),
  film("b", "Bravo", "Drama", "2026-11-04", { backdrop = "x" }),
  film("c", "Charlie", "Comedy", "2026-11-03"),
  film("d", "Delta", "Comedy, Drama", "2026-11-02"),
  { id = "s", type = "series", title = "Series One", genres = "Drama", added = "2026-11-06", backdrop = "x" },
}
korie.on("catalog", function() return list end)
korie.on("home", function() return { { id = "b", title = "Bravo", type = "movie", progress = 0.4, remaining = 50, backdrop = "x" } } end)
korie.on("detail", function(item)
  if item.type == "series" then
    return { seasons = { { id = "s1", name = "Season 1" }, { id = "s2", name = "Season 2" } }, focus = { season = "s2", episode = "e23" } }
  end
  return { buttons = { { id = "resume", label = "Resume", sub = "50m left" }, { id = "play", label = "Play from the Start" } } }
end)
korie.on("episodes", function(item, season)
  local out = {}
  for i = 1, 5 do out[i] = { id = "e" .. string.sub(season, 2) .. i, title = i .. ". Part " .. i, progress = (season == "s2" and i == 3) and 0.5 or 0 } end
  return out
end)
korie.on("action", function(item, button) korie.store.set("last", (item.id or "?") .. ":" .. button) end)
korie.on("last", function() return korie.store.get("last") end)
korie.on("tv.sections", function() return { { id = "live", title = "Live TV", icon = "live" } } end)
korie.on("tv", function(page)
  if page == "live" then
    return { rows = { { title = "Channels", style = "square", items = { { id = "ch1", title = "Channel 1" }, { id = "ch2", title = "Channel 2" } } } } }
  end
end)
''';

String? focused() => FocusManager.instance.primaryFocus?.debugLabel;

void main() {
  final host = AddonHost.instance;

  setUpAll(() async {
    final base = Directory.systemTemp.createTempSync('korie-tv');
    await host.init(base, device: {'tv': true});
    await host.install(AddonHost.readPackage(packText({'addon.json': '{"id":"demo","name":"Demo"}', 'main.lua': demo}))!);
    await host.refreshCatalog('demo');
  });
  tearDownAll(() async => host.shutdown());

  Future<void> settle(WidgetTester t, [int ms = 400]) async {
    for (var i = 0; i < 6; i++) {
      await t.runAsync(() => Future<void>.delayed(Duration(milliseconds: ms ~/ 6)));
      await t.pump(const Duration(milliseconds: 100));
    }
    await t.pump(const Duration(milliseconds: 400));
  }

  Future<void> key(WidgetTester t, LogicalKeyboardKey k) async {
    await t.sendKeyEvent(k);
    await settle(t, 300);
  }

  testWidgets('Korie TV with the remote', (t) async {
    t.view.physicalSize = const Size(1280, 720);
    t.view.devicePixelRatio = 1;
    SharedPreferences.setMockInitialValues({});
    final store = await t.runAsync(Store.open);
    final nav = GlobalKey<NavigatorState>();
    host.ui = KorieAddonUi(store!, nav);
    await t.pumpWidget(MaterialApp(navigatorKey: nav, home: KorieTv(store: store)));
    await settle(t, 1500);

    // Starts on the featured picture's Play.
    expect(focused(), 'tv.first');
    expect(find.text('Series One'), findsWidgets, reason: 'the newest title with a backdrop is featured');
    expect(find.text('Continue Watching'), findsOneWidget);

    // Down: Continue Watching; OK resumes Bravo at once.
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), 'tv.firstCard');
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 800);
    expect(await t.runAsync(() => host.call('demo', 'last')), 'b:resume', reason: 'Continue Watching carries on at once');

    // Down again: the next row moves up under the capsule; Up comes back.
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(find.text('Recently Added Movies'), findsOneWidget);
    await key(t, LogicalKeyboardKey.arrowUp);
    expect(focused(), 'tv.firstCard');

    // Left from the first card: the sidebar, on Home. Down to Movies, OK.
    await key(t, LogicalKeyboardKey.arrowLeft);
    expect(focused(), 'tv.side.home');
    expect(find.text('Live TV'), findsOneWidget, reason: "the add-on's own section");
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), 'tv.side.movies');
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 1200);
    expect(find.text('Movies'), findsWidgets);
    expect(focused(), 'tv.first');
    expect(find.text('Drama'), findsWidgets, reason: 'a row per genre');

    // Down to Recently Added, OK on the first poster: the film's page with the add-on's buttons.
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 1500);
    expect(find.byType(TvTitle), findsOneWidget);
    expect(find.text('Resume'), findsOneWidget);
    expect(find.text('Play from the Start'), findsOneWidget);
    expect(focused(), 'title.first');
    expect(find.text('More Like This'), findsOneWidget);
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), isNot('title.first'), reason: 'Down reaches More Like This');
    // Back: the Movies page again, then Back opens the sidebar, and Back there leaves.
    await t.runAsync(() => nav.currentState!.maybePop());
    await settle(t, 800);
    expect(find.byType(TvTitle), findsNothing);
    await t.runAsync(() => nav.currentState!.maybePop());
    await settle(t);
    expect(focused(), 'tv.side.movies');

    // Playlists, then the add-on's own section: square logos.
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), 'tv.side.playlists');
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), 'tv.side.demo/live');
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 1200);
    expect(find.text('Channels'), findsOneWidget);
    expect(find.text('Channel 1'), findsOneWidget);
    expect(focused(), 'tv.firstCard');
    // Right closes nothing it shouldn't; Left from the first card opens the sidebar again.
    await key(t, LogicalKeyboardKey.arrowLeft);
    expect(focused(), 'tv.side.demo/live');
    // Right: back into the page, the sidebar closes.
    await key(t, LogicalKeyboardKey.arrowRight);
    expect(focused(), 'tv.firstCard');
    expect(find.text('From your add-ons'), findsNothing);
  });

  testWidgets("a series' page opens at the episode to watch", (t) async {
    t.view.physicalSize = const Size(1280, 720);
    t.view.devicePixelRatio = 1;
    SharedPreferences.setMockInitialValues({});
    final store = await t.runAsync(Store.open);
    final nav = GlobalKey<NavigatorState>();
    host.ui = KorieAddonUi(store!, nav);
    await t.pumpWidget(MaterialApp(navigatorKey: nav, home: KorieTv(store: store, page: 'series')));
    await settle(t, 1500);
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 1500);
    expect(find.text('Resume'), findsOneWidget);
    expect(find.text('S2 E3'), findsOneWidget);
    expect(find.text('Season 2'), findsOneWidget);
    // Down lands on the season being shown (Season 2), not the nearest tab, and keeps its episodes.
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focused(), 'title.season1');
    expect(find.text('Part 3'), findsOneWidget);
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.arrowUp);
    expect(focused(), 'title.season1', reason: 'Up from the episodes too');
    // Moving along the tabs shows that season.
    await key(t, LogicalKeyboardKey.arrowLeft);
    expect(focused(), 'title.season0');
    await settle(t, 600);
    await key(t, LogicalKeyboardKey.arrowUp);
    expect(focused(), 'title.first');
    await key(t, LogicalKeyboardKey.select);
    await settle(t, 800);
    expect(await t.runAsync(() => host.call('demo', 'last')), 'e23:resume');
  });

  testWidgets('Play before the player is set up answers the add-on', (t) async {
    SharedPreferences.setMockInitialValues({});
    final store = await t.runAsync(Store.open);
    final nav = GlobalKey<NavigatorState>();
    final ui = KorieAddonUi(store!, nav);
    await t.pumpWidget(MaterialApp(navigatorKey: nav, home: const Scaffold(body: SizedBox())));
    final r = await ui.request('demo', 'play', [
      {'url': 'http://x/y.mkv'},
    ]);
    expect(r, [null, 'Korie has no player here']);
    // Set up (as Korie does at start), it goes to the player.
    Map<String, Object?>? got;
    ui.play = (id, req) async {
      got = req;
      return const [true];
    };
    expect(await ui.request('demo', 'play', [
      {'url': 'http://x/y.mkv'},
    ]), [true]);
    expect(got?['url'], 'http://x/y.mkv');
  });
}
