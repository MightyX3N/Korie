// Runs the real add-ons (radio, openfilms, zeroplay) on Korie's add-on host with real Lua and
// the real internet, plus the hard cases: requests inside pcall, a stuck add-on, timers, saving.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/addons/host.dart';
import 'package:korie/island.dart';
import 'package:korie/tv/library.dart';

const addonsDir = 'addons'; // this repository's add-ons

Uint8List pack(String folder) {
  final a = Archive();
  for (final f in Directory(folder).listSync(recursive: true).whereType<File>()) {
    final rel = f.path.substring(folder.length + 1);
    a.add(ArchiveFile.bytes(rel, f.readAsBytesSync()));
  }
  return Uint8List.fromList(ZipEncoder().encodeBytes(a));
}

Uint8List packText(Map<String, String> files) {
  final a = Archive();
  files.forEach((k, v) => a.add(ArchiveFile.bytes(k, utf8.encode(v))));
  return Uint8List.fromList(ZipEncoder().encodeBytes(a));
}

class FakeUi implements AddonUi {
  final calls = <String>[];
  final played = <Map>[];
  List<Object?>? Function(String op, List<Object?> args)? answer;
  @override
  Future<List<Object?>> request(String id, String op, List<Object?> args) async {
    calls.add('$id:$op');
    if (op == 'play') played.add(args[0] as Map);
    final a = answer?.call(op, args);
    if (a != null) return a;
    return switch (op) {
      'profile' => [{'id': 'p1', 'name': 'Anna'}],
      'profiles.list' => [[{'id': 'p1', 'name': 'Anna'}]],
      _ => [true],
    };
  }
}

