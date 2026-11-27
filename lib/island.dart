import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import 'addons/host.dart';
import 'addons/manifest.dart';
import 'android.dart';

/// One thing the top-right island can show.
class IslandItem {
  IslandItem({
    required this.key,
    required this.title,
    this.sub = '',
    this.art,
    this.image,
    this.icon,
    this.playing,
    this.onOk,
    this.onHold,
    this.onToggle,
    this.rank = 0,
  });

  final String key, title, sub;
  final Uint8List? art;
  final String? image; // a web address or a file
  final IconData? icon;

  /// true: playing (bars, OK on them pauses); false: paused; null: not media.
  final bool? playing;
  final Future<void> Function()? onOk, onHold, onToggle;

  /// Higher shows first: Korie's own player 30, other apps playing 20, add-ons 10, updates 5.
  final int rank;
}

/// The top-right "island": what plays in other apps (notification access), what add-ons put
/// there (korie.on("island") / korie.update("island")), Korie's own player, and updates.
class Island extends ChangeNotifier {
  Island._();
  static final instance = Island._();

  final _sources = <String, List<IslandItem>>{};
  Timer? _poll;
  StreamSubscription? _addonUpdates;
  bool _started = false;

  /// Everything there is to show, the most important first.
  List<IslandItem> get items {
    final all = [for (final l in _sources.values) ...l];
    all.sort((a, b) {
      final r = b.rank.compareTo(a.rank);
      if (r != 0) return r;
      return (b.playing == true ? 1 : 0).compareTo(a.playing == true ? 1 : 0);
    });
    return all;
  }

  /// When each app's media was last seen playing: paused media leaves the island after a while.
  final Map<String, DateTime> _lastPlaying = {};
  static const pausedFor = Duration(minutes: 10);

  /// What to show now, or null for just the time, settings and profile.
  IslandItem? get top {
    IslandItem? best;
    for (final l in _sources.values) {
      for (final i in l) {
        if (best == null || i.rank > best.rank || (i.rank == best.rank && i.playing == true && best.playing != true)) best = i;
      }
    }
    return best;
  }

  /// Korie's own parts (the player) set their item here.
  void set(String source, List<IslandItem> items) {
    _sources[source] = items;
    notifyListeners();
  }

  void start() {
    if (_started) return;
    _started = true;
    Android.listen('mediaChanged', refreshMedia);
    _addonUpdates = AddonHost.instance.updates.stream.listen((u) {
      if (u.what == 'island') refreshAddons();
    });
    AddonHost.instance.addListener(_addonsChanged);
    refreshAll();
    // Media sessions announce themselves; this catches access given later and missed changes.
    _poll = Timer.periodic(const Duration(seconds: 20), (_) => refreshAll());
    Timer.periodic(const Duration(hours: 3), (_) => checkUpdates());
    Timer(const Duration(seconds: 20), checkUpdates);
  }

  var _lastHandles = '';
  void _addonsChanged() {
    final h = AddonHost.instance.handlersOf('island').map((a) => a.id).join(',');
    if (h != _lastHandles) {
      _lastHandles = h;
      refreshAddons();
    }
  }

  Future<void> refreshAll() async {
    await Future.wait([refreshMedia(), refreshAddons()]);
  }

  Future<void> refreshMedia() async {
    final list = await Android.media();
    final now = DateTime.now();
    for (final m in list ?? const <Map<String, Object?>>[]) {
      // Media seen for the first time counts as just played, so a paused song stays a while.
      if (m['playing'] == true || !_lastPlaying.containsKey('${m['pkg']}')) _lastPlaying['${m['pkg']}'] = now;
    }
    _sources['media'] = [
      for (final m in list ?? const <Map<String, Object?>>[])
        // Paused for a long time: the app has most likely been left; don't keep showing it.
        if (m['playing'] == true || now.difference(_lastPlaying['${m['pkg']}']!) < pausedFor)
        IslandItem(
          key: 'media:${m['pkg']}',
          title: '${m['title']}',
          sub: '${m['sub'] ?? ''}',
          art: m['art'] as Uint8List?,
          playing: m['playing'] == true,
          rank: m['playing'] == true ? 20 : 8,
          onOk: () => Android.mediaAction('${m['pkg']}', 'open'),
          onToggle: () async {
            await Android.mediaAction('${m['pkg']}', 'toggle');
            await Future<void>.delayed(const Duration(milliseconds: 400));
            await refreshMedia();
          },
          onHold: () => Android.mediaAction('${m['pkg']}', 'stop'),
        ),
    ];
    notifyListeners();
  }

  /// Add-ons answer "island" with {title, sub, image, playing} or nothing. OK on it calls
  /// "island.ok", holding OK "island.hold", the play/pause "island.toggle".
  Future<void> refreshAddons() async {
    final host = AddonHost.instance;
    final answers = await host.callAll('island');
    _sources['addons'] = [
      for (final e in answers.entries)
        if (e.value is Map && (e.value as Map)['title'] != null)
          () {
            final m = (e.value as Map).cast<String, Object?>();
            final handles = host.handles(e.key);
            return IslandItem(
              key: 'addon:${e.key}',
              title: '${m['title']}',
              sub: '${m['sub'] ?? host.installed[e.key]?.manifest.name ?? ''}',
              image: m['image'] as String?,
              playing: m['playing'] is bool ? m['playing'] as bool : null,
              rank: m['playing'] == true ? 25 : 10,
              onOk: handles.contains('island.ok') ? () async => host.call(e.key, 'island.ok') : null,
              onHold: handles.contains('island.hold') ? () async => host.call(e.key, 'island.hold') : null,
              onToggle: handles.contains('island.toggle') ? () async => host.call(e.key, 'island.toggle') : null,
            );
          }(),
    ];
    notifyListeners();
  }

