import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'package:path_provider/path_provider.dart';

import 'addons/host.dart';
import 'browser/background.dart';
import 'browser/browser.dart';
import 'addons/korie_ui.dart';
import 'android.dart';
import 'home_cache.dart';
import 'island.dart';
import 'player/player.dart';
import 'player/playlists.dart';
import 'screens/addons.dart';
import 'screens/home.dart';
import 'screens/profiles.dart';
import 'screens/setup.dart';
import 'store.dart';
import 'ui/ask.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks(['Inter'], await rootBundle.loadString('assets/fonts/Inter-OFL.txt'));
  });
  final store = await Store.open();
  debugPrint('korie: store');
  // Who's Watching only when the TV has slept or restarted, not when Android starts Korie again
  // after closing it in the background (pressing Home then showed it at random).
  var woke = false;
  try {
    woke = store.setupDone && await Android.wokeUp();
    Android.version = await Android.versionName();
  } catch (e) {
    debugPrint('korie: $e');
  }
  debugPrint('korie: woke $woke');
  // Home's apps and carousel: last time's at once, fresh ones loading from now on, so they are
  // there by the time a profile is picked.
  final support = await getApplicationSupportDirectory();
  final cache = HomeCache.instance;
  await cache.open(support);
  debugPrint('korie: cache ${cache.apps.length} apps');
  if (store.setupDone) {
    cache.refreshApps();
    cache.refreshDevice();
  }
  // The Home button while Korie is already open: back to the first app in the dock.
  const MethodChannel('korie/home').setMethodCallHandler((call) async {
    if (call.method == 'home') Home.homeKey.currentState?.homePressed();
  });
  // Full-screen pages left with Home run on in the background; the island opens them again.
  BackgroundPages.instance
    ..store = store
    ..navigator = korieNavigator
    ..reopen = (p) {
      final nav = korieNavigator.currentState;
      if (nav != null) FullPage.open(nav, url: p.url, title: p.title, resume: p.key);
    };
  // After sleeping or a restart: straight into the profile Who's Watching starts as (its PIN
  // is asked on Home), or Who's Watching itself.
  final start = store.startProfile;
  if (woke && start != null) {
    store.choose(start);
    Home.unlockAtStart = true;
  }
  runApp(Korie(store: store, pick: woke && store.pickOnWake));
  debugPrint('korie: running');
  await startAddons(store);
}

/// The navigator of the whole app: add-ons ask their questions on top of whatever is open.
final korieNavigator = GlobalKey<NavigatorState>();

Future<void> startAddons(Store store) async {
  final host = AddonHost.instance;
  // Korie's own player: korie.play from add-ons (video full screen, sound in the background).
  KoriePlayer.instance.navigator = korieNavigator;
  Playlists.instance.store = store;
  host.ui = KorieAddonUi(store, korieNavigator)
    ..play = KoriePlayer.instance.play
    ..stop = KoriePlayer.instance.stop;
  var lastProfile = store.current.id;
  store.addListener(() {
    if (store.current.id == lastProfile) return;
    lastProfile = store.current.id;
    host.tell('profile', [KorieAddonUi.profileValue(store.current)]);
  });
  await host.init(
    await getApplicationSupportDirectory(),
    device: {
      'tv': true,
      'touch': false,
      'android': Platform.isAndroid,
      'model': Platform.operatingSystem,
      'language': Platform.localeName.split(RegExp('[_.-]')).first,
      'korie': Android.version,
    },
  );
  // The add-ons' carousel items for the profile that was used last (most often the one picked).
  if (store.setupDone) HomeCache.instance.refreshAddons(store.current.id);
  // A .korie file opened from a file manager.
  Future<void> openedFile() async {
    final uri = await Android.pendingFile();
    final ctx = korieNavigator.currentState?.overlay?.context;
    if (uri == null || ctx == null || !ctx.mounted) return;
    await installBytes(ctx, await Android.readFile(uri));
  }

  Android.listen('fileOpened', openedFile);
  await openedFile();
  Island.instance
    ..say = (t) {
      final o = korieNavigator.currentState?.overlay;
      if (o != null) showToast(o, t);
    }
    ..askUpdate = (p) {
      final ctx = korieNavigator.currentState?.overlay?.context;
      if (ctx != null) confirmInstall(ctx, p);
    }
    ..start();
}

final _okKeys = {LogicalKeyboardKey.select, LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter, LogicalKeyboardKey.gameButtonA};

class Korie extends StatelessWidget {
  const Korie({super.key, required this.store, this.pick = false});
  final Store store;
  final bool pick;
  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: korieNavigator,
    title: 'Korie',
    debugShowCheckedModeBanner: false,
    // Holding OK on the remote sends the press again and again; Flutter's buttons would act on
    // every one of them. One press is one action: the repeats stop here (a hold that opens
    // options is seen by its own button first, so that still works).
    builder: (context, child) => Focus(
      canRequestFocus: false,
      skipTraversal: true,
      onKeyEvent: (node, e) => e is KeyRepeatEvent && _okKeys.contains(e.logicalKey) ? KeyEventResult.handled : KeyEventResult.ignored,
      child: child!,
    ),
    theme: ThemeData(
      brightness: Brightness.dark,
      fontFamily: 'Inter',
      colorScheme: const ColorScheme.dark(primary: Colors.white),
    ),
    home: !store.setupDone
        ? Setup(store: store)
        : pick
        ? Profiles(store: store, atStart: true)
        : Home(key: Home.homeKey, store: store),
  );
}
