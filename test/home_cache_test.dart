// Home's apps and carousel are kept on the device, so Home has them on screen at once.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:korie/android.dart';
import 'package:korie/home_cache.dart';

void main() {
  test('apps and carousel items come back after a restart, pictures included', () async {
    final dir = Directory.systemTemp.createTempSync('korie-home');
    final a = HomeCache.forTest();
    await a.open(dir);
    expect(a.apps, isEmpty);
    final banner = Uint8List.fromList(List.generate(5000, (i) => i % 251));
    final art = Uint8List.fromList(List.generate(9000, (i) => i % 13));
    a.apps = [App(id: 'com.netflix.ninja', label: 'Netflix', banner: banner, color: 0xFF000000), App(id: 'org.jellyfin', label: 'Jellyfin', system: true)];
    a.setExtra([App(id: 'korie.tv', label: 'Korie TV', system: true)]);
    a.deviceGranted = true;
    a.device = [ShelfItem({'kind': 'continue', 'key': 'wn|x|1', 'pkg': 'com.netflix.ninja', 'app': 'Netflix', 'title': 'Dark', 'left': 12, 'progress': 0.4, 'art': art})];
    a.addons['p1'] = [ShelfItem({'kind': 'addon', 'key': 'addon:jellyfin:s-bb', 'app': 'Jellyfin', 'title': 'Breaking Bad', 'art': art, 'addon': 'jellyfin', 'data': {'id': 's-bb', 'type': 'series'}})];
    a.flush();

    final b = HomeCache.forTest();
    await b.open(dir);
    expect(b.apps.map((x) => x.label), ['Netflix', 'Jellyfin']);
    expect(b.apps.first.banner, banner);
    expect(b.apps.last.system, true);
    expect(b.extra.single.id, 'korie.tv');
    expect(b.deviceGranted, true);
    expect(b.device.single.title, 'Dark');
    expect(b.device.single.isContinue, true);
    expect(b.device.single.left, 12);
    expect(b.device.single.art, art);
    final bb = b.addons['p1']!.single;
    expect([bb.title, bb.addon, bb.data?['id']], ['Breaking Bad', 'jellyfin', 's-bb']);
    // The same picture twice is one file; old pictures are removed.
    expect(dir.listSync(recursive: true).where((f) => f.path.endsWith('.bin')).length, 2);
    b.apps = [];
    b.device = [];
    b.addons.clear();
    b.flush();
    expect(dir.listSync(recursive: true).where((f) => f.path.endsWith('.bin')), isEmpty);
  });

  test('a damaged cache is the same as none', () async {
    final dir = Directory.systemTemp.createTempSync('korie-home');
    Directory('${dir.path}/home-cache').createSync();
    File('${dir.path}/home-cache/home.json').writeAsStringSync('{"apps": [{"id": 3');
    final c = HomeCache.forTest();
    await c.open(dir);
    expect(c.apps, isEmpty);
    expect(c.device, isEmpty);
  });
}
