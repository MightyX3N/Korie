import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../android.dart';
import 'addons.dart';
import '../geo.dart';
import '../store.dart';
import '../ui/common.dart';
import 'home.dart';
import 'profiles.dart';
import 'setup.dart';

class SRow {
  const SRow(this.label, {this.value = '', this.onTap, this.chevron = true});
  final String label;
  final String value;
  final VoidCallback? onTap;
  final bool chevron;
}

/// Hume's settings layout: icon and title on the left, a list of rounded rows on the right; the
/// focused row turns white. Up/Down/OK and Back use Flutter's own focus and navigation.
class SettingsPage extends StatelessWidget {
  const SettingsPage({super.key, required this.title, required this.subtitle, required this.rows, this.icon = Icons.settings_rounded});
  final String title, subtitle;
  final List<SRow> rows;
  final IconData icon;

  @override
  Widget build(BuildContext context) => Material(
    color: const Color(0xFF0B0B10),
    child: LayoutBuilder(
      builder: (context, c) {
        final g = Geo(c.maxWidth, c.maxHeight);
        final listLeft = (g.w * 0.456).clamp(g.dp(260), g.w - g.dp(300));
        return Stack(
          children: [
            Positioned(
              left: 0,
              width: listLeft,
              top: 0,
              bottom: 0,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: g.dp(150),
                    height: g.dp(90),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(g.dp(12)),
                      gradient: const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF7A6BFF), Color(0xFF3F33C9)]),
                    ),
                    child: Icon(icon, size: g.dp(48), color: Colors.white),
                  ),
                  SizedBox(height: g.dp(30)),
                  Text(title, style: tx(g.dp(33), w: FontWeight.w800, spacing: -0.8)),
                  SizedBox(height: g.dp(6)),
                  Text(subtitle, style: tx(g.dp(13.5), opacity: 0.6)),
                ],
              ),
            ),
            Positioned(
              left: listLeft,
              right: g.dp(28),
              top: 0,
              bottom: 0,
              child: ListView(
                padding: EdgeInsets.symmetric(vertical: g.dp(60), horizontal: g.dp(8)),
                children: [
                  for (final (i, r) in rows.indexed)
                    Padding(
                      padding: EdgeInsets.only(bottom: g.dp(5)),
                      child: Focusable(
                        autofocus: i == 0,
                        onTap: r.onTap,
                        builder: (context, f) => AnimatedScale(
                          scale: f ? 1.02 : 1,
                          duration: const Duration(milliseconds: 120),
                          child: Container(
                            height: g.dp(40),
                            padding: EdgeInsets.symmetric(horizontal: g.dp(16)),
                            decoration: BoxDecoration(
                              color: f ? const Color(0xFFF2F2F2) : const Color(0xFF1E1E24),
                              borderRadius: BorderRadius.circular(g.dp(9)),
                            ),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Text(r.label, style: tx(g.dp(15), color: f ? const Color(0xFF111111) : Colors.white)),
                                ),
                                if (r.value.isNotEmpty) Text(r.value, style: tx(g.dp(15), opacity: 0.6, color: f ? const Color(0xFF111111) : Colors.white)),
                                if (r.chevron && r.onTap != null) ...[
                                  SizedBox(width: g.dp(10)),
                                  Icon(Icons.chevron_right_rounded, size: g.dp(18), color: (f ? const Color(0xFF111111) : Colors.white).withValues(alpha: 0.6)),
                                ],
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    ),
  );
}

/// Korie's settings.
class Settings extends StatefulWidget {
  const Settings({super.key, required this.store});
  final Store store;
  @override
  State<Settings> createState() => _SettingsState();
}

class _SettingsState extends State<Settings> {
  Store get store => widget.store;
  bool supported = false, granted = false;

  @override
  void initState() {
    super.initState();
    store.addListener(_refresh);
    _perm();
  }

  @override
  void dispose() {
    store.removeListener(_refresh);
    super.dispose();
  }

  void _refresh() {
    if (mounted) setState(() {});
  }

  Future<void> _perm() async {
    supported = await Android.listingsSupported();
    granted = await Android.listingsGranted();
    _refresh();
  }

  String get _shelfSummary {
    final on = [if (store.showContinue) 'Continue Watching', if (store.showAppRows) 'Your Apps'];
    return on.isEmpty ? 'Off' : on.join(' & ');
  }

  String get _addonSummary {
    final names = [for (final a in AddonHost.instance.installed.values) if (a.enabled) a.manifest.name]..sort();
    if (names.isEmpty) return 'None';
    return names.length <= 2 ? names.join(', ') : '${names.take(2).join(', ')} +${names.length - 2}';
  }

  void _push(Widget w) => Navigator.of(context).push(fadeRoute(w)).then((_) => _perm());

  @override
  Widget build(BuildContext context) => SettingsPage(
    title: 'Settings',
    subtitle: 'Korie',
    rows: [
      SRow(
        'Profiles',
        value: store.current.name,
        onTap: () => _push(Profiles(store: store)),
      ),
      // The apps' part of the carousel needs the TV's program guide; elsewhere only add-ons fill it.
      if (supported)
        SRow(
          'Top Shelf',
          value: _shelfSummary,
          onTap: () => _push(_TopShelf(store: store)),
        ),
      SRow(
        'Add-ons',
        value: _addonSummary,
        onTap: () => _push(const AddonsSettings()),
      ),
      if (supported)
        SRow(
          'Continue Watching',
          value: granted ? 'Allowed' : 'Needs permission',
          onTap: granted
              ? null
              : () async {
                  await Android.askListings();
                  _perm();
                },
        ),
      SRow(
        'Home',
        value: store.wallpaper,
        onTap: () => _push(_Wallpaper(store: store)),
      ),
      SRow('About', value: 'Version 2.0', onTap: () => _push(_About(store: store))),
      SRow('TV Settings', onTap: Android.tvSettings, chevron: false),
    ],
  );
}

class _TopShelf extends StatefulWidget {
  const _TopShelf({required this.store});
  final Store store;
  @override
  State<_TopShelf> createState() => _TopShelfState();
}

class _TopShelfState extends State<_TopShelf> {
  @override
  Widget build(BuildContext context) {
    final s = widget.store;
    return SettingsPage(
      title: 'Top Shelf',
      subtitle: 'What the carousel shows',
      icon: Icons.view_carousel_rounded,
      rows: [
        SRow('Continue Watching', value: s.showContinue ? 'On' : 'Off', chevron: false, onTap: () => setState(() => s.setShowContinue(!s.showContinue))),
        SRow('From Your Apps', value: s.showAppRows ? 'On' : 'Off', chevron: false, onTap: () => setState(() => s.setShowAppRows(!s.showAppRows))),
      ],
    );
  }
}

class _Wallpaper extends StatefulWidget {
  const _Wallpaper({required this.store});
  final Store store;
  @override
  State<_Wallpaper> createState() => _WallpaperState();
}

class _WallpaperState extends State<_Wallpaper> {
  @override
  Widget build(BuildContext context) {
    final s = widget.store;
    return SettingsPage(
      title: 'Home',
      subtitle: 'Background when nothing is playing',
      icon: Icons.wallpaper_rounded,
      rows: [for (final w in Store.wallpapers) SRow(w, value: s.wallpaper == w ? '✓' : '', chevron: false, onTap: () => setState(() => s.setWallpaper(w)))],
    );
  }
}

class _About extends StatelessWidget {
  const _About({required this.store});
  final Store store;
  @override
  Widget build(BuildContext context) => SettingsPage(
    title: 'About',
    subtitle: 'Korie 2.0',
    icon: Icons.info_outline_rounded,
    rows: [
      const SRow('Version', value: '2.0', chevron: false),
      const SRow('Licence', value: 'Public domain (Unlicense)', chevron: false),
      SRow('Set Up Korie Again', onTap: () => Navigator.of(context).push(fadeRoute(Setup(store: store, again: true)))),
      SRow(
        'Open-source licences',
        onTap: () => showLicensePage(context: context, applicationName: 'Korie', applicationVersion: '2.0'),
      ),
    ],
  );
}
