import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../android.dart';
import '../places.dart';
import '../store.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import 'addons.dart';
import 'home.dart';
import 'profiles.dart';
import 'setup_page.dart';
import 'signin.dart';

/// What one page of setup shows.
class _Spec {
  _Spec(this.dot, this.title, this.rows, {this.message, this.background, this.focusId, this.titleWidget});
  final int dot;
  final String title;
  final String? message;
  final List<SetupRow> rows;
  final Gradient? background;
  final String? focusId;
  final Widget? titleWidget;
}

/// Korie's setup: Welcome, Add-ons (and the pages add-ons add, such as connecting to a Jellyfin
/// server), who uses Korie (add-on users, Korie profiles, or both linked by name), a look, the
/// home screen's permissions, the location, Korie as Home, done.
///
/// Every page is a [SetupPage]; add-ons describe theirs as plain tables and Korie draws them, so
/// they look and work like the rest (remote and touch).
class Setup extends StatefulWidget {
  const Setup({super.key, required this.store, this.again = false});
  final Store store;

  /// Opened from Settings: Back on the first page leaves, and Done goes back there.
  final bool again;
  @override
  State<Setup> createState() => _SetupState();
}

const _back = '\u0000back';
const _dots = 8;

class _SetupState extends State<Setup> {
  Store get store => widget.store;
  AddonHost get host => AddonHost.instance;

  _Spec? spec;
  bool busy = false;
  int pageKey = 0;
  Completer<String>? _answer;
  String? focused;

  @override
  void initState() {
    super.initState();
    run();
  }

  /// Shows a page and waits for a row (or Back).
  Future<String> show(_Spec s) {
    _answer = Completer<String>();
    setState(() {
      spec = s;
      busy = false;
      focused = null;
      pageKey++;
    });
    return _answer!.future;
  }

