import 'package:material_ui/material_ui.dart';

import '../geo.dart';
import '../addons/host.dart';
import '../store.dart';
import '../ui/ask.dart';
import 'signin.dart';
import '../ui/common.dart';
import '../ui/menu.dart';
import 'home.dart';

/// Who's Watching? Shown at start when there is more than one profile, and from the profile
/// picture on Home. Green check on the current profile; hold OK on one for Rename, Change Colour,
/// Delete.
class Profiles extends StatefulWidget {
  const Profiles({super.key, required this.store, this.atStart = false, this.overHome = false});
  final Store store;

  /// Korie is starting: a profile must be picked, then Home opens.
  final bool atStart;

  /// The TV woke while Korie was open: as at start, but Home is already underneath.
  final bool overHome;
  @override
  State<Profiles> createState() => _ProfilesState();
}

class _ProfilesState extends State<Profiles> {
  Store get store => widget.store;

  @override
  void initState() {
    super.initState();
    store.addListener(_changed);
  }

  @override
  void dispose() {
    store.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  Future<void> _pick(Profile p) async {
    if (widget.atStart || p.id != store.current.id) {
      if (!await unlockProfile(context, store, p) || !mounted) return;
    }
    store.choose(p);
    if (widget.atStart && !widget.overHome) {
      Navigator.of(context).pushReplacement(fadeRoute(Home(key: Home.homeKey, store: store)));
    } else {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !widget.atStart,
      child: Material(
        color: const Color(0xFF0B0B10),
        child: LayoutBuilder(
          builder: (context, c) {
            final g = Geo(c.maxWidth, c.maxHeight);
            final d = g.dp(120);
            Widget cell(String label, Widget face, VoidCallback onTap, {VoidCallback? onHold, bool current = false, bool autofocus = false}) => SizedBox(
              width: d + g.dp(30),
              child: HoldFocusable(
                autofocus: autofocus,
                onTap: onTap,
                onHold: onHold,
                builder: (context, f) => Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    AnimatedScale(
                      scale: f ? 1.12 : 1,
                      duration: const Duration(milliseconds: 150),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          Container(
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              boxShadow: f
                                  ? [BoxShadow(color: Colors.white, spreadRadius: g.dp(3)), BoxShadow(color: Colors.black54, blurRadius: g.dp(24))]
                                  : null,
                            ),
                            child: face,
                          ),
                          if (current)
                            Positioned(
                              right: g.dp(2),
                              bottom: g.dp(2),
                              child: Container(
                                width: g.dp(28),
                                height: g.dp(28),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: const Color(0xFF34C759),
                                  border: Border.all(color: const Color(0xFF1C1C1E), width: g.dp(2.5)),
                                ),
                                child: Icon(Icons.check_rounded, size: g.dp(17), color: Colors.white),
                              ),
                            ),
                        ],
                      ),
                    ),
                    SizedBox(height: g.dp(f ? 20 : 12)),
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: tx(g.dp(15), w: f ? FontWeight.w700 : FontWeight.w500, opacity: f ? 1 : 0.75),
                    ),
                  ],
                ),
              ),
            );
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(widget.atStart ? 'Who’s Watching?' : 'Switch Profile', style: tx(g.dp(30), w: FontWeight.w800, spacing: -0.6)),
                  SizedBox(height: g.dp(34)),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: g.dp(18),
                    runSpacing: g.dp(24),
                    children: [
                      for (final p in store.profiles)
                        KeyedSubtree(
                          key: ValueKey(p.id),
                          child: cell(
                            p.name,
                            Avatar(profile: p, size: d),
                            () => _pick(p),
                            current: p.id == store.current.id,
                            autofocus: p.id == store.current.id,
                            onHold: () => _profileMenu(p, g),
                          ),
                        ),
                      if (store.canAddProfile)
                        KeyedSubtree(
                          key: const ValueKey('add'),
                          child: cell(
                            'Add User',
                            Container(
                              width: d,
                              height: d,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: const Color(0x24FFFFFF),
                                border: Border.all(color: const Color(0x4DFFFFFF)),
                              ),
                              child: Icon(Icons.add_rounded, size: d * 0.45, color: Colors.white),
                            ),
                            () async {
                              final n = await askName(context, g, title: 'New Profile');
                              if (n != null) store.addProfile(n);
                            },
                          ),
                        ),
                    ],
                  ),
                  if (!widget.atStart) ...[SizedBox(height: g.dp(30)), Text('Hold OK on a profile to rename or delete it', style: tx(g.dp(12), opacity: 0.55))],
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<bool> _pinOk(Profile p) async =>
      p.pin == null || await Navigator.of(context).push<bool>(fadeRoute(PinPad(profile: p, check: p.pin))) == true;

  /// Which user of an add-on (a Jellyfin user, say) this profile is.
  Future<void> _link(Profile p, InstalledAddon a) async {
    final users = await AddonHost.instance.call(a.id, 'users');
    if (!mounted) return;
    final list = [for (final u in (users is List ? users : const [])) if (u is Map && u['name'] != null) u.cast<String, Object?>()];
    if (list.isEmpty) {
      await askChoice(context, title: a.manifest.name, message: '${a.manifest.name} gives no users. Set it up in Settings → Add-ons first.', choices: const ['OK']);
      return;
    }
    final i = await askChoice(
      context,
      title: '${p.name} in ${a.manifest.name}',
      choices: [for (final u in list) '${u['name']}', 'Nobody'],
      selected: list.indexWhere((u) => u['id'] == p.links[a.id]?['id']),
    );
    if (i == null) return;
    store.setLink(p, a.id, i < list.length ? list[i] : null);
  }

  void _profileMenu(Profile p, Geo g) {
    showOptions(
      context,
      geo: g,
      anchor: Rect.fromCenter(center: Offset(g.w / 2, g.h * 0.45), width: g.dp(200), height: g.dp(10)),
      title: p.name,
      items: [
        MenuItem('Rename', () async {
          final n = await askName(context, g, title: 'Rename', start: p.name);
          if (n != null) store.renameProfile(p, n);
        }),
        MenuItem('Change Colour', () => store.recolourProfile(p)),
        MenuItem(p.pin == null ? 'Set PIN' : 'Remove PIN', () async {
          if (p.pin == null) {
            final pin = await Navigator.of(context).push<String>(fadeRoute(PinPad(profile: p)));
            if (pin != null) store.setPin(p, pin);
          } else if (await _pinOk(p)) {
            store.setPin(p, null);
          }
        }),
        for (final a in AddonHost.instance.handlersOf('users'))
          MenuItem('${a.manifest.name}: ${p.links[a.id]?['name'] ?? 'not linked'}', () => _link(p, a)),
        if (store.profiles.length > 1)
          MenuItem('Delete', () async {
            if (await _pinOk(p)) store.deleteProfile(p);
          }),
      ],
    );
  }
}
