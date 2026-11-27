import '../addons/host.dart';

/// One add-on's copy of a title: which add-on, and its own item table (handed back unchanged
/// when Korie asks that add-on about it).
class TvSource {
  const TvSource(this.addon, this.name, this.data);
  final String addon, name;
  final Map<String, Object?> data;
}

/// A film, series or anything else to watch in Korie TV. Titles from several add-ons with the
/// same `key` are one item with one source per add-on.
class TvItem {
  TvItem._(this.sources);

  /// Reads an add-on's item. Returns null when it has no title.
  static TvItem? from(String addon, String name, Object? raw) {
    if (raw is! Map || raw['title'] == null || '${raw['title']}'.isEmpty) return null;
    return TvItem._([TvSource(addon, name, raw.cast<String, Object?>())]);
  }

  final List<TvSource> sources;
  Map<String, Object?> get data => sources.first.data;

  String _s(String k) {
    for (final s in sources) {
      final v = s.data[k];
      if (v != null && '$v'.isNotEmpty) return '$v';
    }
    return '';
  }

  String get title => _s('title');
  String get type => _s('type');
  bool get isSeries => type == 'series';
  bool get isMovie => type == 'movie';
  String get year => _s('year');
  String get ends => _s('ends');
  String get overview => _s('overview');
  String get poster => _s('poster');
  String get backdrop => _s('backdrop');
  String get thumb => _s('thumb');
  String get added => _s('added');
  String get key => _s('key');
  String get official => _s('official');
  String get episode => _s('episode');

  /// Where the add-on keeps it: a title without a shared `key` is known by add-on and id.
  String get id => key.isNotEmpty ? key : '${sources.first.addon}:${data['id'] ?? title}';

  List<String> get genres {
    for (final s in sources) {
      final g = s.data['genres'];
      if (g is List && g.isNotEmpty) return [for (final x in g) '$x'];
      if (g is String && g.trim().isNotEmpty) return [for (final x in g.split(',')) if (x.trim().isNotEmpty) x.trim()];
    }
    return const [];
  }

  double? get rating {
    for (final s in sources) {
      final r = s.data['rating'];
      if (r is num && r > 0) return r.toDouble();
    }
    return null;
  }

  /// Length in minutes, or 0.
  int get runtime {
    for (final s in sources) {
      final r = s.data['runtime'];
      if (r is num && r > 0) return r.round();
    }
    return 0;
  }

  /// 0 to 1 when started, otherwise -1.
  double get progress {
    final p = data['progress'];
    return p is num && p > 0 ? p.toDouble().clamp(0, 1) : -1;
  }

  /// Minutes left when started, otherwise -1.
  int get remaining {
    final r = data['remaining'];
    return r is num && r > 0 ? r.round() : -1;
  }

  /// The best wide picture: backdrop, then thumb, then the poster.
  String get wide => backdrop.isNotEmpty ? backdrop : (thumb.isNotEmpty ? thumb : poster);

  /// "Movie · Sci-Fi · Adventure · 2024 · 2h 46m"
  String get meta {
    final parts = <String>[
      if (isMovie) 'Movie',
      if (isSeries) 'Series',
      ...genres.take(2),
      if (year.isNotEmpty) ends.isNotEmpty && ends != year ? '$year–$ends' : year,
      if (runtime > 0) duration(runtime),
    ];
    return parts.join(' · ');
  }

  void merge(TvItem other) {
    for (final s in other.sources) {
      if (!sources.any((x) => x.addon == s.addon)) sources.add(s);
    }
  }
}

/// "2h 46m", "48m"
String duration(int minutes) {
  if (minutes >= 60) return minutes % 60 == 0 ? '${minutes ~/ 60}h' : '${minutes ~/ 60}h ${minutes % 60}m';
  return '${minutes}m';
}

/// A row of a Korie TV page: tall posters, or wide pictures (Continue Watching).
class TvRow {
  TvRow(this.title, this.items, {this.wide = false, this.square = false, this.resume = false});
  final String title;
  final List<TvItem> items;
  final bool wide;

  /// Square pictures with the name under them: logos (radio stations, channels).
  final bool square;

  /// Continue Watching: OK plays straight away, holding OK opens the title's page.
  final bool resume;
}

/// What a page shows: featured items at the top (a full-screen picture each), then rows.
class TvPage {
  TvPage(this.featured, this.rows);
  final List<TvItem> featured;
  final List<TvRow> rows;
  bool get isEmpty => featured.isEmpty && rows.isEmpty;
}

/// A sidebar section that an add-on adds (Live TV, Radio…).
class TvSection {
  TvSection(this.addon, this.id, this.title, this.icon);
  final String addon, id, title, icon;
  String get page => '$addon/$id';
}

