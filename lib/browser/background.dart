import 'dart:async';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../island.dart';
import '../store.dart';
import '../ui/ask.dart';

/// A full-screen page left with the remote's Home button: it keeps running (a game stream goes
/// on) until it is opened again, closed from the island, or closed by the Background settings.
class BackgroundPage {
  BackgroundPage({required this.key, required this.url, required this.title, required this.page});
  final String key, url, title;

  /// What the page itself calls it (the game's name, say), shown under [title].
  final String page;
  DateTime left = DateTime.now();
}

/// Korie's own pages in the background. Each shows in the island: OK opens it again, holding OK
/// closes it. Only Korie's pages: other apps are Android's to close.
class BackgroundPages extends ChangeNotifier {
  BackgroundPages._();
  static final instance = BackgroundPages._();

  static const _native = MethodChannel('korie/web');

  Store? store;
  GlobalKey<NavigatorState>? navigator;

  /// Opens a page again full screen, as it was ([key] given) or new.
  void Function(BackgroundPage p)? reopen;

  final pages = <BackgroundPage>[];
  Timer? _timer;

  /// Set by the full-screen page on screen: the Home button keeps it running instead of closing it.
  VoidCallback? keepOnHome;

  /// The remote's Home button, before Korie goes back to Home.
  void homePressed() {
    keepOnHome?.call();
    keepOnHome = null;
  }

  void add(BackgroundPage p) {
    pages.add(p);
    _timer ??= Timer.periodic(const Duration(minutes: 1), (_) => _closeUnused());
    trim();
  }

  /// Only so many at once: the one in the background longest goes first.
  void trim() {
    final max = store?.backgroundMax ?? 2;
    while (pages.length > max) {
      final old = pages.first;
      close(old.key);
      _say('Closed ${old.title}: only $max ${max == 1 ? 'page runs' : 'pages run'} in the background');
    }
    _show();
  }

  /// Takes [key] out of the background (its page is being opened again).
  BackgroundPage? take(String key) {
    final i = pages.indexWhere((p) => p.key == key);
    if (i < 0) return null;
    final p = pages.removeAt(i);
    _show();
    return p;
  }

  Future<void> close(String key) async {
    pages.removeWhere((p) => p.key == key);
    _show();
    try {
      await _native.invokeMethod('close', key);
    } catch (_) {}
  }

  void _closeUnused() {
    final minutes = store?.backgroundClose ?? 15;
    if (minutes <= 0) return;
    final now = DateTime.now();
    for (final p in [...pages]) {
      if (now.difference(p.left).inMinutes >= minutes) {
        close(p.key);
        _say('Closed ${p.title}: not used for $minutes min');
      }
    }
  }

  void _say(String text) {
    final o = navigator?.currentState?.overlay;
    if (o != null) showToast(o, text);
  }

  void _show() {
    Island.instance.set('background', [
      for (final p in pages.reversed)
        IslandItem(
          key: 'background:${p.key}',
          title: p.title,
          sub: p.page.isNotEmpty && p.page != p.title ? p.page : 'Running in the background',
          icon: Icons.open_in_full_rounded,
          rank: 22,
          onOk: () async {
            final again = take(p.key);
            if (again != null) reopen?.call(again);
          },
          onHold: () => close(p.key),
        ),
    ]);
    notifyListeners();
  }
}
