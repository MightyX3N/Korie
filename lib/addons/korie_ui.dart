import 'package:material_ui/material_ui.dart';

import '../android.dart';
import '../store.dart';
import '../ui/ask.dart';
import 'host.dart';

/// The screen side of the add-on API: questions, messages, profiles, links and apps.
class KorieAddonUi implements AddonUi {
  KorieAddonUi(this.store, this.navigator);
  final Store store;
  final GlobalKey<NavigatorState> navigator;

  /// Set by the player when it exists; until then add-ons hear that nothing can play.
  Future<List<Object?>> Function(String addonId, Map<String, Object?> request)? play;
  Future<List<Object?>> Function()? stop;

  static Map<String, Object?> profileValue(Profile p) => {'id': p.id, 'name': p.name};

  @override
  Future<List<Object?>> request(String addonId, String op, List<Object?> args) async {
    final a0 = args.isNotEmpty ? args[0] : null;
    switch (op) {
      case 'profile':
        return [profileValue(store.current)];
      case 'profiles.list':
        return [
          [for (final p in store.profiles) profileValue(p)],
        ];
      case 'profiles.add':
        final p = store.addProfile('${a0 ?? ''}');
        return p == null ? [null, store.canAddProfile ? 'no name' : 'Korie has ${Store.maxProfiles} profiles already'] : [profileValue(p)];
      case 'toast':
        final o = navigator.currentState?.overlay;
        if (o != null) showToast(o, '${a0 ?? ''}');
        return const [true];
      case 'ask':
        return [await _ask(addonId, a0 is Map ? a0 : const {})];
      case 'open':
        final t = a0 is Map ? a0 : {'url': a0};
        if (t['package'] != null || t['app'] != null) {
          await Android.launch('${t['package'] ?? t['app']}');
          return const [true];
        }
        return [await Android.openUrl('${t['url'] ?? ''}')];
      case 'apps.list':
        final apps = await Android.apps();
        return [
          [for (final a in apps) {'package': a.id, 'name': a.label}],
        ];
      case 'apps.open':
        await Android.launch('$a0');
        return const [true];
      case 'play':
        final p = play;
        if (p == null) {
          // Until Korie's own player is there, say so instead of doing nothing.
          final o = navigator.currentState?.overlay;
          if (o != null) showToast(o, 'Korie can\'t play videos yet: its player is coming in a later update');
          return const [null, 'Korie has no player yet'];
        }
        return p(addonId, a0 is Map ? a0.cast<String, Object?>() : const {});
      case 'stop':
        return await stop?.call() ?? const [true];
      case 'refresh':
        AddonHost.instance.refreshCatalog(addonId);
        return const [true];
      default:
        return [null, 'Korie does not know "$op"'];
    }
  }

  Future<Object?> _ask(String addonId, Map t) async {
    final ctx = navigator.currentState?.overlay?.context;
    if (ctx == null) return null;
    final title = '${t['title'] ?? AddonHost.instance.installed[addonId]?.manifest.name ?? ''}';
    final message = t['message'] == null ? null : '${t['message']}';
    final choices = [for (final c in (t['choices'] is List ? t['choices'] as List : const [])) '$c'];
    final input = t['input'];
    if (input == 'text' || input == 'password' || input == 'number') {
      return askText(
        ctx,
        title: title,
        message: message,
        value: '${t['value'] ?? ''}',
        hint: '${t['hint'] ?? ''}',
        password: input == 'password',
        digits: input == 'number',
      );
    }
    if (choices.isEmpty) {
      final r = await askChoice(ctx, title: title, message: message, choices: const ['OK']);
      return r == null ? null : true;
    }
    final i = await askChoice(ctx, title: title, message: message, choices: choices);
    return i == null ? null : i + 1; // Lua counts from 1
  }
}
