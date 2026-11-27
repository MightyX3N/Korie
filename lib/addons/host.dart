import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';

import 'lua_values.dart';
import 'manifest.dart';
import 'worker.dart';

/// What Korie does for add-ons: the parts that need the screen or the rest of the app.
/// The app sets [AddonHost.ui]; every answer is a list of return values for the add-on.
abstract class AddonUi {
  Future<List<Object?>> request(String addonId, String op, List<Object?> args);
}

/// An installed add-on.
class InstalledAddon {
  InstalledAddon(this.manifest, this.dir, {this.enabled = true});
  final AddonManifest manifest;
  final Directory dir;
  bool enabled;
  String get id => manifest.id;
}

/// A running add-on.
class _Running {
  _Running(this.addon);
  final InstalledAddon addon;
  Isolate? isolate;
  SendPort? port;
  final ready = Completer<bool>();
  List<String> handles = const [];
  final calls = <int, Completer<Object?>>{};
  DateTime? busySince;
  int asking = 0; // questions of this add-on open on screen
  String? error;
  final log = <String>[];
}

/// Runs the installed add-ons, each in its own isolate, and asks them things.
///
/// Every place in Korie that add-ons can add to is an event name: Korie asks every add-on that
/// handles it ([callAll]) and shows the answers. The old events (catalog, search, home, detail,
/// episodes, playback, button, profile, next, action, setting) keep working; new places only
/// need a new name, so add-ons can grow with Korie.
class AddonHost extends ChangeNotifier {
  AddonHost._();
  static final instance = AddonHost._();

  static const indexUrl = 'https://raw.githubusercontent.com/MightyX3N/Korie/main/addons/index.json';

  /// How long an answer may take, not counting time the viewer spends on the add-on's questions.
  static Duration limitFor(String event) => switch (event) {
        'catalog' => const Duration(seconds: 60),
        'setup' || 'setup.choose' || 'users' || 'signin' || 'signedin' || 'button' || 'action' => const Duration(seconds: 30),
        _ => const Duration(seconds: 8),
      };

  /// Lua that runs without stopping this long is stuck: its worker is restarted.
  static const runaway = Duration(seconds: 6);

  AddonUi? ui;
  String? caFile; // tests
  Map<String, Object?> device = const {};
  late Directory root, dataRoot;
  final installed = <String, InstalledAddon>{};
  final _running = <String, _Running>{};
  var _nextCall = 1;
  Timer? _watchdog, _catalogTimer;
  bool _started = false;

  /// Called by the worker's korie.update(what, value): something an add-on shows changed.
  final updates = StreamController<({String addon, String what, Object? value})>.broadcast();

  Future<void> init(Directory base, {Map<String, Object?> device = const {}}) async {
    this.device = device;
    root = Directory('${base.path}/addons')..createSync(recursive: true);
    dataRoot = Directory('${base.path}/addon-data')..createSync(recursive: true);
    final state = _readJson(File('${root.path}/state.json'));
    installed.clear();
    for (final d in root.listSync().whereType<Directory>()) {
      final m = AddonManifest.read(d);
      if (m == null || d.path.split(Platform.pathSeparator).last != m.id) continue;
      installed[m.id] = InstalledAddon(m, d, enabled: (state['disabled'] as List?)?.contains(m.id) != true);
    }
    _started = true;
    _watchdog ??= Timer.periodic(const Duration(seconds: 1), (_) => _checkRunaway());
    _catalogTimer ??= Timer.periodic(const Duration(hours: 6), (_) {
      for (final id in _running.keys) {
        refreshCatalog(id);
      }
    });
    await Future.wait([for (final a in installed.values) if (a.enabled) _start(a)]);
    notifyListeners();
  }

  // ------------------------------------------------------------------ asking add-ons

  List<String> handles(String id) => _running[id]?.handles ?? const [];

  /// The add-ons that answer [event], in a steady order.
  List<InstalledAddon> handlersOf(String event) => [
        for (final id in (_running.keys.toList()..sort()))
          if (_running[id]!.handles.contains(event)) _running[id]!.addon,
      ];

  /// Asks one add-on. Null when it does not answer in time, fails, or has no such handler.
  /// The time limit does not run while the add-on waits for the viewer (a question on screen).
  Future<Object?> call(String id, String event, [List<Object?> args = const [], Duration? limit]) async {
    final r = _running[id];
    if (r == null) return null;
    if (!await r.ready.future || !r.handles.contains(event)) return null;
    final callId = _nextCall++;
    final c = Completer<Object?>();
    r.calls[callId] = c;
    r.port!.send(['call', callId, 'event', event, args]);
    final max = limit ?? limitFor(event);
    var used = Duration.zero;
    const tick = Duration(milliseconds: 250);
    final timer = Timer.periodic(tick, (t) {
      if (c.isCompleted) return t.cancel();
      if (r.asking > 0) return; // the viewer is answering a question
      used += tick;
      if (used >= max) {
        t.cancel();
        r.calls.remove(callId);
        _log(r, '$event took too long');
        c.complete(null);
      }
    });
    try {
      return await c.future;
    } finally {
      timer.cancel();
    }
  }

