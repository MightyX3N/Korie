import 'dart:typed_data';

import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../addons/manifest.dart';
import '../android.dart';
import '../ui/ask.dart';
import 'home.dart' show fadeRoute;
import 'settings.dart';

AddonHost get _host => AddonHost.instance;

/// The install question every way of installing ends in: what the add-on is, who made it and
/// what it can use. Installs on yes; returns the installed add-on.
Future<InstalledAddon?> confirmInstall(BuildContext context, AddonPackage p) async {
  final m = p.manifest;
  final old = _host.installed[m.id];
  final can = m.uses.isEmpty ? 'Nothing outside Korie.' : m.uses.map(AddonManifest.explain).join(' · ');
  final i = await askChoice(
    context,
    title: old == null ? 'Install ${m.name}?' : 'Update ${m.name} to ${m.version}?',
    message: [
      if (m.description.isNotEmpty) m.description,
      [if (m.author.isNotEmpty) 'By ${m.author}', 'Version ${m.version}', if (old != null) 'now ${old.manifest.version}'].join(' · '),
      'It can: $can',
    ].join('\n\n'),
    choices: ['Cancel', old == null ? 'Install' : 'Update'],
  );
  if (i != 1) return null;
  final a = await _host.install(p);
  if (context.mounted) {
    final o = Navigator.of(context).overlay;
    final err = _host.errorOf(a.id);
    if (o != null) showToast(o, err == null ? '${m.name} is installed' : '${m.name} is installed but does not start');
  }
  return a;
}

/// Reads [bytes] as an add-on and asks to install it.
Future<InstalledAddon?> installBytes(BuildContext context, Uint8List? bytes) async {
  final p = bytes == null ? null : AddonHost.readPackage(bytes);
  if (p == null) {
    if (context.mounted) await askChoice(context, title: 'Not an add-on', message: 'This file is not a Korie add-on, or it is damaged.', choices: const ['OK']);
    return null;
  }
  if (!context.mounted) return null;
  return confirmInstall(context, p);
}

/// Downloads an entry of the add-on list and asks to install it.
Future<InstalledAddon?> installFromList(BuildContext context, IndexEntry e) async {
  Uint8List bytes;
  try {
    bytes = await _host.download(e.url);
  } catch (err) {
    if (context.mounted) await askChoice(context, title: 'Could not download ${e.name}', message: '$err', choices: const ['OK']);
    return null;
  }
  if (!context.mounted) return null;
  return installBytes(context, bytes);
}

/// The .korie files in the Download folder; asks for file access first when needed.
Future<void> installFromDownloads(BuildContext context) async {
  if (!await Android.canReadDownloads()) {
    if (!context.mounted) return;
    final i = await askChoice(
      context,
      title: 'Download folder',
      message: 'To find add-on files in the Download folder, allow Korie to access files on the next screen, then come back.',
      choices: const ['Cancel', 'Continue'],
    );
    if (i != 1) return;
    await Android.askReadDownloads();
    await Android.untilBack();
    // Android restarts Korie when this access is given; if it did not, carry on to the files.
    if (!await Android.canReadDownloads() || !context.mounted) return;
  }
  final files = await Android.downloads();
  if (!context.mounted) return;
  if (files.isEmpty) {
    await askChoice(context, title: 'Download folder', message: 'There are no .korie files in the Download folder.', choices: const ['OK']);
    return;
  }
  final i = await askChoice(context, title: 'Download folder', choices: [for (final f in files) f.name]);
  if (i == null || !context.mounted) return;
  await installBytes(context, await Android.readFile(files[i].path));
}

/// Settings → Add-ons.
class AddonsSettings extends StatefulWidget {
  const AddonsSettings({super.key});
  @override
  State<AddonsSettings> createState() => _AddonsSettingsState();
}

class _AddonsSettingsState extends State<AddonsSettings> {
  @override
  void initState() {
    super.initState();
    _host.addListener(_changed);
  }

  @override
  void dispose() {
    _host.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final list = _host.installed.values.toList()..sort((a, b) => a.manifest.name.toLowerCase().compareTo(b.manifest.name.toLowerCase()));
    return SettingsPage(
      title: 'Add-ons',
      subtitle: list.isEmpty ? 'None installed' : '${list.length} installed',
      icon: Icons.extension_rounded,
      rows: [
        for (final a in list)
          SRow(
            a.manifest.name,
            value: !a.enabled ? 'Off' : (_host.errorOf(a.id) != null ? 'Not working' : a.manifest.version),
            onTap: () => Navigator.of(context).push(fadeRoute(AddonPage(id: a.id))),
          ),
        SRow('Get Add-ons', value: 'From the Korie list', onTap: () => Navigator.of(context).push(fadeRoute(const GetAddons()))),
        if (Android.on) SRow('From the Download folder', onTap: () => installFromDownloads(context)),
      ],
    );
  }
}

