// Runs the real add-ons (radio, openfilms, jellyfin) on Korie's add-on host with real Lua and
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

  test('jellyfin 1.10: setup pages, users, passwords, playing, tracks (against a fake Jellyfin server)', () async {
    final srv = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    Map<String, Object?> film(String id, String name, String genres, int year, String added, {bool series = false}) => {
      'Id': id, 'Name': name, 'Type': series ? 'Series' : 'Movie', 'ProductionYear': year, 'Genres': genres.split(','),
      'DateCreated': added, 'RunTimeTicks': series ? null : 99000000000, 'OfficialRating': '15', 'CommunityRating': 8.1,
      'ImageTags': {'Primary': 'p'}, 'BackdropImageTags': ['b'], 'ProviderIds': {'Tmdb': id.hashCode.toString()},
    };
    final library = [
      film('m-dune', 'Dune: Part Two', 'Science Fiction,Adventure', 2024, '2026-11-20T10:00:00Z'),
      film('m-opp', 'Oppenheimer', 'Drama,History', 2023, '2026-11-19T10:00:00Z'),
      film('m-int', 'Interstellar', 'Science Fiction,Drama', 2014, '2026-11-01T10:00:00Z'),
      film('m-inc', 'Inception', 'Science Fiction,Action', 2010, '2026-10-01T10:00:00Z'),
      film('s-bb', 'Breaking Bad', 'Crime,Drama', 2008, '2026-09-01T10:00:00Z', series: true),
      film('s-st', 'Stranger Things', 'Science Fiction,Drama', 2016, '2026-11-21T10:00:00Z', series: true),
    ];
    final users = [
      {'Id': 'u-anna', 'Name': 'Anna'},
      {'Id': 'u-mikkel', 'Name': 'Mikkel'},
      {'Id': 'u-kid', 'Name': 'Kid'}, // no password
    ];
    final tries = <String>[];
    final playbackInfo = <Map>[];
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
        tries.add('${j['Username']}:${j['Pw']}');
        if (u != null && (u['Name'] == 'Kid' ? j['Pw'] == '' : j['Pw'] == 'secret ${u['Name']}!')) {
          out = {'AccessToken': 'tok-${u['Id']}', 'User': u};
        } else {
          status = 401;
        }
      } else if (path == '/Users') {
        status = (rq.headers.value('authorization') ?? '').contains('Token="tok-') ? 200 : 401;
        out = users;
      } else if (path == '/Users/Public') {
        out = [];
      } else if (path == '/Items') {
        out = {'Items': library, 'TotalRecordCount': library.length};
      } else if (path == '/UserItems/Resume') {
        out = {
          'Items': [
            {'Id': 'e-205', 'Name': 'Breakage', 'Type': 'Episode', 'SeriesId': 's-bb', 'SeriesName': 'Breaking Bad', 'SeasonId': 'season-2',
              'ParentIndexNumber': 2, 'IndexNumber': 5, 'ParentBackdropItemId': 's-bb', 'ParentBackdropImageTags': ['t'],
              'RunTimeTicks': 28000000000, 'UserData': {'PlaybackPositionTicks': 9000000000, 'PlayedPercentage': 32}},
          ],
        };
      } else if (path == '/Items/e-205') {
        out = {'Id': 'e-205', 'Name': 'Breakage', 'Type': 'Episode', 'SeriesId': 's-bb', 'SeriesName': 'Breaking Bad', 'ParentIndexNumber': 2, 'IndexNumber': 5,
          'UserData': {'PlaybackPositionTicks': 9000000000}};
      } else if (path == '/Items/e-205/PlaybackInfo') {
        // Like Jellyfin: the DTS track or picture subtitles need converting (HLS); the rest plays as it is.
        final j = jsonDecode(body) as Map;
        final convert = j['AudioStreamIndex'] == 2 || j['SubtitleStreamIndex'] == 4 || j['EnableDirectPlay'] == false;
        playbackInfo.add(j);
        out = {'PlaySessionId': 'ps-${playbackInfo.length}', 'MediaSources': [{'Id': 'ms-1', 'SupportsDirectPlay': !convert,
          if (convert) 'TranscodingUrl': '/videos/e-205/master.m3u8?AudioStreamIndex=${j['AudioStreamIndex']}&SubtitleStreamIndex=${j['SubtitleStreamIndex']}',
          'DefaultAudioStreamIndex': 1, 'MediaStreams': [
          {'Type': 'Video', 'Index': 0}, {'Type': 'Audio', 'Index': 1, 'Language': 'eng', 'Codec': 'aac', 'DisplayTitle': 'English - AAC - Stereo', 'IsDefault': true},
          {'Type': 'Audio', 'Index': 2, 'Language': 'eng', 'Codec': 'dts', 'DisplayTitle': 'Commentary - DTS - 5.1'},
          {'Type': 'Subtitle', 'Index': 3, 'Language': 'eng', 'DisplayTitle': 'English', 'IsTextSubtitleStream': true},
          {'Type': 'Subtitle', 'Index': 4, 'Language': 'dan', 'DisplayTitle': 'Danish (PGS)', 'IsTextSubtitleStream': false},
        ]}]};
      } else if (path == '/MediaSegments/e-205') {
        out = {'Items': [{'Type': 'Intro', 'StartTicks': 20000000, 'EndTicks': 70000000}]};
      } else if (path == '/Shows/s-bb/Seasons') {
        out = {'Items': [{'Id': 'season-1', 'Name': 'Season 1'}, {'Id': 'season-2', 'Name': 'Season 2'}]};
      } else if (path == '/Shows/s-bb/Episodes' && rq.uri.queryParameters['startItemId'] == 'e-205') {
        out = {'Items': [{'Id': 'e-205', 'Name': 'Breakage'}, {'Id': 'e-206', 'Name': 'Peekaboo', 'SeriesName': 'Breaking Bad', 'ParentIndexNumber': 2, 'IndexNumber': 6}]};
      } else if (path == '/Shows/s-bb/Episodes') {
        final n = (rq.uri.queryParameters['seasonId'] ?? 'season-1').split('-').last;
        out = {'Items': [for (var i = 1; i <= 7; i++) {'Id': 'e-${n}0$i', 'Name': 'Episode $i', 'IndexNumber': i, 'UserData': {'PlayedPercentage': n == '2' && i == 5 ? 32 : 0}}]};
      } else {
        out = [];
      }
      rq.response.statusCode = status;
      rq.response.headers.contentType = ContentType.json;
      rq.response.write(out == null ? '' : jsonEncode(out));
      await rq.response.close();
    });
    await host.install(AddonHost.readPackage(pack('$addonsDir/jellyfin'))!);
    expect(host.installed['jellyfin']!.manifest.version, '1.10');
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
    expect([for (final u in list) (u as Map)['name']], ['Anna', 'Mikkel', 'Kid']);
    expect((list.first as Map)['detail'], startsWith('Home Server · 127.0.0.1'));
    // Korie profiles made from the users; Mikkel signs in with his password (any characters).
    final mikkel = {'id': 'p2', 'name': 'Mikkel'};
    tries.clear();
    expect(await host.call('jellyfin', 'signedin', [mikkel, list[1]]), false);
    expect(await host.call('jellyfin', 'signedin', [mikkel, list[1]]), false);
    expect(tries, ['Mikkel:'], reason: 'an empty password is tried once, never again after it failed');
    // A user without a password is signed in with no password screen.
    expect(await host.call('jellyfin', 'signedin', [{'id': 'p3', 'name': 'Kid'}, list[2]]), true);
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

    // Korie TV, built from the catalog and Continue Watching.
    await host.refreshCatalog('jellyfin');
    final tv = TvLibrary(host);
    expect(tv.hasContent, true);
    final movies = await tv.page('movies');
    expect(movies.featured.first.title, 'Dune: Part Two', reason: 'the newest film with a backdrop comes first');
    expect(movies.rows.first.title, 'Recently Added');
    expect(movies.rows.first.items.map((i) => i.title).take(4), ['Dune: Part Two', 'Oppenheimer', 'Interstellar', 'Inception']);
    expect(movies.rows.map((r) => r.title), contains('Science Fiction'));
    final dune = movies.rows.first.items.first;
    expect(dune.meta, 'Movie · Science Fiction · Adventure · 2024 · 2h 45m');
    expect(dune.official, '15');
    final series = await tv.page('series');
    expect(series.rows.first.items.map((i) => i.title), ['Stranger Things', 'Breaking Bad']);
    final home = await tv.page('home');
    expect(home.rows.first.title, 'Continue Watching');
    final bb = home.rows.first.items.first;
    expect(bb.title, 'Breaking Bad');
    expect(bb.genres, ['Crime', 'Drama'], reason: 'filled in from the catalog entry with the same id');
    expect(bb.episode, startsWith('S2 E5'));
    expect(bb.progress, closeTo(0.32, 0.001));
    expect(home.rows.map((r) => r.title), containsAll(['Recently Added Movies', 'Recently Added Series']));
    final like = await tv.similar(dune);
    expect(like.map((i) => i.title), containsAll(['Interstellar', 'Inception']), reason: 'they share a genre');
    expect(like.map((i) => i.title), isNot(contains('Breaking Bad')));
    expect((await tv.search('opp')).map((i) => i.title), ['Oppenheimer']);
    // Playing Breaking Bad from Continue Watching resumes S2 E5 (the add-on's "focus").
    ui.played.clear();
    await host.call('jellyfin', 'detail', [bb.data]).then((d) => expect((d as Map)['focus'], {'season': 'season-2', 'episode': 'e-205'}));
    // Resuming the episode reaches Korie's player: where it was left, text subtitles (not the
    // picture ones), the intro to skip and the next episode.
    await host.call('jellyfin', 'action', [{'id': 'e-205', 'kind': 'Episode'}, 'resume'], const Duration(seconds: 20));
    expect(ui.played, hasLength(1), reason: host.logOf('jellyfin').join('\n'));
    final r = ui.played.single;
    expect(r['url'], contains('/Videos/e-205/stream'));
    expect(r['start'], 900);
    expect(r['title'], 'Breaking Bad');
    final subs = (r['subtitles'] as List).cast<Map>();
    expect(subs, hasLength(2), reason: 'text and picture subtitles');
    expect(subs[0]['url'], contains('/Videos/e-205/ms-1/Subtitles/3/0/Stream.vtt'));
    expect(subs[0]['label'], 'English');
    expect(subs[1]['url'], isNull, reason: 'picture subtitles are drawn in by the server');
    expect(subs[1]['id'], 4);
    // Every sound track; the DTS one the player can't play itself (no "player" place).
    final audios = (r['audios'] as List).cast<Map>();
    expect(audios.map((a) => a['id']), [1, 2]);
    expect(audios[0], containsPair('selected', true));
    expect(audios[0]['player'], 0);
    expect(audios[1]['player'], isNull);

    // Choosing the DTS track: the same episode from the same spot, converted with that track.
    ui.played.clear();
    final ok = await host.call('jellyfin', 'switch', [r['ref'], {'audio': 2, 'subtitle': null, 'position': 1234.5}], const Duration(seconds: 20));
    expect(ok, isTrue, reason: host.logOf('jellyfin').join('\n'));
    expect(playbackInfo.last['AudioStreamIndex'], 2);
    final r2 = ui.played.single;
    expect(r2['url'], contains('/videos/e-205/master.m3u8?AudioStreamIndex=2'));
    expect(r2['mime'], 'application/x-mpegURL');
    expect(r2['start'], 1234.5);
    expect(((r2['audios'] as List).cast<Map>()).firstWhere((a) => a['selected'] == true)['id'], 2);
    // Picture subtitles: drawn in, and marked as chosen.
    ui.played.clear();
    await host.call('jellyfin', 'switch', [r2['ref'], {'audio': 2, 'subtitle': 4, 'position': 1300}], const Duration(seconds: 20));
    expect(playbackInfo.last['SubtitleStreamIndex'], 4);
    expect(((ui.played.single['subtitles'] as List).cast<Map>())[1]['selected'], isTrue);
    // The TV could not play the file as it is: asked for it converted, the server converts it (and
    // later track changes stay converted).
    ui.played.clear();
    await host.call('jellyfin', 'switch', [r['ref'], {'audio': 1, 'subtitle': null, 'position': 5, 'convert': true}], const Duration(seconds: 20));
    expect(playbackInfo.last['EnableDirectPlay'], isFalse);
    final r3 = ui.played.single;
    ui.played.clear();
    await host.call('jellyfin', 'switch', [r3['ref'], {'audio': 1, 'subtitle': null, 'position': 9}], const Duration(seconds: 20));
    expect(playbackInfo.last['EnableDirectPlay'], isFalse, reason: 'stays converted');
    expect((r['segments'] as List).single, {'type': 'intro', 'start': 2, 'end': 7});
    expect((r['next'] as Map)['title'], isNotEmpty);
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