  /// Asks every add-on that answers [event]; the answers by add-on id, without empty ones.
  Future<Map<String, Object?>> callAll(String event, [List<Object?> args = const []]) async {
    final ids = [for (final a in handlersOf(event)) a.id];
    final answers = await Future.wait([for (final id in ids) call(id, event, args)]);
    return {
      for (var i = 0; i < ids.length; i++)
        if (answers[i] != null) ids[i]: answers[i],
    };
  }

  /// Tells every add-on that handles [event]; does not wait for answers.
  void tell(String event, [List<Object?> args = const []]) {
    for (final a in handlersOf(event)) {
      call(a.id, event, args);
    }
  }

  List<String> logOf(String id) => List.unmodifiable(_running[id]?.log ?? const []);
  String? errorOf(String id) => _running[id]?.error;

  // ------------------------------------------------------------------ catalogs

  /// Each add-on's whole list (its "catalog" answer), kept on the device so Search works at once
  /// and without internet. Fetched when an add-on starts if older than 6 hours, and on refresh.
  final catalogs = <String, List<Map<String, Object?>>>{};

  File _catalogFile(String id) => File('${dataRoot.path}/$id/catalog.json');

  Future<void> refreshCatalog(String id) async {
    if (!handles(id).contains('catalog')) return;
    final v = await call(id, 'catalog');
    if (v is! List) return;
    final items = [for (final i in v) if (i is Map && i['title'] is String) i.cast<String, Object?>()];
    catalogs[id] = items;
    _writeJson(_catalogFile(id), {'at': DateTime.now().millisecondsSinceEpoch, 'items': items});
    notifyListeners();
  }

  void _loadCatalog(String id) {
    final j = _readJson(_catalogFile(id));
    final items = j['items'];
    if (items is List) catalogs[id] = [for (final i in items) if (i is Map) i.cast<String, Object?>()];
    final at = j['at'] is int ? j['at'] as int : 0;
    if (DateTime.now().millisecondsSinceEpoch - at > const Duration(hours: 6).inMilliseconds) {
      refreshCatalog(id);
    }
  }

  // ------------------------------------------------------------------ settings

  Map<String, Object?> settingsOf(String id) {
    final a = installed[id];
    final saved = _readJson(File('${dataRoot.path}/$id/settings.json'));
    return {
      for (final s in a?.manifest.settings ?? const <AddonSetting>[]) s.key: s.defaultValue,
      ...saved,
    };
  }

  /// A setting changed in Settings: saved, given to the add-on, and its "setting" event called.
  Future<void> setSetting(String id, String key, Object? value, {bool fromAddon = false}) async {
    final all = settingsOf(id)..[key] = value;
    _writeJson(File('${dataRoot.path}/$id/settings.json'), all);
    _running[id]?.port?.send(['settings', all]);
    notifyListeners();
    if (!fromAddon) await call(id, 'setting', [key, value]);
  }

  // ------------------------------------------------------------------ installing

  /// Reads a .korie file (a zip with addon.json and main.lua). Null when it is not an add-on.
  static AddonPackage? readPackage(Uint8List bytes) => AddonPackage.read(bytes);

  Future<InstalledAddon> install(AddonPackage p) async {
    final id = p.manifest.id;
    await _stop(id);
    final tmp = Directory('${root.path}/.$id.new');
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
    for (final f in p.files.entries) {
      final out = File('${tmp.path}/${f.key}');
      out.parent.createSync(recursive: true);
      out.writeAsBytesSync(f.value);
    }
    final dir = Directory('${root.path}/$id');
    if (dir.existsSync()) dir.deleteSync(recursive: true);
    tmp.renameSync(dir.path);
    final a = InstalledAddon(p.manifest, dir);
    installed[id] = a;
    _saveState();
    await _start(a);
    notifyListeners();
    return a;
  }

  Future<void> uninstall(String id, {bool keepData = false}) async {
    await _stop(id);
    final a = installed.remove(id);
    catalogs.remove(id);
    if (a != null && a.dir.existsSync()) a.dir.deleteSync(recursive: true);
    final data = Directory('${dataRoot.path}/$id');
    if (!keepData && data.existsSync()) data.deleteSync(recursive: true);
    _saveState();
    notifyListeners();
  }