/// The add-on list from the Korie repository.
class GetAddons extends StatefulWidget {
  const GetAddons({super.key});
  @override
  State<GetAddons> createState() => _GetAddonsState();
}

class _GetAddonsState extends State<GetAddons> {
  List<IndexEntry>? list;
  String? error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      list = await _host.fetchIndex();
      error = null;
    } catch (e) {
      error = 'Could not reach the add-on list';
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l = list;
    return SettingsPage(
      title: 'Get Add-ons',
      subtitle: error ?? (l == null ? 'Loading…' : 'From the Korie repository'),
      icon: Icons.download_rounded,
      rows: [
        if (error != null) SRow('Try Again', chevron: false, onTap: _load),
        for (final e in l ?? const <IndexEntry>[])
          SRow(
            e.name,
            value: switch (_host.installed[e.id]) {
              null => 'Install',
              final a when compareVersions(e.version, a.manifest.version) > 0 => 'Update to ${e.version}',
              _ => 'Installed',
            },
            chevron: false,
            onTap: () async {
              await installFromList(context, e);
              if (mounted) setState(() {});
            },
          ),
      ],
    );
  }
}

/// One add-on: its settings, then On/Off, Update, Log and Uninstall.
class AddonPage extends StatefulWidget {
  const AddonPage({super.key, required this.id});
  final String id;
  @override
  State<AddonPage> createState() => _AddonPageState();
}

class _AddonPageState extends State<AddonPage> {
  IndexEntry? newer;

  @override
  void initState() {
    super.initState();
    _host.addListener(_changed);
    _checkUpdate();
  }

  @override
  void dispose() {
    _host.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _checkUpdate() async {
    try {
      final a = _host.installed[widget.id];
      for (final e in await _host.fetchIndex()) {
        if (a != null && e.id == a.id && compareVersions(e.version, a.manifest.version) > 0) newer = e;
      }
      _changed();
    } catch (_) {}
  }

  String _shown(AddonSetting s, Object? v) => switch (s.type) {
        'toggle' => v == true ? 'On' : 'Off',
        'choice' => s.options.where((o) => o.value == '$v').map((o) => o.label).firstOrNull ?? '${v ?? ''}',
        'password' => (v == null || v == '') ? '' : '••••••',
        _ => v == null ? '' : '$v',
      };

  Future<void> _edit(AddonSetting s, Object? v) async {
    switch (s.type) {
      case 'toggle':
        await _host.setSetting(widget.id, s.key, v != true);
      case 'choice':
        final i = await askChoice(
          context,
          title: s.title,
          choices: [for (final o in s.options) o.label],
          selected: s.options.indexWhere((o) => o.value == '$v'),
        );
        if (i != null) await _host.setSetting(widget.id, s.key, s.options[i].value);
      case 'text' || 'password':
        final t = await askText(context, title: s.title, value: s.type == 'password' ? '' : '${v ?? ''}', password: s.type == 'password');
        if (t != null) await _host.setSetting(widget.id, s.key, t);
      case 'action':
        await _host.call(widget.id, 'button', [s.key]);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _host.installed[widget.id];
    if (a == null) return const SizedBox();
    final m = a.manifest;
    final values = _host.settingsOf(a.id);
    final err = _host.errorOf(a.id);
    return SettingsPage(
      title: m.name,
      subtitle: [if (m.author.isNotEmpty) m.author, 'Version ${m.version}'].join(' · '),
      icon: Icons.extension_rounded,
      rows: [
        if (a.enabled && err == null)
          for (final s in m.settings) SRow(s.title, value: _shown(s, values[s.key]), chevron: s.type == 'action' || s.type == 'choice', onTap: () => _edit(s, values[s.key])),
        if (err != null)
          SRow(
            'Not working',
            value: 'Show why',
            onTap: () => askChoice(context, title: '${m.name} does not start', message: err, choices: const ['OK']),
          ),
        SRow('Add-on', value: a.enabled ? 'On' : 'Off', chevron: false, onTap: () => _host.setEnabled(a.id, !a.enabled)),
        if (newer case final n?)
          SRow('Update', value: 'Version ${n.version}', onTap: () async {
            if (await installFromList(context, n) != null) {
              newer = null;
              _changed();
            }
          }),
        SRow(
          'Log',
          onTap: () {
            final log = _host.logOf(a.id);
            askChoice(
              context,
              title: '${m.name}: log',
              message: log.isEmpty ? 'Nothing yet.' : log.reversed.take(40).join('\n'),
              choices: const ['OK'],
            );
          },
        ),
        SRow(
          'Uninstall',
          chevron: false,
          onTap: () async {
            final i = await askChoice(
              context,
              title: 'Uninstall ${m.name}?',
              message: 'Its settings and saved data are removed too.',
              choices: const ['Cancel', 'Uninstall'],
            );
            if (i == 1) {
              await _host.uninstall(a.id);
              if (context.mounted) Navigator.of(context).pop();
            }
          },
        ),
      ],
    );
  }
}
