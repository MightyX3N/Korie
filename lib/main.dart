import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'package:path_provider/path_provider.dart';

import 'addons/host.dart';
import 'addons/korie_ui.dart';
import 'android.dart';
import 'island.dart';
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
  // The Home button while Korie is already open: back to the first app in the dock.
  const MethodChannel('korie/home').setMethodCallHandler((call) async {
    if (call.method == 'home') Home.homeKey.currentState?.homePressed();
  });
  runApp(Korie(store: store));
  await startAddons(store);
}

/// The navigator of the whole app: add-ons ask their questions on top of whatever is open.
final korieNavigator = GlobalKey<NavigatorState>();

Future<void> startAddons(Store store) async {
  final host = AddonHost.instance;
  host.ui = KorieAddonUi(store, korieNavigator);
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
      'korie': '2.0',
    },
  );
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

class Korie extends StatelessWidget {
  const Korie({super.key, required this.store});
  final Store store;
  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: korieNavigator,
    title: 'Korie',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      brightness: Brightness.dark,
      fontFamily: 'Inter',
      colorScheme: const ColorScheme.dark(primary: Colors.white),
    ),
    home: !store.setupDone
        ? Setup(store: store)
        : store.profiles.length > 1 || store.current.pin != null
        ? Profiles(store: store, atStart: true)
        : Home(key: Home.homeKey, store: store),
  );
}