  Future<void> setEnabled(String id, bool on) async {
    final a = installed[id];
    if (a == null) return;
    a.enabled = on;
    _saveState();
    if (on) {
      await _start(a);
    } else {
      await _stop(id);
    }
    notifyListeners();
  }

  /// The add-on list from the Korie repository.
  Future<List<IndexEntry>> fetchIndex({String url = indexUrl}) async {
    final text = utf8.decode(await download(url));
    final j = jsonDecode(text) as Map;
    final base = url.substring(0, url.lastIndexOf('/') + 1);
    return [
      for (final e in (j['addons'] as List? ?? const []))
        if (e is Map && e['id'] is String && e['file'] is String)
          IndexEntry(
            id: e['id'] as String,
            name: '${e['name'] ?? e['id']}',
            version: '${e['version'] ?? ''}',
            author: '${e['author'] ?? ''}',
            description: '${e['description'] ?? ''}',
            uses: [for (final u in (e['uses'] as List? ?? const [])) '$u'],
            url: Uri.parse(base).resolve(e['file'] as String).toString(),
          ),
    ];
  }

  Future<Uint8List> download(String url) async {
    final ctx = SecurityContext(withTrustedRoots: true);
    if (caFile != null) ctx.setTrustedCertificates(caFile!);
    final c = HttpClient(context: ctx)..findProxy = HttpClient.findProxyFromEnvironment;
    try {
      final rq = await c.getUrl(Uri.parse(url)).timeout(const Duration(seconds: 20));
      final rs = await rq.close().timeout(const Duration(seconds: 30));
      if (rs.statusCode != 200) throw HttpException('HTTP ${rs.statusCode}', uri: Uri.parse(url));
      final b = BytesBuilder(copy: false);
      await for (final chunk in rs.timeout(const Duration(seconds: 30))) {
        b.add(chunk);
      }
      return b.takeBytes();
    } finally {
      c.close();
    }
  }

  // ------------------------------------------------------------------ workers

  Future<void> _start(InstalledAddon a) async {
    if (!_started || _running.containsKey(a.id)) return;
    final r = _Running(a);
    _running[a.id] = r;
    final fromWorker = ReceivePort();
    fromWorker.listen((m) => _onMessage(r, m, fromWorker));
    final dataDir = Directory('${dataRoot.path}/${a.id}')..createSync(recursive: true);
    try {
      r.isolate = await Isolate.spawn(
        addonWorkerMain,
        WorkerStart(
          toHost: fromWorker.sendPort,
          dir: a.dir.path,
          dataDir: dataDir.path,
          addon: {
            'id': a.id,
            'name': a.manifest.name,
            'version': a.manifest.version,
            'dir': a.dir.path,
          },
          uses: a.manifest.uses,
          settings: settingsOf(a.id),
          device: device,
          caFile: caFile,
        ),
        debugName: 'addon ${a.id}',
        errorsAreFatal: false,
        onExit: fromWorker.sendPort,
      );
    } catch (e) {
      r.error = '$e';
      if (!r.ready.isCompleted) r.ready.complete(false);
      fromWorker.close();
    }
    await r.ready.future;
  }

  Future<void> _stop(String id) async {
    final r = _running.remove(id);
    if (r == null) return;
    r.port?.send(['stop']);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    r.isolate?.kill(priority: Isolate.immediate);
    if (!r.ready.isCompleted) r.ready.complete(false);
    for (final c in r.calls.values) {
      if (!c.isCompleted) c.complete(null);
    }
  }

  Future<void> restart(String id) async {
    final a = installed[id];
    final log = _running[id]?.log ?? const <String>[];
    await _stop(id);
    if (a != null && a.enabled) {
      final started = _start(a);
      _running[id]?.log.addAll(log);
      await started;
    }
    notifyListeners();
  }

  void _onMessage(_Running r, Object? m, ReceivePort rp) {
    if (m == null) {
      // the isolate ended
      rp.close();
      if (!r.ready.isCompleted) r.ready.complete(false);
      for (final c in r.calls.values) {
        if (!c.isCompleted) c.complete(null);
      }
      return;
    }
    if (m is! List || m.isEmpty) return;
    switch (m[0]) {
      case 'port':
        r.port = m[1] as SendPort;
      case 'ready':
        r.handles = (m[1] as List).cast<String>();
        if (!r.ready.isCompleted) r.ready.complete(true);
        notifyListeners();
        _loadCatalog(r.addon.id);
      case 'failed':
        r.error = '${m[1]}';
        _log(r, 'could not start: ${m[1]}');
        if (!r.ready.isCompleted) r.ready.complete(false);
        notifyListeners();
      case 'handles':
        r.handles = (m[1] as List).cast<String>();
        notifyListeners();
      case 'result':
        final c = r.calls.remove(m[1] as int);
        if (m[3] != null && m[3] != 'no-handler') _log(r, '${m[3]}');
        c?.complete(m[2]);
      case 'busy':
        r.busySince = DateTime.now();
      case 'idle':
        r.busySince = null;
      case 'log':
        _log(r, '${m[1]}');
      case 'error':
        _log(r, 'crashed: ${m.length > 1 ? m[1] : ''}');
      case 'req':
        _hostOp(r, m[1] as int, m[2] as String, (m[3] as List).cast<Object?>());
    }
  }

