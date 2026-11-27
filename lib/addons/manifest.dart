import 'dart:convert';
import 'dart:io';

/// One setting row of an add-on, from addon.json.
class AddonSetting {
  AddonSetting(this.key, this.title, this.type, this.defaultValue, this.options);
  final String key, title, type; // type: choice, toggle, text, action
  final Object? defaultValue;
  final List<({String value, String label})> options;

  static AddonSetting? parse(Object? j) {
    if (j is! Map) return null;
    final key = j['key'], title = j['title'], type = j['type'];
    if (key is! String || title is! String || type is! String) return null;
    final opts = <({String value, String label})>[];
    if (j['options'] is List) {
      for (final o in j['options'] as List) {
        if (o is Map && o['value'] != null) {
          opts.add((value: '${o['value']}', label: '${o['label'] ?? o['value']}'));
        }
      }
    }
    return AddonSetting(key, title, type, j['default'], opts);
  }
}

/// What addon.json says about an add-on.
class AddonManifest {
  AddonManifest({
    required this.id,
    required this.name,
    required this.version,
    required this.author,
    required this.description,
    required this.uses,
    required this.icon,
    required this.settings,
  });

  final String id, name, version, author, description;
  final List<String> uses;
  final String? icon;
  final List<AddonSetting> settings;

  static final idPattern = RegExp(r'^[a-z0-9][a-z0-9.\-]{0,63}$');

  /// Null when the text is not a valid addon.json.
  static AddonManifest? parse(String text) {
    Object? j;
    try {
      j = jsonDecode(text);
    } catch (_) {
      return null;
    }
    if (j is! Map) return null;
    final id = j['id'];
    if (id is! String || !idPattern.hasMatch(id)) return null;
    return AddonManifest(
      id: id,
      name: '${j['name'] ?? id}',
      version: '${j['version'] ?? '1.0'}',
      author: '${j['author'] ?? ''}',
      description: '${j['description'] ?? ''}',
      uses: [for (final u in (j['uses'] is List ? j['uses'] as List : const [])) '$u'],
      icon: j['icon'] is String ? j['icon'] as String : null,
      settings: [
        for (final s in (j['settings'] is List ? j['settings'] as List : const []))
          if (AddonSetting.parse(s) case final p?) p,
      ],
    );
  }

  static AddonManifest? read(Directory dir) {
    final f = File('${dir.path}/addon.json');
    if (!f.existsSync()) return null;
    return parse(f.readAsStringSync());
  }

  /// What each `uses` entry lets the add-on do, in words for the install question.
  static String explain(String use) => switch (use) {
        'internet' => 'Use the internet',
        'apps' => 'Open apps and links',
        'location' => 'Know where this device is',
        'profiles' => 'Sign in profiles',
        'media' => 'See what other apps are playing',
        _ => use,
      };
}

/// Compares versions like "1.10" > "1.9".
int compareVersions(String a, String b) {
  final pa = a.split('.'), pb = b.split('.');
  for (var i = 0; i < pa.length || i < pb.length; i++) {
    final x = i < pa.length ? int.tryParse(pa[i]) ?? 0 : 0;
    final y = i < pb.length ? int.tryParse(pb[i]) ?? 0 : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}
