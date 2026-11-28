import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../store.dart';
import '../ui/ask.dart';
import 'player.dart';

/// Something to play from an add-on: a film or an episode, as the add-on gave it. Playing it is
/// the add-on's own "play" action, as when it is chosen in Korie TV.
class PlayEntry {
  PlayEntry({required this.addon, required this.data, required this.title, this.sub = '', this.image = ''});
  final String addon;
  final Map<String, Object?> data;
  final String title, sub, image;

  /// The same film or episode: the add-on and its id.
  String get key => '$addon:${data['id'] ?? data['key'] ?? title}';

  Map<String, Object?> toJson() => {'addon': addon, 'data': data, 'title': title, 'sub': sub, 'image': image};

  static PlayEntry? fromJson(Object? j) {
    if (j is! Map || j['addon'] is! String || j['data'] is! Map) return null;
    return PlayEntry(
      addon: j['addon'] as String,
      data: (j['data'] as Map).cast<String, Object?>(),
      title: '${j['title'] ?? ''}',
      sub: '${j['sub'] ?? ''}',
      image: '${j['image'] ?? ''}',
    );
  }

  /// Asks the add-on to play it (it answers with korie.play, which opens the player).
  /// Played from a playlist: the player knows it, and the playlist goes on after it.
  Future<void> play() async {
    KoriePlayer.instance.choose(this, queued: true);
    await AddonHost.instance.call(addon, 'action', [data, 'play']);
  }
}

class Playlist {
  Playlist({required this.id, required this.name, List<PlayEntry>? items}) : items = items ?? [];
  final String id;
  String name;
  final List<PlayEntry> items;

  Map<String, Object?> toJson() => {'id': id, 'name': name, 'items': [for (final e in items) e.toJson()]};

  static Playlist? fromJson(Object? j) {
    if (j is! Map || j['id'] is! String) return null;
    return Playlist(
      id: j['id'] as String,
      name: '${j['name'] ?? 'Playlist'}',
      items: [for (final e in (j['items'] as List? ?? const [])) ?PlayEntry.fromJson(e)],
    );
  }
}

/// Each profile's playlists. A playlist plays its films and episodes one after another
/// ([PlayQueue]); a series plays on by itself through its add-on's "next".
class Playlists extends ChangeNotifier {
  Playlists._();
  static final instance = Playlists._();

  Store? store;
  String? _for;
  List<Playlist> _lists = [];

  List<Playlist> get lists {
    final s = store;
    if (s == null) return const [];
    if (_for != s.current.id) {
      _for = s.current.id;
      final raw = s.profileData('playlists');
      _lists = [for (final p in (raw is List ? raw : const [])) ?Playlist.fromJson(p)];
    }
    return _lists;
  }

  void _save() {
    store?.setProfileData('playlists', [for (final p in _lists) p.toJson()]);
    notifyListeners();
  }

  Playlist create(String name) {
    final p = Playlist(id: DateTime.now().microsecondsSinceEpoch.toString(), name: name);
    lists.add(p);
    _save();
    return p;
  }

  void rename(Playlist p, String name) {
    p.name = name;
    _save();
  }

  void delete(Playlist p) {
    lists.remove(p);
    _save();
  }

  /// False when it is in the playlist already.
  bool add(Playlist p, PlayEntry e) {
    if (p.items.any((x) => x.key == e.key)) return false;
    p.items.add(e);
    _save();
    return true;
  }

  void remove(Playlist p, int i) {
    p.items.removeAt(i);
    _save();
  }

  void move(Playlist p, int i, int by) {
    final j = (i + by).clamp(0, p.items.length - 1);
    if (j == i) return;
    final e = p.items.removeAt(i);
    p.items.insert(j, e);
    _save();
  }
}

/// What plays one after another: a playlist started from Korie TV. When a film or episode ends,
/// the next one starts (Up Next shows it first).
class PlayQueue {
  PlayQueue._();
  static final instance = PlayQueue._();

  List<PlayEntry> items = const [];
  int index = -1;
  String name = '';

  bool get active => index >= 0 && index < items.length;
  PlayEntry? get current => active ? items[index] : null;
  PlayEntry? get following => index >= 0 && index + 1 < items.length ? items[index + 1] : null;

  Future<void> start(Playlist p, {int from = 0, bool shuffle = false}) async {
    if (p.items.isEmpty) return;
    final list = [...p.items];
    if (shuffle) list.shuffle(math.Random());
    items = list;
    index = shuffle ? 0 : from.clamp(0, list.length - 1);
    name = p.name;
    await items[index].play();
  }

  /// The next one, if there is one. False at the end (the queue is done).
  Future<bool> next() async {
    final n = following;
    if (n == null) {
      clear();
      return false;
    }
    index++;
    await n.play();
    return true;
  }

  void clear() {
    items = const [];
    index = -1;
  }
}

/// "Add to Playlist": the profile's playlists, then New Playlist. Says what happened.
Future<void> addToPlaylist(BuildContext context, PlayEntry e) async {
  final pl = Playlists.instance;
  final lists = pl.lists;
  final choices = [
    for (final p in lists) p.items.any((x) => x.key == e.key) ? '${p.name}  ✓' : p.name,
    'New Playlist…',
  ];
  final pick = await askChoice(context, title: 'Add ${e.sub.isEmpty ? e.title : '${e.title} · ${e.sub}'} to', choices: choices);
  if (pick == null || !context.mounted) return;
  Playlist target;
  if (pick == lists.length) {
    final name = await askText(context, title: 'New Playlist', hint: 'Name', done: 'Make');
    if (name == null || name.trim().isEmpty || !context.mounted) return;
    target = pl.create(name.trim());
  } else {
    target = lists[pick];
  }
  final o = Navigator.of(context).overlay;
  final added = pl.add(target, e);
  if (o != null) showToast(o, added ? 'Added to ${target.name}' : 'Already in ${target.name}');
}