/// An add-on's own tile in the app grid.
class TvTile {
  TvTile(this.addon, this.id, this.title, this.image, this.colors, this.section, this.icon);
  final String addon, id, title, image, icon;
  final List<int> colors;
  final String? section;
  String get appId => 'addon:$addon:$id';
}

/// Everything add-ons give Korie TV, gathered and mixed. Add-ons answer with their own items;
/// Korie puts titles that share a `key` together and builds the usual rows itself (Recently
/// Added, one row per genre) from the add-ons' catalogs, so a simple add-on only has to answer
/// `catalog` (and `home` for Continue Watching) to fill Korie TV.
class TvLibrary {
  TvLibrary(this.host);
  final AddonHost host;

  static const pages = ['home', 'movies', 'series'];

  String nameOf(String addon) => host.installed[addon]?.manifest.name ?? addon;

  /// True when Korie TV has anything to show: its tile is on Home only then.
  bool get hasContent =>
      host.catalogs.values.any((c) => c.isNotEmpty) ||
      ['catalog', 'home', 'tv', 'tv.sections'].any((e) => host.handlersOf(e).isNotEmpty);

  /// Every add-on's catalog, titles with the same key put together.
  List<TvItem> all() {
    final out = <TvItem>[];
    final byKey = <String, TvItem>{};
    for (final e in host.catalogs.entries) {
      if (!(host.installed[e.key]?.enabled ?? false)) continue;
      for (final raw in e.value) {
        final it = TvItem.from(e.key, nameOf(e.key), raw);
        if (it == null) continue;
        final k = it.key;
        if (k.isNotEmpty && byKey.containsKey(k)) {
          byKey[k]!.merge(it);
        } else {
          if (k.isNotEmpty) byKey[k] = it;
          out.add(it);
        }
      }
    }
    return out;
  }

  /// Items from an add-on answer (a list of item tables), with titles found in the catalogs
  /// given their other sources too.
  List<TvItem> read(String addon, Object? list, {List<TvItem>? catalog}) {
    if (list is! List) return const [];
    final byKey = {for (final c in catalog ?? const <TvItem>[]) if (c.key.isNotEmpty) c.key: c};
    final byId = {
      for (final c in catalog ?? const <TvItem>[])
        for (final s in c.sources)
          if (s.addon == addon && s.data['id'] != null) '${s.data['id']}': c,
    };
    final out = <TvItem>[];
    for (final raw in list) {
      if (raw is! Map) continue;
      // The add-on's own catalog entry for this title fills in what the answer leaves out
      // (a Continue Watching item often has no genres or key).
      final same = byId['${raw['id']}'];
      final base = same?.sources.firstWhere((s) => s.addon == addon).data;
      final it = TvItem.from(addon, nameOf(addon), base == null ? raw : {...base, ...raw});
      if (it == null) continue;
      final other = byKey[it.key];
      if (other != null) {
        for (final s in other.sources) {
          if (s.addon != addon) it.sources.add(s);
        }
      }
      out.add(it);
    }
    return out;
  }

  Future<List<TvSection>> sections() async {
    final out = <TvSection>[];
    for (final e in (await host.callAll('tv.sections')).entries) {
      if (e.value is! List) continue;
      for (final s in e.value as List) {
        if (s is Map && s['id'] != null && s['title'] != null) out.add(TvSection(e.key, '${s['id']}', '${s['title']}', '${s['icon'] ?? 'list'}'));
      }
    }
    return out;
  }

  Future<List<TvTile>> tiles() async {
    final out = <TvTile>[];
    for (final e in (await host.callAll('tiles')).entries) {
      if (e.value is! List) continue;
      for (final t in e.value as List) {
        if (t is! Map || t['id'] == null || t['title'] == null) continue;
        final colors = [for (final c in (t['colors'] is List ? t['colors'] as List : const [])) if (c is String) _color(c)].whereType<int>().toList();
        out.add(TvTile(e.key, '${t['id']}', '${t['title']}', '${t['image'] ?? ''}', colors, t['section'] == null ? null : '${e.key}/${t['section']}', '${t['icon'] ?? 'list'}'));
      }
    }
    return out;
  }

  static int? _color(String hex) {
    final h = hex.replaceFirst('#', '');
    final v = int.tryParse(h.length == 6 ? 'FF$h' : h, radix: 16);
    return v;
  }

  static int _byAddedDesc(TvItem a, TvItem b) => b.added.compareTo(a.added);

  /// Continue Watching: what the add-ons answer `home` with.
  Future<List<TvItem>> continueWatching(List<TvItem> catalog) async {
    final out = <TvItem>[];
    for (final e in (await host.callAll('home')).entries) {
      out.addAll(read(e.key, e.value, catalog: catalog));
    }
    return out;
  }

