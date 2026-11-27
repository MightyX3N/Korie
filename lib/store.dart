import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'android.dart';

class Profile {
  Profile(this.id, this.name, this.color, {this.pin, Map<String, Map<String, Object?>>? links}) : links = links ?? {};
  final String id;
  String name;
  int color;

  /// A 4-digit PIN asked when this profile is picked; null for none.
  String? pin;

  /// Accounts in add-ons that this profile is, by add-on id: {id, name, password}.
  /// Picking the profile signs these in (a Jellyfin user, for example).
  final Map<String, Map<String, Object?>> links;

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'color': color, if (pin != null) 'pin': pin, if (links.isNotEmpty) 'links': links};

  static Profile fromJson(Map<String, dynamic> m) => Profile(
    m['id'] as String,
    m['name'] as String,
    m['color'] as int,
    pin: m['pin'] as String?,
    links: {
      for (final e in ((m['links'] as Map?) ?? const {}).entries)
        if (e.value is Map) '${e.key}': (e.value as Map).cast<String, Object?>(),
    },
  );
}

/// Everything Korie remembers. Each profile has its own app order, hidden apps, background and
/// top-shelf choices.
class Store extends ChangeNotifier {
  Store._(this._p);
  final SharedPreferences _p;
  static const maxProfiles = 8;
  static const settingsId = 'korie.settings';
  static const folderId = 'korie.folder';
  static const tvId = 'korie.tv';

  static Future<Store> open() async {
    final s = Store._(await SharedPreferences.getInstance());
    s._loadProfiles();
    return s;
  }

  // ------------------------------------------------------------- profiles

  final List<Profile> profiles = [];
  late String currentId;

  Profile get current => profiles.firstWhere((p) => p.id == currentId, orElse: () => profiles.first);

  void _loadProfiles() {
    final raw = _p.getString('profiles');
    if (raw != null) {
      for (final e in jsonDecode(raw) as List) {
        profiles.add(Profile.fromJson(e as Map<String, dynamic>));
      }
    }
    if (profiles.isEmpty) {
      profiles.add(Profile('p1', 'Me', 0));
      _saveProfiles();
    }
    currentId = _p.getString('current') ?? profiles.first.id;
  }

  void _saveProfiles() => _p.setString('profiles', jsonEncode(profiles.map((p) => p.toJson()).toList()));

  void choose(Profile p) {
    currentId = p.id;
    _p.setString('current', p.id);
    notifyListeners();
  }

  bool get canAddProfile => profiles.length < maxProfiles;

  Profile? addProfile(String name) {
    if (!canAddProfile || name.trim().isEmpty) return null;
    var n = 1;
    while (profiles.any((p) => p.id == 'p$n')) {
      n++;
    }
    final used = profiles.map((p) => p.color).toSet();
    var color = 0;
    while (used.contains(color) && color < 7) {
      color++;
    }
    final p = Profile('p$n', name.trim(), color);
    profiles.add(p);
    _saveProfiles();
    notifyListeners();
    return p;
  }

  void renameProfile(Profile p, String name) {
    if (name.trim().isEmpty) return;
    p.name = name.trim();
    _saveProfiles();
    notifyListeners();
  }

  void setPin(Profile p, String? pin) {
    p.pin = (pin == null || pin.isEmpty) ? null : pin;
    _saveProfiles();
    notifyListeners();
  }

  void setLink(Profile p, String addonId, Map<String, Object?>? user) {
    if (user == null) {
      p.links.remove(addonId);
    } else {
      p.links[addonId] = user;
    }
    _saveProfiles();
    notifyListeners();
  }

  /// Makes the profiles exactly [people] (setup's Link Profiles): a person whose name matches a
  /// profile keeps that profile, with its apps and order; the other profiles are removed.
  void replaceProfiles(List<({String name, Map<String, Map<String, Object?>> links})> people) {
    final keep = <Profile>[];
    for (final person in people.take(maxProfiles)) {
      final old = profiles.where((p) => p.name.toLowerCase() == person.name.toLowerCase() && !keep.contains(p)).firstOrNull;
      if (old != null) {
        old.links
          ..clear()
          ..addAll(person.links);
        keep.add(old);
        continue;
      }
      var n = 1;
      while (profiles.any((p) => p.id == 'p$n') || keep.any((p) => p.id == 'p$n')) {
        n++;
      }
      keep.add(Profile('p$n', person.name, keep.length % 8, links: person.links));
    }
    if (keep.isEmpty) return;
    for (final gone in profiles.where((p) => !keep.contains(p)).toList()) {
      for (final k in _p.getKeys().where((k) => k.startsWith('${gone.id}.')).toList()) {
        _p.remove(k);
      }
    }
    profiles
      ..clear()
      ..addAll(keep);
    if (!profiles.any((p) => p.id == currentId)) currentId = profiles.first.id;
    _p.setString('current', currentId);
    _saveProfiles();
    notifyListeners();
  }

