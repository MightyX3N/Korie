import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'addons/host.dart';
import 'android.dart';
import 'net.dart';

/// What Home shows (the apps, and the carousel's items), loaded as soon as Korie starts and kept
/// on the device: Home has it on screen at once, also while Who's Watching is still showing or
/// right after the TV starts, and freshens it in the background.
///
/// The apps and the apps' own carousel items are the same for everyone; add-ons' items are kept
/// per profile (each profile can be signed in as someone else).
class HomeCache {
  HomeCache._();
  static final instance = HomeCache._();

  /// A separate cache, for tests.
  HomeCache.forTest();

  Directory? _dir;
  List<App> apps = [];

  /// Korie's own cards among the apps: Korie TV and add-ons' tiles.
  List<App> extra = [];
  bool deviceGranted = false;

  /// Continue Watching and rows from apps (Android's Watch Next and preview channels).
  List<ShelfItem> device = [];

  /// Add-ons' carousel items by profile id.
  final Map<String, List<ShelfItem>> addons = {};

  final _changed = StreamController<String>.broadcast();

  /// "apps", "device" or "addons:<profile id>" when that part has been freshened.
  Stream<String> get changes => _changed.stream;

  Future<void> open(Directory base) async {
    final d = Directory('${base.path}/home-cache');
    _dir = d;
    try {
      d.createSync(recursive: true);
      final j = _read('home.json');
      List<App> read(Object? list) => [
        for (final a in (list as List? ?? const []))
          if (a is Map)
            App(
              id: '${a['id']}',
              label: '${a['label']}',
              banner: _bytes(a['banner']),
              icon: _bytes(a['icon']),
              color: (a['color'] as num?)?.toInt() ?? 0xFF2C2C30,
              system: a['system'] == true,
            ),
      ];
      apps = read(j['apps']);
      extra = read(j['extra']);
      deviceGranted = j['granted'] == true;
      device = [for (final m in (j['device'] as List? ?? const [])) if (m is Map) _item(m)];
      final byProfile = j['addons'] as Map? ?? const {};
      for (final e in byProfile.entries) {
        addons['${e.key}'] = [for (final m in (e.value as List? ?? const [])) if (m is Map) _item(m)];
      }
    } catch (_) {
      // A damaged cache is the same as none: everything is loaded fresh.
      apps = [];
      extra = [];
      device = [];
      addons.clear();
    }
  }

  /// Korie TV's card and add-ons' tiles changed.
  void setExtra(List<App> e) {
    extra = e;
    _save();
  }

  // ------------------------------------------------------------------ freshening

  Future<List<App>>? _apps;

  /// The installed apps, fresh from Android. Calls while one is under way share it.
  Future<List<App>> refreshApps() => _apps ??= _loadApps().whenComplete(() => _apps = null);

  Future<List<App>> _loadApps() async {
    var a = <App>[];
    // A busy TV can be slow to answer right after start: try again a few times before giving up.
    for (var attempt = 0; attempt < 6; attempt++) {
      try {
        a = await Android.apps();
      } catch (_) {
        a = [];
      }
      if (a.isNotEmpty || !Android.on) break;
      await Future<void>.delayed(const Duration(seconds: 2));
    }
    if (a.isEmpty) return apps; // keep what we had rather than an empty dock
    apps = a;
    _save();
    _changed.add('apps');
    return a;
  }

  Future<({bool granted, List<ShelfItem> items})>? _device;

  Future<({bool granted, List<ShelfItem> items})> refreshDevice() => _device ??= _loadDevice().whenComplete(() => _device = null);

  Future<({bool granted, List<ShelfItem> items})> _loadDevice() async {
    try {
      final r = await Android.shelf();
      deviceGranted = r.granted;
      device = r.items;
      _save();
      _changed.add('device');
      return r;
    } catch (_) {
      return (granted: deviceGranted, items: device);
    }
  }

  final Map<String, Future<List<ShelfItem>>> _addons = {};

  /// The add-ons' carousel items for this profile (they answer for the profile they follow).
  Future<List<ShelfItem>> refreshAddons(String profile) =>
      _addons[profile] ??= _loadAddons(profile).whenComplete(() => _addons.remove(profile));

  Future<List<ShelfItem>> _loadAddons(String profile) async {
    // While the add-ons are still starting they answer nothing: keep what was shown before.
    if (!AddonHost.instance.ready) return addons[profile] ?? const [];
    final items = await addonItems();
    addons[profile] = items;
    _save();
    _changed.add('addons:$profile');
    return items;
  }