  /// A page: "home", "movies", "series", or an add-on's section (add-on id, "/", section id).
  Future<TvPage> page(String page) async {
    final catalog = all();
    final featured = <TvItem>[];
    final rows = <TvRow>[];
    final extra = <TvRow>[];

    // What add-ons add to this page themselves.
    final section = page.contains('/');
    final addonId = section ? page.substring(0, page.indexOf('/')) : null;
    final args = [section ? page.substring(page.indexOf('/') + 1) : page];
    final answers = section ? {addonId!: await host.call(addonId, 'tv', args)} : await host.callAll('tv', args);
    for (final e in answers.entries) {
      final v = e.value;
      if (v is! Map) continue;
      featured.addAll(read(e.key, v['featured'], catalog: catalog));
      for (final r in (v['rows'] is List ? v['rows'] as List : const [])) {
        if (r is! Map || r['title'] == null) continue;
        final items = read(e.key, r['items'], catalog: catalog);
        if (items.isNotEmpty) extra.add(TvRow('${r['title']}', items, wide: r['style'] == 'wide' || r['wide'] == true, square: r['style'] == 'square'));
      }
    }
    if (section) return TvPage(featured, extra);

    final kind = switch (page) {
      'movies' => 'movie',
      'series' => 'series',
      _ => null,
    };
    final list = catalog.where((i) => kind == null ? i.isMovie || i.isSeries : i.type == kind).toList();
    final recent = [...list]..sort(_byAddedDesc);

    // The featured pictures: the add-ons' own first, then the newest titles that have a backdrop.
    for (final it in recent) {
      if (featured.length >= 6) break;
      if (it.backdrop.isNotEmpty && !featured.any((f) => f.id == it.id)) featured.add(it);
    }

    if (page == 'home') {
      final cw = await continueWatching(catalog);
      if (cw.isNotEmpty) rows.add(TvRow('Continue Watching', cw, wide: true, resume: true));
      rows.addAll(extra);
      final movies = recent.where((i) => i.isMovie).take(20).toList();
      final series = recent.where((i) => i.isSeries).take(20).toList();
      // Other kinds (radio stations, channels) are in Search and in their add-on's own section.
      if (movies.isNotEmpty) rows.add(TvRow('Recently Added Movies', movies));
      if (series.isNotEmpty) rows.add(TvRow('Recently Added Series', series));
      return TvPage(featured, rows);
    }

    if (recent.isNotEmpty) rows.add(TvRow('Recently Added', recent.take(20).toList()));
    rows.addAll(extra);
    // One row per genre, the biggest genres first.
    final byGenre = <String, List<TvItem>>{};
    for (final it in list) {
      for (final g in it.genres) {
        byGenre.putIfAbsent(g, () => []).add(it);
      }
    }
    final genres = byGenre.keys.where((g) => byGenre[g]!.length >= 2).toList()..sort((a, b) => byGenre[b]!.length.compareTo(byGenre[a]!.length));
    for (final g in genres.take(10)) {
      rows.add(TvRow(g, (byGenre[g]!..sort(_byAddedDesc)).take(20).toList()));
    }
    return TvPage(featured, rows);
  }

  /// More Like This: the add-on's own answer to `similar`, else titles sharing the most genres.
  Future<List<TvItem>> similar(TvItem item) async {
    final catalog = all();
    final s = item.sources.first;
    if (host.handles(s.addon).contains('similar')) {
      final v = read(s.addon, await host.call(s.addon, 'similar', [s.data]), catalog: catalog);
      if (v.isNotEmpty) return v;
    }
    final g = item.genres.toSet();
    if (g.isEmpty) return const [];
    final scored = [
      for (final c in catalog)
        if (c.id != item.id) (c, c.genres.where(g.contains).length + (c.type == item.type ? 0.5 : 0)),
    ].where((x) => x.$2 >= 1).toList()..sort((a, b) => b.$2.compareTo(a.$2));
    return [for (final x in scored.take(15)) x.$1];
  }

  /// Search: the catalogs on the device, plus add-ons that search themselves.
  Future<List<TvItem>> search(String text) async {
    final q = text.trim().toLowerCase();
    if (q.isEmpty) return const [];
    final catalog = all();
    final out = [
      for (final c in catalog)
        if (c.title.toLowerCase().contains(q) || c.genres.any((g) => g.toLowerCase() == q)) c,
    ]..sort((a, b) => (a.title.toLowerCase().startsWith(q) ? 0 : 1).compareTo(b.title.toLowerCase().startsWith(q) ? 0 : 1));
    final askers = [for (final a in host.handlersOf('search')) if (!host.handles(a.id).contains('catalog')) a.id];
    for (final id in askers) {
      for (final it in read(id, await host.call(id, 'search', [text]), catalog: catalog)) {
        if (!out.any((o) => o.id == it.id)) out.add(it);
      }
    }
    return out;
  }
}
