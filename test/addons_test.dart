// Runs the real add-ons (radio, openfilms, jellyfin) on Korie's add-on host with real Lua and
// the real internet, plus the hard cases: requests inside pcall, a stuck add-on, timers, saving.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/addons/host.dart';
import 'package:korie/island.dart';

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

  test('the three add-ons install and start', () async {
    for (final id in ['radio', 'openfilms', 'jellyfin']) {
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
  });

  test('jellyfin: profile switch, settings rows and the server question', () async {
    ui.calls.clear();
    await host.call('jellyfin', 'profile', [{'id': 'p1', 'name': 'Anna'}]);
    ui.answer = (op, args) => op == "ask" ? <Object?>[null] : null; // the viewer cancels
    await host.call('jellyfin', 'button', ['server']);
    ui.answer = null;
    // ignore: avoid_print
    print('jellyfin asked Korie: ${ui.calls}');
    expect(ui.calls, contains('jellyfin:ask'));
    expect(host.errorOf('jellyfin'), isNull);
  });

  test('the Korie add-on list downloads and its files install', () async {
    final list = await host.fetchIndex();
    // ignore: avoid_print
    print('add-on list: ${[for (final e in list) '${e.id} ${e.version}']}');
    expect(list.map((e) => e.id), containsAll(['jellyfin', 'radio', 'openfilms']));
    final of = list.firstWhere((e) => e.id == 'openfilms');
    final p = AddonHost.readPackage(await host.download(of.url));
    expect(p?.manifest.id, 'openfilms');
  });

  test('jellyfin 1.6: setup pages, users, passwords (against a fake Jellyfin server)', () async {
    final srv = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final users = [
      {'Id': 'u-anna', 'Name': 'Anna'},
      {'Id': 'u-mikkel', 'Name': 'Mikkel'},
    ];
    srv.listen((rq) async {
      final body = await utf8.decoder.bind(rq).join();
      final path = rq.uri.path;
      Object? out;
      var status = 200;
      if (path == '/System/Info/Public') {
        out = {'Id': 'srv1', 'ServerName': 'Home Server'};
      } else if (path == '/Users/AuthenticateByName') {
        final j = jsonDecode(body) as Map;
        final u = users.where((u) => u['Name'] == j['Username']).firstOrNull;
        if (u != null && j['Pw'] == 'secret ${u['Name']}!') {
          out = {'AccessToken': 'tok-${u['Id']}', 'User': u};
        } else {
          status = 401;
        }
      } else if (path == '/Users') {
        status = (rq.headers.value('authorization') ?? '').contains('Token="tok-') ? 200 : 401;
        out = users;
      } else if (path == '/Users/Public') {
        out = [];
      } else {
        out = [];
      }
      rq.response.statusCode = status;
      rq.response.headers.contentType = ContentType.json;
      rq.response.write(out == null ? '' : jsonEncode(out));
      await rq.response.close();
    });
    await host.install(AddonHost.readPackage(pack('$addonsDir/jellyfin'))!);
    expect(host.installed['jellyfin']!.manifest.version, '1.6');
    final url = 'http://127.0.0.1:${srv.port}';
    final asked = <String>[];
    ui.answer = (op, args) {
      if (op != 'ask') return null;
      final t = args[0] as Map;
      asked.add('${t['title']}');
      if ('${t['title']}'.startsWith('Server Address')) return [url];
      if (t['title'] == 'Jellyfin user name') return ['Anna'];
      if ('${t['title']}'.startsWith('Password for')) return ['secret Anna!'];
      return [null];
    };
    final connect = await host.call('jellyfin', 'setup', const [], const Duration(seconds: 20)) as Map;
    expect(connect['id'], 'connect');
    final rows = (connect['rows'] as List).map((r) => (r as Map)['id']).toList();
    expect(rows, containsAll(['type', 'skip']));
    final signin = await host.call('jellyfin', 'setup.choose', ['connect', 'type'], const Duration(seconds: 20)) as Map;
    expect(signin['id'], 'signin');
    expect(signin['title'], 'Sign In to Home Server');
    final done = await host.call('jellyfin', 'setup.choose', ['signin', 'pw'], const Duration(seconds: 20));
    ui.answer = null;
    expect(done, 'done', reason: 'asked $asked; log ${host.logOf('jellyfin')}');
    final list = await host.call('jellyfin', 'users') as List;
    expect([for (final u in list) (u as Map)['name']], ['Anna', 'Mikkel']);
    expect((list.first as Map)['detail'], startsWith('Home Server · 127.0.0.1'));
    // Korie profiles made from the users; Mikkel signs in with his password (any characters).
    final mikkel = {'id': 'p2', 'name': 'Mikkel'};
    expect(await host.call('jellyfin', 'signedin', [mikkel, list[1]]), false);
    expect(await host.call('jellyfin', 'signin', [mikkel, list[1], 'wrong']), 'Wrong password.');
    expect(await host.call('jellyfin', 'signin', [mikkel, list[1], 'secret Mikkel!']), true);
    expect(await host.call('jellyfin', 'signedin', [mikkel, list[1]]), true);
    // Anna signed in during setup under a profile that the new profiles replaced: her new
    // profile counts as signed in.
    ui.answer = (op, args) => op == 'profiles.list' ? <Object?>[[{'id': 'p8', 'name': 'Mikkel'}]] : null;
    expect(await host.call('jellyfin', 'signedin', [{'id': 'p9', 'name': 'Anna'}, list[0]]), true);
    ui.answer = null;
    // set up now: no setup page any more
    expect(await host.call('jellyfin', 'setup'), isNull);
    await srv.close(force: true);
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
