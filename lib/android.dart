import 'dart:io' show Platform;
import 'dart:typed_data';

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

class App {
  App({required this.id, required this.label, this.banner, this.icon, this.color = 0xFF2C2C30, this.system = false});
  final String id;
  final String label;
  final Uint8List? banner;
  final Uint8List? icon;
  final int color;
  final bool system;
}

/// One carousel item: Continue Watching from an app's Watch Next list, or an item from an app's own row.
class ShelfItem {
  ShelfItem(Map m)
    : kind = m['kind'] as String? ?? 'app',
      key = m['key'] as String? ?? '',
      pkg = m['pkg'] as String? ?? '',
      app = m['app'] as String? ?? '',
      appIcon = m['appIcon'] as Uint8List?,
      title = m['title'] as String? ?? '',
      episode = m['episode'] as String? ?? '',
      overview = m['overview'] as String? ?? '',
      tag = m['tag'] as String? ?? '',
      left = (m['left'] as num?)?.toInt() ?? -1,
      progress = (m['progress'] as num?)?.toDouble() ?? -1,
      link = m['link'] as String? ?? '',
      art = m['art'] as Uint8List?,
      addon = m['addon'] as String?,
      data = m['data'] as Map<String, Object?>?;
  final String kind, key, pkg, app, title, episode, overview, tag, link;
  final Uint8List? appIcon, art;

  /// For an add-on's item: the add-on, and the item table as the add-on gave it.
  final String? addon;
  final Map<String, Object?>? data;
  final int left;
  final double progress;

  bool get isContinue => kind == 'continue';

  /// "Jellyfin · S1 E2 Cat's in the Bag... · 14 min left"
  String get meta {
    final parts = <String>[app];
    if (tag.isNotEmpty) parts.add(tag);
    if (episode.isNotEmpty) parts.add(episode);
    if (left > 0) parts.add(left >= 60 ? '${left ~/ 60} h ${left % 60} min left' : '$left min left');
    return parts.join('  ·  ');
  }

  String get button => (isContinue || addon != null) && progress > 0 ? 'Resume' : (addon != null ? 'Play' : 'Open');
}

/// Talks to Android (Korie's MainActivity). On other systems the calls return nothing for now.
class Android {
  static const _ch = MethodChannel('korie/android');
  static bool get on => Platform.isAndroid;

  static final _listeners = <String, void Function()>{};

  /// Android tells Flutter things: 'appsChanged', 'fileOpened'.
  static void listen(String event, void Function() f) {
    if (!on) return;
    _listeners[event] = f;
    _ch.setMethodCallHandler((call) async => _listeners[call.method]?.call());
  }

  static void onAppsChanged(void Function() f) => listen('appsChanged', f);

  static Future<List<App>> apps() async {
    if (!on) return [];
    final list = await _ch.invokeListMethod<Map>('apps') ?? [];
    return [
      for (final m in list)
        App(
          id: m['id'] as String,
          label: m['label'] as String,
          banner: m['banner'] as Uint8List?,
          icon: m['icon'] as Uint8List?,
          color: (m['color'] as num?)?.toInt() ?? 0xFF2C2C30,
          system: m['system'] as bool? ?? false,
        ),
    ];
  }

  static Future<void> launch(String id) async => on ? await _ch.invokeMethod('launch', id) : null;
  static Future<void> appInfo(String id) async => on ? await _ch.invokeMethod('appInfo', id) : null;
  static Future<void> uninstall(String id) async => on ? await _ch.invokeMethod('uninstall', id) : null;
  static Future<void> tvSettings() async => on ? await _ch.invokeMethod('tvSettings') : null;
  static Future<bool> listingsSupported() async => on && (await _ch.invokeMethod<bool>('tvListingsSupported') ?? false);
  static Future<bool> listingsGranted() async => on && (await _ch.invokeMethod<bool>('tvListingsGranted') ?? false);
  static Future<bool> askListings() async => on && (await _ch.invokeMethod<bool>('askTvListings') ?? false);

  static Future<({bool granted, List<ShelfItem> items})> shelf() async {
    if (!on) return (granted: false, items: <ShelfItem>[]);
    final m = await _ch.invokeMapMethod<String, dynamic>('shelf');
    if (m == null) return (granted: false, items: <ShelfItem>[]);
    return (granted: m['granted'] == true, items: [for (final i in (m['items'] as List? ?? [])) ShelfItem(i as Map)]);
  }