  Future<void> _hostOp(_Running r, int reqId, String op, List<Object?> args) async {
    List<Object?> answer;
    try {
      switch (op) {
        case 'set_setting':
          await setSetting(r.addon.id, '${args[0]}', args.length > 1 ? args[1] : null, fromAddon: true);
          answer = const [true];
        case 'update':
          updates.add((addon: r.addon.id, what: '${args.isNotEmpty ? args[0] : ''}', value: args.length > 1 ? args[1] : null));
          answer = const [true];
        default:
          if (op == 'ask') r.asking++;
          try {
            answer = await (ui?.request(r.addon.id, op, args) ?? Future.value(const [null, 'not available']));
          } finally {
            if (op == 'ask') r.asking--;
          }
      }
    } catch (e) {
      answer = [null, '$e'];
    }
    r.port?.send(['answer', reqId, answer]);
  }

  void _checkRunaway() {
    final now = DateTime.now();
    for (final r in _running.values.toList()) {
      final b = r.busySince;
      if (b != null && now.difference(b) > runaway) {
        _log(r, 'stopped: its Lua ran for ${runaway.inSeconds} seconds without a break');
        restart(r.addon.id);
      }
    }
  }

  void _log(_Running r, String line) {
    r.log.add(line);
    if (r.log.length > 200) r.log.removeRange(0, r.log.length - 200);
    debugPrint('[addon ${r.addon.id}] $line');
  }

  void _saveState() => _writeJson(File('${root.path}/state.json'), {
        'disabled': [for (final a in installed.values) if (!a.enabled) a.id],
      });

  static Map<String, Object?> _readJson(File f) {
    try {
      if (f.existsSync()) return (jsonDecode(f.readAsStringSync()) as Map).cast<String, Object?>();
    } catch (_) {}
    return {};
  }

  static void _writeJson(File f, Object? v) {
    f.parent.createSync(recursive: true);
    final t = File('${f.path}.tmp')..writeAsStringSync(jsonEncode(jsonable(v)));
    t.renameSync(f.path);
  }

  Future<void> shutdown() async {
    _watchdog?.cancel();
    _watchdog = null;
    _catalogTimer?.cancel();
    _catalogTimer = null;
    for (final id in _running.keys.toList()) {
      await _stop(id);
    }
    _started = false;
  }
}

/// One entry of the add-on list.
class IndexEntry {
  IndexEntry({
    required this.id,
    required this.name,
    required this.version,
    required this.author,
    required this.description,
    required this.uses,
    required this.url,
  });
  final String id, name, version, author, description, url;
  final List<String> uses;
}

/// A .korie file, read but not installed yet: what the install question shows.
class AddonPackage {
  AddonPackage(this.manifest, this.files);
  final AddonManifest manifest;
  final Map<String, Uint8List> files;

  static AddonPackage? read(Uint8List bytes) {
    try {
      final files = unzip(bytes);
      // Files may sit in the zip's top level or in one folder named after the add-on.
      var prefix = '';
      if (!files.containsKey('addon.json')) {
        final inner = files.keys.where((k) => k.endsWith('/addon.json') && k.split('/').length == 2);
        if (inner.length != 1) return null;
        prefix = inner.first.substring(0, inner.first.length - 'addon.json'.length);
      }
      final m = AddonManifest.parse(utf8.decode(files['${prefix}addon.json']!));
      if (m == null || !files.containsKey('${prefix}main.lua')) return null;
      return AddonPackage(m, {
        for (final e in files.entries)
          if (e.key.startsWith(prefix) && e.key.length > prefix.length) e.key.substring(prefix.length): e.value,
      });
    } catch (_) {
      return null;
    }
  }
}

/// The files of a zip. Paths that would leave the add-on's folder are refused.
Map<String, Uint8List> unzip(Uint8List bytes) {
  final out = <String, Uint8List>{};
  for (final f in ZipDecoder().decodeBytes(bytes)) {
    if (!f.isFile) continue;
    final name = f.name.replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').contains('..') || name.contains(':')) {
      throw FormatException('unsafe path in the add-on: $name');
    }
    out[name] = f.readBytes() ?? Uint8List(0);
  }
  return out;
}