void main() {
  final host = AddonHost.instance;
  final ui = FakeUi();
  late Directory base;

  setUpAll(() async {
    base = Directory.systemTemp.createTempSync('korie-addons');
    host.ui = ui;
    final ca = '${Platform.environment['HOME']}/.ccr/ca-bundle.crt';
    if (File(ca).existsSync()) host.caFile = ca;
    await host.init(base, device: {'tv': true, 'touch': false, 'android': 36, 'model': 'test', 'language': 'en', 'korie': '2.0'});
  });
  tearDownAll(() async => host.shutdown());

  test('a .korie file is read and refused when unsafe', () {
    final p = AddonHost.readPackage(pack('$addonsDir/radio'))!;
    expect(p.manifest.id, 'radio');
    expect(p.manifest.uses, ['internet']);
    expect(p.manifest.settings.first.options.length, greaterThan(10));
    expect(AddonHost.readPackage(packText({'../evil.lua': 'x', 'addon.json': '{"id":"x"}', 'main.lua': ''})), isNull);
    expect(AddonHost.readPackage(packText({'main.lua': ''})), isNull);
  });

  test('the add-ons install and start', () async {
    for (final id in ['radio', 'openfilms']) {
      final sw = Stopwatch()..start();
      await host.install(AddonHost.readPackage(pack('$addonsDir/$id'))!);
      expect(host.errorOf(id), isNull, reason: host.logOf(id).join('\n'));
      // ignore: avoid_print
      print('$id started in ${sw.elapsedMilliseconds} ms, handles ${host.handles(id)}');
      expect(host.handles(id), isNotEmpty);
    }
    expect(host.handlersOf('catalog').map((a) => a.id), containsAll(['openfilms', 'radio']));
  });

  test('openfilms: catalog, detail, and Play reaches the player', () async {
    final cat = await host.call('openfilms', 'catalog') as List;
    expect(cat.length, 2);
    final item = cat.first as Map;
    expect(item['title'], isA<String>());
    final detail = await host.call('openfilms', 'detail', [item]) as Map;
    final buttons = detail['buttons'] as List;
    expect(buttons, isNotEmpty);
    ui.played.clear();
    await host.call('openfilms', 'action', [item, (buttons.first as Map)['id']]);
    expect(ui.played.single['url'], startsWith('https://'));
    expect(ui.played.single['title'], isNotEmpty);
    // the player's report is saved and shows as Resume
    await host.call('openfilms', 'playback', [ui.played.single['ref'], {'state': 'stopped', 'position': 600, 'duration': 900}]);
    final again = await host.call('openfilms', 'detail', [item]) as Map;
    // ignore: avoid_print
    print('openfilms buttons after 10 min: ${again['buttons']}');
    expect(jsonEncode(again['buttons']), contains('Resume'));
  });

  test('radio: real stations from the internet (requests inside pcall work)', () async {
    final sw = Stopwatch()..start();
    final cat = await host.call('radio', 'catalog') as List?;
    // ignore: avoid_print
    print('radio catalog: ${cat?.length} stations in ${sw.elapsedMilliseconds} ms; first ${(cat?.first as Map?)?['title']}');
    expect(cat, isNotNull, reason: host.logOf('radio').join('\n'));
    expect(cat!.length, greaterThan(5));
    ui.played.clear();
    await host.call('radio', 'action', [cat.first, 'play']);
    expect(ui.played.single['audio'], true, reason: host.logOf('radio').join('\n'));
    // Its own section in Korie TV, and its own tile on Home that opens it.
    final tv = TvLibrary(host);
    expect((await tv.sections()).map((x) => '${x.page} ${x.title} ${x.icon}'), contains('radio/radio Radio radio'));
    final tile = (await tv.tiles()).firstWhere((t) => t.addon == 'radio');
    expect([tile.appId, tile.title, tile.section, tile.colors.length], ['addon:radio:radio', 'Radio', 'radio/radio', 2]);
    final page = await tv.page('radio/radio');
    expect(page.rows.first.title, 'Most Listened');
    expect(page.rows.first.square, true);
    expect(page.rows.first.items.first.title, (cat.first as Map)['title']);
    // Stations stay out of Korie TV's Home (films and series only) but are found in Search.
    final home = await tv.page('home');
    expect(home.rows.expand((r) => r.items).where((i) => i.type == 'radio'), isEmpty);
    expect((await tv.search('${(cat.first as Map)['title']}')).first.type, 'radio');
  });

  test('the Korie add-on list downloads and its files install', () async {
    final list = await host.fetchIndex();
    // ignore: avoid_print
    print('add-on list: ${[for (final e in list) '${e.id} ${e.version}']}');
    expect(list.map((e) => e.id), containsAll(['radio', 'openfilms', 'zeroplay']));
    final of = list.firstWhere((e) => e.id == 'openfilms');
    final p = AddonHost.readPackage(await host.download(of.url));
    expect(p?.manifest.id, 'openfilms');
  });

  test('time spent on an add-on question does not count against its time limit', () async {
    await host.install(AddonHost.readPackage(packText({
      'addon.json': '{"id":"slowask","name":"Slow"}',
      'main.lua': 'korie.on("home", function() local a = korie.ask{ title = "Q", input = "text" } return { { title = a } } end)',
    }))!);
    ui.answer = null;
    final slow = FakeUi();
    host.ui = _DelayedUi(slow, const Duration(seconds: 10));
    final sw = Stopwatch()..start();
    final r = await host.call('slowask', 'home');
    host.ui = ui;
    // ignore: avoid_print
    print('answered after ${sw.elapsedMilliseconds} ms (limit 8 s)');
    expect(r, [{'title': true}]);
  });

  test('an add-on in the island: shown, play/pause, and korie.update refreshes it', () async {
    await host.install(AddonHost.readPackage(packText({
      'addon.json': '{"id":"islandtest","name":"Island Test"}',
      'main.lua': '''
        local playing = true
        korie.on("island", function() return { title = "DR P3", sub = "Radio · Live", playing = playing } end)
        korie.on("island.toggle", function() playing = not playing; korie.update("island") end)
        korie.on("island.hold", function() playing = nil; korie.update("island") end)
      ''',
    }))!);
    final island = Island.instance;
    island.start();
    await island.refreshAddons();
    expect(island.top?.title, 'DR P3');
    expect(island.top?.playing, true);
    await island.top!.onToggle!();
    await Future<void>.delayed(const Duration(milliseconds: 500));
    expect(island.top?.playing, false, reason: 'korie.update("island") made Korie ask again');
    await host.uninstall('islandtest');
    await island.refreshAddons();
    expect(island.top, isNull);
  });

  test('settings reach the add-on and are saved', () async {
    await host.setSetting('radio', 'country', 'SE');
    expect(host.settingsOf('radio')['country'], 'SE');
    expect(host.settingsOf('radio')['autostart'], false);
  });

  test('a stuck add-on is stopped and started again; others keep working', () async {
    await host.install(AddonHost.readPackage(packText({
      'addon.json': '{"id":"stuck","name":"Stuck"}',
      'main.lua': '''
        korie.on("search", function(t) while true do end end)
        korie.on("home", function() return { { title = "ok " .. korie.store.get("n", 0) } } end)
        korie.store.set("n", korie.store.get("n", 0) + 1)
        local hits = 0
        korie.timer(0.05, function() hits = hits + 1 korie.store.set("hits", hits) end, true)
        local ok, r = pcall(function() return korie.profile() end)
        korie.store.set("who", ok and r.name or "?")
      ''',
    }))!);
    expect((await host.call('stuck', 'home') as List).single, {'title': 'ok 1'});
    final sw = Stopwatch()..start();
    expect(await host.call('stuck', 'search', ['x'], const Duration(seconds: 15)), isNull);
    // ignore: avoid_print
    print('stuck search gave up after ${sw.elapsedMilliseconds} ms; log ${host.logOf('stuck')}');
    await Future<void>.delayed(const Duration(seconds: 2));
    // restarted: main.lua ran again, its saved count went up
    expect((await host.call('stuck', 'home') as List).single, {'title': 'ok 2'});
    final cat = await host.call('openfilms', 'catalog') as List;
    expect(cat.length, 2);
    final store = jsonDecode(File('${base.path}/addon-data/stuck/store.json').readAsStringSync()) as Map;
    expect(store['who'], 'Anna');
    expect(store['hits'], greaterThan(3));
  });
  test('zeroplay: set up by address, nothing in the island, Play opens the page full screen', () async {
    // A small ZeroPlay: no sign-in needed at home, one Xbox streaming a game.
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var launched = 0;
    server.listen((r) async {
      final body = switch (r.uri.path) {
        '/api/access' => {'verdict': 'ok'},
        '/api/library' => {
            'consoles': [{'id': 'x1', 'name': 'Living Room', 'power': 'On'}],
            'games': [{'id': 'g1', 'name': 'Forza Horizon 5', 'console': 'x1', 'image': '', 'hero': ''}],
            'stream': {'state': 'live', 'console': 'x1', 'consoleName': 'Living Room', 'title': '{"focused":true,"name":"Forza Horizon 5"}'},
          },
        '/api/launch' => () {
            launched++;
            return {'ok': true};
          }(),
        _ => null,
      };
      if (body == null) r.response.statusCode = 404;
      r.response.headers.contentType = ContentType.json;
      r.response.write(jsonEncode(body ?? {}));
      await r.response.close();
    });
    final url = 'http://127.0.0.1:${server.port}';
    await host.install(AddonHost.readPackage(pack('$addonsDir/zeroplay'))!);
    expect(host.errorOf('zeroplay'), isNull, reason: host.logOf('zeroplay').join('\n'));
    final browsed = <Map>[];
    ui.answer = (op, args) => switch (op) {
          'ask' when (args[0] as Map)['choices'] != null => [2], // Type the address
          'ask' when (args[0] as Map)['input'] == 'text' => [url],
          'browse' => () {
              browsed.add(args[0] as Map);
              return [true];
            }(),
          _ => null,
        };
    try {
      await host.call('zeroplay', 'button', ['server']);
      final games = await host.call('zeroplay', 'catalog') as List;
      expect((games.single as Map)['title'], 'Forza Horizon 5');

      // The Xbox being on is not shown: Korie shows a stream itself when it runs in the background.
      expect(host.handles('zeroplay'), isNot(contains('island')));

      await host.call('zeroplay', 'action', [games.single, 'play']);
      expect(launched, 1);
      expect(browsed.single['fullscreen'], true);
      expect(browsed.single['url'], startsWith('$url/?play=1&console=x1'));
      expect(browsed.single['title'], 'Forza Horizon 5');
    } finally {
      ui.answer = null;
      await server.close(force: true);
      await host.uninstall('zeroplay');
      await Island.instance.refreshAddons();
    }
  });
}

class _DelayedUi implements AddonUi {
  _DelayedUi(this.inner, this.delay);
  final AddonUi inner;
  final Duration delay;
  @override
  Future<List<Object?>> request(String id, String op, List<Object?> args) async {
    await Future<void>.delayed(delay);
    return inner.request(id, op, args);
  }
}