  /// Add-ons answer "home" with up to 8 items each, each with a backdrop.
  static Future<List<ShelfItem>> addonItems() async {
    final host = AddonHost.instance;
    final out = <ShelfItem>[];
    for (final e in (await host.callAll('home')).entries) {
      if (e.value is! List) continue;
      final name = host.installed[e.key]?.manifest.name ?? e.key;
      for (final raw in (e.value as List).take(8)) {
        if (raw is! Map || raw['title'] == null) continue;
        final it = raw.cast<String, Object?>();
        final backdrop = '${it['backdrop'] ?? it['poster'] ?? ''}';
        final art = backdrop.startsWith('http') ? await fetchBytes(backdrop) : null;
        final remaining = (it['remaining'] as num?)?.toInt() ?? -1;
        out.add(ShelfItem({
          'kind': 'addon',
          'key': 'addon:${e.key}:${it['id'] ?? it['title']}',
          'app': name,
          'title': '${it['title']}',
          'episode': '${it['episode'] ?? it['subtitle'] ?? ''}',
          // An episode's overview is often just its name again; then the info line says it already.
          'overview': it['overview'] == null || it['overview'] == it['episode'] ? '' : '${it['overview']}',
          'tag': it['year'] == null ? '' : '${it['year']}',
          'left': remaining,
          'progress': (it['progress'] as num?)?.toDouble() ?? -1,
          'art': art,
          'addon': e.key,
          'data': it,
        }));
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ files

  Timer? _saveTimer;

  /// Written a moment later, once for several changes in a row.
  void _save() {
    if (_dir == null) return;
    _saveTimer?.cancel();
    _saveTimer = Timer(const Duration(seconds: 2), _write);
  }

  /// Writes now (for tests, and before Korie closes).
  void flush() {
    _saveTimer?.cancel();
    _write();
  }

  void _write() {
    final d = _dir;
    if (d == null) return;
    try {
      final used = <String>{};
      String? file(Uint8List? b) {
        if (b == null || b.isEmpty) return null;
        final name = '${_hash(b)}.bin';
        used.add(name);
        final f = File('${d.path}/$name');
        if (!f.existsSync()) f.writeAsBytesSync(b, flush: true);
        return name;
      }

      List<Map<String, Object?>> write(List<App> list) => [
        for (final a in list) {'id': a.id, 'label': a.label, 'banner': file(a.banner), 'icon': file(a.icon), 'color': a.color, 'system': a.system},
      ];
      final j = {
        'apps': write(apps),
        'extra': write(extra),
        'granted': deviceGranted,
        'device': [for (final i in device) _map(i, file)],
        'addons': {
          for (final e in addons.entries) e.key: [for (final i in e.value) _map(i, file)],
        },
      };
      final tmp = File('${d.path}/home.json.new');
      tmp.writeAsStringSync(jsonEncode(j), flush: true);
      tmp.renameSync('${d.path}/home.json');
      // Pictures nothing uses any more.
      for (final f in d.listSync().whereType<File>()) {
        final n = f.uri.pathSegments.last;
        if (n.endsWith('.bin') && !used.contains(n)) f.deleteSync();
      }
    } catch (_) {}
  }

  Map<String, Object?> _read(String name) {
    try {
      final v = jsonDecode(File('${_dir!.path}/$name').readAsStringSync());
      return v is Map<String, Object?> ? v : const {};
    } catch (_) {
      return const {};
    }
  }

  Uint8List? _bytes(Object? name) {
    if (name is! String) return null;
    final f = File('${_dir!.path}/$name');
    return f.existsSync() ? f.readAsBytesSync() : null;
  }

  Map<String, Object?> _map(ShelfItem i, String? Function(Uint8List?) file) => {
    'kind': i.kind,
    'key': i.key,
    'pkg': i.pkg,
    'app': i.app,
    'appIcon': file(i.appIcon),
    'title': i.title,
    'episode': i.episode,
    'overview': i.overview,
    'tag': i.tag,
    'left': i.left,
    'progress': i.progress,
    'link': i.link,
    'art': file(i.art),
    'addon': i.addon,
    'data': i.data,
  };

  ShelfItem _item(Map m) => ShelfItem({
    ...m,
    'appIcon': _bytes(m['appIcon']),
    'art': _bytes(m['art']),
    'data': m['data'] is Map ? (m['data'] as Map).cast<String, Object?>() : null,
  });

  /// FNV-1a, 64 bits: a file name for a picture's bytes.
  static String _hash(Uint8List b) {
    var h = 0xcbf29ce484222325;
    for (final x in b) {
      h ^= x;
      h = h * 0x100000001b3; // wraps around at 64 bits
    }
    return '${h.toUnsigned(64).toRadixString(16)}-${b.length}';
  }
}