  /// Shows the page greyed out while [work] runs, so a slow add-on is visible.
  Future<T> working<T>(Future<T> work) async {
    setState(() => busy = true);
    try {
      return await work;
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  void _choose(String id) {
    final a = _answer;
    if (a != null && !a.isCompleted) a.complete(id);
  }

  Future<void> run() async {
    var step = 0;
    while (mounted) {
      final r = switch (step) {
        0 => await welcome(),
        1 => await addonsPage(),
        2 => await addonPages(),
        3 => await whoUses(),
        4 => await lookPage(),
        5 => await homeScreenPage(),
        6 => await locationPage(),
        7 => await setHomePage(),
        _ => await donePage(),
      };
      if (!mounted) return;
      focused = null; // each page starts on its first row
      if (r == _back) {
        if (step == 0) {
          if (widget.again) Navigator.of(context).pop();
          continue;
        }
        step--;
        // Add-on pages have no page of their own to go back to.
        if (step == 2) step = 1;
        continue;
      }
      if (step == 8) return finish();
      step++;
    }
  }

  void finish() {
    store.setSetupDone();
    if (widget.again) {
      Navigator.of(context).pop();
      return;
    }
    Navigator.of(context).pushReplacement(
      fadeRoute(store.profiles.length > 1 ? Profiles(store: store, atStart: true) : Home(key: Home.homeKey, store: store)),
    );
  }

  // ------------------------------------------------------------------ 1 welcome

  Future<String> welcome() => show(_Spec(0, '', const [SetupRow('go', 'Get Started')], message: 'Let’s set up Korie.', titleWidget: const _Welcome()));

  // ------------------------------------------------------------------ 2 add-ons

  List<IndexEntry>? index;
  String? indexError;

  Future<String> addonsPage() async {
    if (index == null) {
      try {
        index = await host.fetchIndex();
      } catch (_) {
        indexError = 'The add-on list could not be reached. You can add add-ons later in Settings.';
      }
    }
    while (true) {
      final rows = <SetupRow>[
        for (final e in index ?? const <IndexEntry>[])
          SetupRow(
            'addon:${e.id}',
            e.name,
            sub: _short(e.description),
            value: host.installed.containsKey(e.id) ? null : 'Install',
            check: host.installed.containsKey(e.id),
          ),
        // Installed from a file and not in the list.
        for (final a in host.installed.values)
          if (!(index ?? const []).any((e) => e.id == a.id)) SetupRow('installed:${a.id}', a.manifest.name, sub: _short(a.manifest.description), check: true),
        if (Android.on) const SetupRow('downloads', 'From the Download Folder', sub: 'Add-on files (.korie) you have downloaded'),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(1, 'Add-ons', rows, message: indexError ?? 'Install what you use. You can add or update add-ons later in Settings.', focusId: focused));
      if (r == _back || r == 'next') return r;
      focused = r;
      if (r == 'downloads') {
        await installFromDownloads(context);
      } else if (r.startsWith('addon:')) {
        final e = index!.firstWhere((e) => 'addon:${e.id}' == r);
        if (host.installed.containsKey(e.id)) {
          final i = await askChoice(context, title: e.name, message: 'Uninstall ${e.name}?', choices: const ['Keep', 'Uninstall']);
          if (i == 1) await host.uninstall(e.id);
        } else {
          await working(installFromList(context, e));
        }
      }
    }
  }

  static String _short(String s) {
    final dot = s.indexOf('. ');
    return dot > 0 && dot < 110 ? s.substring(0, dot) : (s.length > 110 ? '${s.substring(0, 107)}…' : s);
  }

  // ------------------------------------------------------------------ add-ons' own pages

  /// Each add-on that has setup steps shows them now: it answers "setup" with a page
  /// {id, title, message, rows = {{id, title, sub, value, check}}}, and "setup.choose" (page id,
  /// row id) with the next page, "done", or nothing to stay.
  Future<String> addonPages() async {
    for (final a in host.handlersOf('setup')) {
      var page = await working(host.call(a.id, 'setup'));
      while (page is Map && mounted) {
        final p = page;
        final rows = [for (final r in (p['rows'] is List ? p['rows'] as List : const [])) if (r is Map) SetupRow.fromAddon(r)];
        final chosen = await show(_Spec(2, '${p['title'] ?? a.manifest.name}', rows, message: p['message'] == null ? null : '${p['message']}'));
        if (chosen == _back) return _back;
        final next = await working(host.call(a.id, 'setup.choose', ['${p['id'] ?? ''}', chosen]));
        if (next is Map) {
          page = next;
        } else if (next == 'done' || next == true || next == 'skip') {
          page = null;
        }
        // nothing: the same page again (a question was cancelled, say)
      }
    }
    return 'next';
  }

  // ------------------------------------------------------------------ 3 profiles

  Future<String> whoUses() async {
    // Add-ons whose users can be profiles, and those users.
    final providers = <String, List<Map<String, Object?>>>{};
    for (final a in host.handlersOf('users')) {
      final users = await working(host.call(a.id, 'users'));
      if (users is List && users.isNotEmpty) {
        providers[a.id] = [for (final u in users) if (u is Map && u['name'] != null) u.cast<String, Object?>()];
      }
    }
    if (providers.isEmpty) return korieProfile();

    final chosen = {...providers.keys};
    var korie = false;
    while (true) {
      final rows = [
        for (final id in providers.keys)
          SetupRow(
            'p:$id',
            '${host.installed[id]!.manifest.name} Users',
            sub: '${providers[id]!.map((u) => u['name']).take(4).join(', ')}${providers[id]!.length > 4 ? '…' : ''} · their ${host.installed[id]!.manifest.name} passwords sign them in',
            check: chosen.contains(id),
          ),
        SetupRow('korie', 'Korie Profiles', sub: 'Names on this TV, each with an optional 4-digit PIN', check: korie),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(2, 'Who Uses Korie?', rows, message: 'Profiles keep their own apps, Home order and Continue Watching.', focusId: focused));
      if (r == _back) return _back;
      focused = r;
      if (r == 'korie') {
        korie = !korie;
      } else if (r.startsWith('p:')) {
        final id = r.substring(2);
        chosen.contains(id) ? chosen.remove(id) : chosen.add(id);
      } else if (r == 'next') {
        if (chosen.isEmpty) return korieProfile();
        final ok = await linkProfiles({for (final id in chosen) id: providers[id]!}, korie);
        if (ok == _back) continue;
        return 'next';
      }
    }
  }

  static const _sourceColors = [Color(0xFF6C7CFF), Color(0xFFE5A00D), Color(0xFF34C759), Color(0xFFFF6B6B)];

  /// Puts the people of every chosen source side by side; the same name is one person.
  /// With two or more sources the list is shown so it can be changed.
  Future<String> linkProfiles(Map<String, List<Map<String, Object?>>> providers, bool korie) async {
    focused = null;
    final korieNames = {if (korie) for (final p in store.profiles) p.name.toLowerCase()};
    final people = <({String name, Map<String, Map<String, Object?>> links})>[];
    ({String name, Map<String, Map<String, Object?>> links}) personFor(String name) {
      final found = people.where((p) => p.name.toLowerCase() == name.toLowerCase()).firstOrNull;
      if (found != null) return found;
      final p = (name: name, links: <String, Map<String, Object?>>{});
      people.add(p);
      return p;
    }

    if (korie) {
      for (final p in store.profiles) {
        personFor(p.name);
      }
    }
    for (final e in providers.entries) {
      for (final u in e.value) {
        personFor('${u['name']}').links[e.key] = u;
      }
    }
    final sources = providers.length + (korie ? 1 : 0);
    if (sources >= 2) {
      final ids = providers.keys.toList();
      Color colorOf(String id) => _sourceColors[ids.indexOf(id) % _sourceColors.length];
      String nameOf(String id) => host.installed[id]?.manifest.name ?? id;
      while (true) {
        final rows = [
          for (final (i, p) in people.indexed)
            SetupRow(
              'person:$i',
              p.name,
              leading: Avatar(profile: Profile('x', p.name, i % 8), size: geoOf(context).h * 38 / 720),
              chips: [
                if (korieNames.contains(p.name.toLowerCase())) (label: 'Korie · ${p.name}', color: const Color(0xFF8E8E93)),
                for (final id in ids) if (p.links[id] != null) (label: '${nameOf(id)} · ${p.links[id]!['name']}', color: colorOf(id)),
              ],
              value: p.links.length == 1 && !korie ? 'Only ${nameOf(p.links.keys.first)}' : 'Change ›',
            ),
          const SetupRow('next', 'Continue'),
        ];
        final names = [...ids.map(nameOf), if (korie) 'Korie'];
        final r = await show(
          _Spec(
            2,
            'Link Profiles',
            rows,
            message: '${names.join(' and ')} both have profiles. People with the same name are linked; change any of them. Each row becomes one profile in Who’s Watching.',
            focusId: focused,
          ),
        );
        if (r == _back) return _back;
        focused = r;
        if (r == 'next') break;
        final p = people[int.parse(r.substring(7))];
        // Change: which user of each source this person is, or rename.
        final choices = [for (final id in ids) '${nameOf(id)}: ${p.links[id]?['name'] ?? 'nobody'}', 'Rename', 'Remove ${p.name}'];
        final c = await askChoice(context, title: p.name, choices: choices);
        if (c == null || !mounted) continue;
        if (c < ids.length) {
          final id = ids[c];
          final users = providers[id]!;
          final u = await askChoice(context, title: '${p.name} in ${nameOf(id)}', choices: [for (final u in users) '${u['name']}', 'Nobody'], selected: users.indexWhere((u) => u['id'] == p.links[id]?['id']));
          if (u == null) continue;
          // A user belongs to one person.
          for (final other in people) {
            if (u < users.length && other.links[id]?['id'] == users[u]['id']) other.links.remove(id);
          }
          if (u < users.length) {
            p.links[id] = users[u];
          } else {
            p.links.remove(id);
          }
          // Someone who was only that user is nobody now.
          people.removeWhere((o) => o != p && o.links.isEmpty && !korieNames.contains(o.name.toLowerCase()));
        } else if (c == ids.length) {
          if (!mounted) continue;
          final n = await askText(context, title: 'Name', value: p.name, maxLength: 20);
          if (n != null && n.trim().isNotEmpty) people[people.indexOf(p)] = (name: n.trim(), links: p.links);
        } else {
          people.remove(p);
        }
      }
    }
    if (people.isEmpty) return _back;
    store.replaceProfiles(people);
    return 'next';
  }

  /// Korie profiles only: name and PIN of this profile.
  Future<String> korieProfile() async {
    focused = null;
    final p = store.current;
    while (true) {
      final rows = [
        SetupRow('name', 'Name', sub: p.name, value: 'Edit'),
        SetupRow('pin', 'PIN', sub: 'Asked when this profile is picked', value: p.pin == null ? 'Off' : 'On'),
        if (store.profiles.length > 1) SetupRow('others', 'Other Profiles', sub: store.profiles.where((x) => x != p).map((x) => x.name).join(', '), value: 'In Settings'),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(2, 'Create Your Profile', rows, message: 'Your name, and a PIN if you want one. Up to ${Store.maxProfiles} people can have a profile.', focusId: focused));
      if (r == _back || r == 'next') return r;
      focused = r;
      if (!mounted) return _back;
      if (r == 'name') {
        final n = await askText(context, title: 'Your Name', value: p.name, maxLength: 20);
        if (n != null) store.renameProfile(p, n);
      } else if (r == 'pin') {
        if (p.pin != null) {
          store.setPin(p, null);
        } else {
          final pin = await Navigator.of(context).push<String>(fadeRoute(PinPad(profile: p)));
          if (pin != null) store.setPin(p, pin);
        }
      }
    }
  }

  // ------------------------------------------------------------------ 4 look

  Future<String> lookPage() async {
    String? showing = store.wallpaper;
    while (true) {
      final rows = [for (final w in Store.wallpapers) SetupRow('w:$w', w, check: store.wallpaper == w), const SetupRow('next', 'Continue')];
      final completer = show(
        _Spec(
          3,
          'Choose a Look',
          rows,
          message: 'The background behind your apps when nothing is playing.',
          background: wallpaperGradient(showing ?? store.wallpaper),
          focusId: focused ?? 'w:${store.wallpaper}',
        ),
      );
      _onFocusRow = (id) {
        if (id.startsWith('w:') && id.substring(2) != showing) {
          showing = id.substring(2);
          setState(() => spec = _Spec(3, spec!.title, spec!.rows, message: spec!.message, background: wallpaperGradient(showing!), focusId: id));
        }
      };
      final r = await completer;
      _onFocusRow = null;
      if (r == _back || r == 'next') return r;
      focused = r;
      store.setWallpaper(r.substring(2));
    }
  }

  ValueChanged<String>? _onFocusRow;

  // ------------------------------------------------------------------ 5 home screen

  Future<String> homeScreenPage() async {
    while (true) {
      final supported = await Android.listingsSupported();
      final listings = await Android.listingsGranted();
      final corner = await Android.notifAccess();
      final rows = [
        if (supported)
          SetupRow('cw', 'Continue Watching', sub: 'What you are in the middle of, from your apps', value: listings ? null : 'Allow ›', check: listings && store.showContinue),
        SetupRow('rows', 'From Your Apps', sub: 'Rows your apps publish for the home screen', check: store.showAppRows),
        if (Android.on) SetupRow('corner', 'Now Playing in the Corner', sub: 'Music, radio and videos playing in other apps', value: corner ? null : 'Allow ›', check: corner),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(4, 'Your Home Screen', rows, message: 'What shows behind your apps and in the top-right corner.', focusId: focused));
      if (r == _back || r == 'next') return r;
      focused = r;
      switch (r) {
        case 'cw':
          if (!listings) {
            await Android.askListings();
            store.setShowContinue(true);
          } else {
            store.setShowContinue(!store.showContinue);
          }
        case 'rows':
          store.setShowAppRows(!store.showAppRows);
        case 'corner':
          if (!corner && mounted) {
            final opened = await Android.askNotifAccess();
            if (opened) await Android.untilBack();
            if (!opened && mounted) {
              await askChoice(
                context,
                title: 'Now Playing in the Corner',
                message: 'This TV has no screen for notification access. It can be allowed from a computer with:\n\nadb shell cmd notification allow_listener io.github.mightyx3n.korie/io.github.mightyx3n.korie.KorieNotifications',
                choices: const ['OK'],
              );
            }
          }
      }
    }
  }

  // ------------------------------------------------------------------ 6 location

  Future<String> locationPage() async {
    while (true) {
      final loc = store.location;
      final mode = loc['mode'];
      final rows = [
        if (Android.on)
          SetupRow('device', 'Use My Location', sub: 'Android asks once. A TV finds it from Wi-Fi; a car box uses GPS', value: mode == 'device' ? null : 'Allow ›', check: mode == 'device'),
        SetupRow('city', mode == 'city' ? '${loc['name']}' : 'Choose a City…', sub: mode == 'city' ? '${loc['detail']}' : 'Search by name', check: mode == 'city'),
        SetupRow('ip', 'Not Now', sub: 'Korie uses the rough area from your internet address', check: mode == 'ip'),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(5, 'Your Location', rows, message: 'Used for the weather, the map and local radio stations. It stays on this device.', focusId: focused));
      if (r == _back || r == 'next') return r;
      focused = r;
      if (!mounted) return _back;
      switch (r) {
        case 'device':
          if (await Android.askLocation()) store.setLocation({'mode': 'device'});
        case 'city':
          final t = await askText(context, title: 'Choose a City', hint: 'City name', done: 'Search');
          if (t == null || t.trim().isEmpty || !mounted) continue;
          List<Place> found;
          try {
            found = await working(searchCities(t));
          } catch (_) {
            found = const [];
          }
          if (!mounted) continue;
          if (found.isEmpty) {
            await askChoice(context, title: 'Choose a City', message: 'No city called “$t” was found, or there is no internet connection.', choices: const ['OK']);
            continue;
          }
          final i = await askChoice(context, title: 'Which $t?', choices: [for (final p in found) '${p.name} · ${p.detail}']);
          if (i != null) store.setLocation(found[i].toJson('city'));
        case 'ip':
          store.setLocation({'mode': 'ip'});
      }
    }
  }

  // ------------------------------------------------------------------ 7 home button

  Future<String> setHomePage() async {
    if (!Android.on) return 'next';
    while (true) {
      final isHome = await Android.isDefaultHome();
      final rows = [
        SetupRow('home', 'Set Korie as Home', value: isHome ? null : 'Set Up ›', check: isHome),
        const SetupRow('next', 'Continue'),
      ];
      final r = await show(_Spec(6, 'Use Korie for Home', rows, message: 'So the Home button on your remote opens Korie.', focusId: focused));
      if (r == _back || r == 'next') return r;
      focused = r;
      if (!isHome) await Android.askDefaultHome();
    }
  }

  // ------------------------------------------------------------------ 8 done

  Future<String> donePage() => show(
    _Spec(7, 'You’re All Set', [SetupRow('go', widget.again ? 'Back to Settings' : 'Go to Home')], message: 'Korie is ready. Hold OK on any app for options.'),
  );

  @override
  Widget build(BuildContext context) {
    final s = spec;
    if (s == null) return const Material(color: Colors.black);
    return SetupPage(
      key: ValueKey(pageKey),
      title: s.title,
      titleWidget: s.titleWidget,
      message: s.message,
      rows: s.rows,
      dot: s.dot,
      dots: _dots,
      background: s.background,
      busy: busy,
      focusId: s.focusId,
      onChoose: _choose,
      onFocusRow: (id) => _onFocusRow?.call(id),
      onBack: () => _choose(_back),
    );
  }
}

/// "Welcome" fading through languages.
class _Welcome extends StatefulWidget {
  const _Welcome();
  @override
  State<_Welcome> createState() => _WelcomeState();
}

class _WelcomeState extends State<_Welcome> {
  static const words = ['Welcome', 'Velkommen', 'Bienvenue', 'Willkommen', 'Bienvenido', 'ようこそ', '欢迎', 'Benvenuto', 'Välkommen', 'स्वागत है'];
  int i = 0;
  Timer? t;

  @override
  void initState() {
    super.initState();
    t = Timer.periodic(const Duration(milliseconds: 2200), (_) => setState(() => i = (i + 1) % words.length));
  }

  @override
  void dispose() {
    t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final h = MediaQuery.sizeOf(context).height;
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 600),
      child: Text(words[i], key: ValueKey(i), style: tx(h * 72 / 720, w: FontWeight.w800, spacing: -1.5)),
    );
  }
}