  /// KORIE_UPDATE_URL is only for testing against a local server.
  static const updateUrl = String.fromEnvironment('KORIE_UPDATE_URL', defaultValue: 'https://raw.githubusercontent.com/MightyX3N/Korie/main/update.json');

  /// What can be updated, as the last check found it: a newer Korie and installed add-ons.
  ({String version, String apk})? newApp;
  List<IndexEntry> newAddons = const [];
  bool get hasUpdate => newApp != null || newAddons.isNotEmpty;

  /// While updating: what is happening ("Downloading Korie 2.3 · 34%"), else null.
  String? updating;

  /// When the last check was made, and whether it could reach the update list.
  DateTime? checkedAt;
  bool checkFailed = false;

  /// A newer Korie (update.json in the repository) and newer versions of installed add-ons.
  Future<void> checkUpdates() async {
    if (updating != null) return;
    final host = AddonHost.instance;
    ({String version, String apk})? app;
    var failed = false;
    try {
      final j = jsonDecode(utf8.decode(await host.download(updateUrl))) as Map;
      final code = (j['code'] as num?)?.toInt() ?? 0;
      if (code > await Android.versionCode() && j['apk'] is String) app = (version: '${j['version']}', apk: j['apk'] as String);
    } catch (_) {
      failed = true;
    }
    List<IndexEntry> index;
    try {
      index = await host.fetchIndex();
    } catch (_) {
      index = const [];
      failed = true;
    }
    newApp = app;
    newAddons = [
      for (final e in index)
        if (host.installed[e.id] case final a? when compareVersions(e.version, a.manifest.version) > 0) e,
    ];
    checkedAt = DateTime.now();
    checkFailed = failed;
    debugPrint('korie: update check: app ${app?.version ?? 'none'}, add-ons ${newAddons.length}${failed ? ' (not all reached)' : ''}');
    _showUpdate();
  }

  void _showUpdate() {
    final app = newApp;
    _sources['updates'] = [
      if (hasUpdate || updating != null)
        IslandItem(
          key: 'updates',
          title: updating == null ? 'Update ready' : 'Updating',
          sub: updating ?? [if (app != null) 'Korie ${app.version}', for (final e in newAddons) '${e.name} add-on ${e.version}'].join(' · '),
          icon: Icons.arrow_upward_rounded,
          rank: 5,
          onOk: installUpdates,
        ),
    ];
    notifyListeners();
  }

  void _status(String? s) {
    updating = s;
    _showUpdate();
  }

  /// Installs what [checkUpdates] found: the add-ons first, then Korie itself (which closes Korie).
  /// The island shows how far it is, so a slow download does not look like nothing happening.
  Future<void> installUpdates() async {
    if (updating != null) return;
    final host = AddonHost.instance;
    try {
      for (final e in newAddons) {
        final a = host.installed[e.id];
        _status('${e.name} add-on ${e.version}');
        try {
          final p = AddonHost.readPackage(await host.download(e.url));
          // New permissions need the install question; the same ones update quietly.
          if (p != null && a != null && p.manifest.uses.toSet().difference(a.manifest.uses.toSet()).isEmpty) {
            await host.install(p);
          } else if (p != null) {
            _askUpdate?.call(p);
          }
        } catch (_) {}
      }
      final app = newApp;
      if (app != null) {
        Future<String> install() async {
          _status('Downloading Korie ${app.version}');
          final ticker = Timer.periodic(const Duration(milliseconds: 700), (_) async {
            final p = await Android.installProgress();
            if (updating != null && updating!.startsWith('Downloading')) {
              _status(p >= 100 ? 'Installing Korie ${app.version}' : (p >= 0 ? 'Downloading Korie ${app.version} · $p%' : 'Downloading Korie ${app.version}'));
            }
          });
          try {
            return await Android.installApk(app.apk);
          } finally {
            ticker.cancel();
          }
        }

        var r = await install();
        if (r == 'allow') {
          // Android's screen to allow it is open; carry on when the viewer comes back.
          _status('Allow Korie to install apps');
          await Android.untilBack();
          r = await install();
        }
        if (r != 'ok') _say?.call(r == 'allow' ? 'Allow Korie to install apps, then choose Update ready again' : 'The update could not be installed: $r');
      }
    } finally {
      updating = null;
    }
    await checkUpdates();
  }

  void Function(String)? _say;
  set say(void Function(String) f) => _say = f;

  /// Set by the app: shows the install question for an update that asks for more.
  void Function(AddonPackage)? _askUpdate;
  set askUpdate(void Function(AddonPackage) f) => _askUpdate = f;

  @override
  void dispose() {
    _poll?.cancel();
    _addonUpdates?.cancel();
    super.dispose();
  }
}