  // ------------------------------------------------------------- setup and place

  bool get setupDone => _p.getBool('setup.done') ?? false;

  /// Who's Watching when the TV wakes or starts. Off: straight into the last profile (unless it
  /// has a PIN, which is always asked).
  bool get askWho => _p.getBool('ask.who') ?? true;
  void setAskWho(bool v) {
    _p.setBool('ask.who', v);
    notifyListeners();
  }

  /// Should Who's Watching show now that the TV has woken up?
  bool get pickOnWake => current.pin != null || (askWho && profiles.length > 1);
  void setSetupDone() => _p.setBool('setup.done', true);

  /// Where Korie is, for the weather, the map and local radio: {mode: device|city|ip, name, lat, lon}.
  Map<String, Object?> get location {
    final raw = _p.getString('location');
    return raw == null ? const {'mode': 'ip'} : (jsonDecode(raw) as Map).cast<String, Object?>();
  }

  void setLocation(Map<String, Object?> v) {
    _p.setString('location', jsonEncode(v));
    notifyListeners();
  }

  void recolourProfile(Profile p) {
    p.color = (p.color + 1) % 8;
    _saveProfiles();
    notifyListeners();
  }

  void deleteProfile(Profile p) {
    if (profiles.length <= 1) return;
    profiles.removeWhere((x) => x.id == p.id);
    for (final k in _p.getKeys().where((k) => k.startsWith('${p.id}.')).toList()) {
      _p.remove(k);
    }
    if (currentId == p.id) currentId = profiles.first.id;
    _p.setString('current', currentId);
    _saveProfiles();
    notifyListeners();
  }

  String _k(String key) => '${current.id}.$key';

  // ------------------------------------------------------------- apps on Home

  /// The apps in Home order for this profile: saved order first, new apps at the end.
  List<String> order(List<App> apps) {
    final ids = apps.map((a) => a.id).toSet();
    final saved = (_p.getStringList(_k('order')) ?? const []).where(ids.contains).toList();
    final rest = apps.where((a) => !saved.contains(a.id)).toList()..sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    // Korie TV starts as the first app in the dock; the user can move it anywhere after that.
    final tv = rest.any((a) => a.id == tvId) && !_p.containsKey(_k('order.tv')) ? [tvId] : const <String>[];
    return [...tv, ...saved, ...rest.map((a) => a.id).where((id) => !tv.contains(id))];
  }

  void saveOrder(List<String> ids) {
    _p.setStringList(_k('order'), ids);
    if (ids.contains(tvId)) _p.setBool(_k('order.tv'), true);
    notifyListeners();
  }

  void resetLayout() {
    _p.remove(_k('order'));
    notifyListeners();
  }

  Set<String> get hidden => (_p.getStringList(_k('hidden')) ?? const []).toSet();

  void setHidden(String id, bool hide) {
    final h = hidden;
    hide ? h.add(id) : h.remove(id);
    _p.setStringList(_k('hidden'), h.toList());
    notifyListeners();
  }

  // ------------------------------------------------------------- top shelf and look

  bool get showContinue => _p.getBool(_k('shelf.continue')) ?? true;
  bool get showAppRows => _p.getBool(_k('shelf.apps')) ?? true;
  void setShowContinue(bool v) {
    _p.setBool(_k('shelf.continue'), v);
    notifyListeners();
  }

  void setShowAppRows(bool v) {
    _p.setBool(_k('shelf.apps'), v);
    notifyListeners();
  }

  /// Carousel items the user removed (Hold OK → Remove); they come back once watched again.
  Set<String> get removed => (_p.getStringList(_k('shelf.removed')) ?? const []).toSet();
  void removeItem(String key) {
    _p.setStringList(_k('shelf.removed'), [...removed, key]);
    notifyListeners();
  }

  static const wallpapers = ['Aurora', 'Midnight', 'Sunset', 'Ocean', 'Graphite'];
  String get wallpaper => _p.getString(_k('wallpaper')) ?? 'Aurora';
  void setWallpaper(String w) {
    _p.setString(_k('wallpaper'), w);
    notifyListeners();
  }
}