  static Future<bool> openUrl(String url) async => on && (await _ch.invokeMethod<bool>('openUrl', url) ?? false);
  static Future<bool> canReadDownloads() async => on && (await _ch.invokeMethod<bool>('canReadDownloads') ?? false);
  static Future<void> askReadDownloads() async => on ? await _ch.invokeMethod('askReadDownloads') : null;
  static Future<List<({String name, String path})>> downloads() async {
    if (!on) return const [];
    final l = await _ch.invokeMethod<List>('downloads') ?? const [];
    return [for (final m in l.cast<Map>()) (name: '${m['name']}', path: '${m['path']}')];
  }

  static Future<Uint8List?> readFile(String uri) async => on ? await _ch.invokeMethod<Uint8List>('readFile', uri) : null;
  static Future<String?> pendingFile() async => on ? await _ch.invokeMethod<String>('pendingFile') : null;

  static Future<bool> notifAccess() async => on && (await _ch.invokeMethod<bool>('notifAccess') ?? false);
  static Future<bool> askNotifAccess() async => on && (await _ch.invokeMethod<bool>('askNotifAccess') ?? false);
  /// Whether Korie holds Android's home app role (null: this TV has no such role).
  static Future<bool?> homeRole() async => on ? await _ch.invokeMethod<bool>('homeRole') : null;

  /// The last Korie update Android would not install ({status, message}), once.
  static Future<Map?> installFailure() async => on ? await _ch.invokeMethod<Map>('installFailure') : null;

  /// Opened by the Home button (as the TV's home screen), not as an app.
  static Future<bool> openedAsHome() async => on && (await _ch.invokeMethod<bool>('openedAsHome') ?? false);
  static Future<bool> isDefaultHome() async => on && (await _ch.invokeMethod<bool>('isDefaultHome') ?? false);
  static Future<bool> askDefaultHome() async => on && (await _ch.invokeMethod<bool>('askDefaultHome') ?? false);
  static Future<bool> locationGranted() async => on && (await _ch.invokeMethod<bool>('locationGranted') ?? false);
  static Future<bool> askLocation() async => on && (await _ch.invokeMethod<bool>('askLocation') ?? false);
  static Future<({double lat, double lon})?> deviceLocation() async {
    if (!on) return null;
    final m = await _ch.invokeMethod<Map>('deviceLocation');
    return m == null ? null : (lat: (m['lat'] as num).toDouble(), lon: (m['lon'] as num).toDouble());
  }

  /// What other apps play or have paused; null without notification access.
  static Future<List<Map<String, Object?>>?> media() async {
    if (!on) return null;
    final l = await _ch.invokeMethod<List>('media');
    return l?.map((m) => (m as Map).cast<String, Object?>()).toList();
  }

  /// toggle (play/pause), stop or open, for another app's media.
  static Future<void> mediaAction(String pkg, String action) async => on ? await _ch.invokeMethod('mediaAction', {'pkg': pkg, 'action': action}) : null;

  static Future<int> versionCode() async => on ? (await _ch.invokeMethod<int>('versionCode') ?? 0) : 0;

  /// A full-screen page gets every key and the controller itself (only the remote's Back stays Korie's).
  static Future<void> webDirect(bool on_) async => on ? await _ch.invokeMethod('webDirect', on_) : null;

  /// Whether the TV has slept or restarted since this was last asked (then Who's Watching shows).
  static Future<bool> wokeUp() async => on && (await _ch.invokeMethod<bool>('wokeUp') ?? false);

  static Future<String> versionName() async => on ? (await _ch.invokeMethod<String>('versionName') ?? '') : '';

  /// How far the update being installed has downloaded: 0 to 100, or -1 when not known.
  static Future<int> installProgress() async => on ? (await _ch.invokeMethod<int>('installProgress') ?? 0) : 0;

  /// Korie's own version ("2.2"), read once at start.
  static String version = '';

  /// Downloads and installs a new Korie: 'ok', 'allow' (allow installing first) or an error.
  static Future<String> installApk(String url) async => on ? (await _ch.invokeMethod<String>('installApk', url) ?? 'failed') : 'not Android';

  /// Waits until Korie is in front again, after sending the viewer to a system settings screen.
  static Future<void> untilBack({Duration max = const Duration(minutes: 10)}) {
    if (!on) return Future.value();
    final c = Completer<void>();
    var left = false;
    late final AppLifecycleListener l;
    l = AppLifecycleListener(
      onStateChange: (s) {
        if (s != AppLifecycleState.resumed) {
          left = true;
        } else if (left && !c.isCompleted) {
          c.complete();
        }
      },
    );
    return c.future.timeout(max, onTimeout: () {}).whenComplete(l.dispose);
  }

  static Future<void> openItem(ShelfItem it) async => on ? await _ch.invokeMethod('openItem', {'link': it.link, 'pkg': it.pkg}) : null;
}
