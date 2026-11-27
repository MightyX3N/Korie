import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../addons/korie_ui.dart';
import '../store.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import '../ui/menu.dart';
import 'home.dart' show fadeRoute;

const _bg = Color(0xFF0B0A10);

/// Picking a profile: its PIN if it has one, then a password for each add-on account that is not
/// signed in yet (a Jellyfin user, say). True when the profile may be used.
Future<bool> unlockProfile(BuildContext context, Store store, Profile p) async {
  if (p.pin != null) {
    final ok = await Navigator.of(context).push<bool>(fadeRoute(PinPad(profile: p, check: p.pin)));
    if (ok != true || !context.mounted) return false;
  }
  final host = AddonHost.instance;
  for (final e in p.links.entries.toList()) {
    final addon = host.installed[e.key];
    if (addon == null || !host.handles(e.key).contains('signin')) continue;
    final profile = KorieAddonUi.profileValue(p);
    if (await host.call(e.key, 'signedin', [profile, e.value]) == true) continue;
    if (!context.mounted) return false;
    final ok = await Navigator.of(context).push<bool>(
      fadeRoute(PasswordPage(profile: p, addonId: e.key, addonName: addon.manifest.name, user: e.value)),
    );
    if (ok != true) return false;
    if (!context.mounted) return false;
  }
  return true;
}

/// Four digits, asked when a profile with a PIN is picked, or chosen in Settings.
/// [check]: the PIN to match (pops true when it does). Without it, the page asks for a new PIN
/// twice and pops it.
class PinPad extends StatefulWidget {
  const PinPad({super.key, required this.profile, this.check});
  final Profile profile;
  final String? check;
  @override
  State<PinPad> createState() => _PinPadState();
}

class _PinPadState extends State<PinPad> {
  String typed = '';
  String? first;
  String? error;

  String get title {
    final n = widget.profile.name;
    if (widget.check != null) return 'Enter $n’s PIN';
    return first == null ? 'Choose a PIN for $n' : 'Enter It Again';
  }

  void key(String k) {
    setState(() {
      error = null;
      if (k == '<') {
        if (typed.isNotEmpty) typed = typed.substring(0, typed.length - 1);
        return;
      }
      if (typed.length < 4) typed += k;
    });
    if (typed.length == 4) Future<void>.delayed(const Duration(milliseconds: 120), done);
  }

  void done() {
    if (!mounted) return;
    final t = typed;
    if (widget.check != null) {
      if (t == widget.check) return Navigator.of(context).pop(true);
      setState(() {
        typed = '';
        error = 'Wrong PIN';
      });
      return;
    }
    if (first == null) {
      setState(() {
        first = t;
        typed = '';
      });
    } else if (first == t) {
      Navigator.of(context).pop(t);
    } else {
      setState(() {
        first = null;
        typed = '';
        error = 'The PINs were not the same. Try again.';
      });
    }
  }

  static final _digits = {
    for (var i = 0; i <= 9; i++) ...{
      LogicalKeyboardKey(LogicalKeyboardKey.digit0.keyId + i): '$i',
      LogicalKeyboardKey(LogicalKeyboardKey.numpad0.keyId + i): '$i',
    },
  };

  @override
  Widget build(BuildContext context) {
    final g = geoOf(context);
    double m(double px) => px * g.h / 720;
    Widget pad(String k, {bool autofocus = false}) => Padding(
      padding: EdgeInsets.all(m(6)),
      child: Focusable(
        autofocus: autofocus,
        onTap: () => key(k),
        builder: (context, f) => AnimatedScale(
          scale: f ? 1.08 : 1,
          duration: const Duration(milliseconds: 100),
          child: Container(
            width: m(74),
            height: m(58),
            alignment: Alignment.center,
            decoration: BoxDecoration(color: f ? const Color(0xFFF2F2F4) : const Color(0xFF2C2C30), borderRadius: BorderRadius.circular(m(12))),
            child: k == '<'
                ? Icon(Icons.backspace_outlined, size: m(22), color: f ? const Color(0xFF111114) : Colors.white)
                : Text(k, style: tx(m(24), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white)),
          ),
        ),
      ),
    );
    return Material(
      color: _bg,
      // The remote's number keys type the PIN too.
      child: Focus(
        canRequestFocus: false,
        skipTraversal: true,
        onKeyEvent: (n, e) {
          final d = _digits[e.logicalKey];
          if (d == null || e is! KeyDownEvent) return KeyEventResult.ignored;
          key(d);
          return KeyEventResult.handled;
        },
        child: Center(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Avatar(profile: widget.profile, size: m(96)),
                SizedBox(height: m(20)),
                Text(title, style: tx(m(28), w: FontWeight.w700)),
                SizedBox(height: m(16)),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (var i = 0; i < 4; i++)
                      Container(
                        width: m(16),
                        height: m(16),
                        margin: EdgeInsets.symmetric(horizontal: m(7)),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: i < typed.length ? Colors.white : Colors.transparent,
                          border: Border.all(color: Colors.white.withValues(alpha: i < typed.length ? 1 : 0.55), width: m(2)),
                        ),
                      ),
                  ],
                ),
                Container(height: m(26), alignment: Alignment.center, child: error == null ? null : Text(error!, style: tx(m(14), color: const Color(0xFFFF8A80)))),
                SizedBox(height: m(10)),
                FreshPress(
                  child: FocusScope(
                    autofocus: true,
                    child: Column(
                      children: [
                        for (final row in const [
                          ['1', '2', '3'],
                          ['4', '5', '6'],
                          ['7', '8', '9'],
                        ])
                          Row(mainAxisSize: MainAxisSize.min, children: [for (final k in row) pad(k, autofocus: k == '1')]),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [SizedBox(width: m(86)), pad('0'), pad('<')],
                        ),
                      ],
                    ),
                  ),
                ),
                SizedBox(height: m(14)),
                Text('Number keys on the remote work too', style: tx(m(13), opacity: 0.5)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A password for an add-on account (any characters), asked when the profile is picked and the
/// account is not signed in. Pops true when the add-on accepted it.
class PasswordPage extends StatefulWidget {
  const PasswordPage({super.key, required this.profile, required this.addonId, required this.addonName, required this.user});
  final Profile profile;
  final String addonId, addonName;
  final Map<String, Object?> user;
  @override
  State<PasswordPage> createState() => _PasswordPageState();
}

class _PasswordPageState extends State<PasswordPage> {
  final ctl = TextEditingController();
  bool hidden = true, busy = false;
  String? error;

  Future<void> signIn() async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    final r = await AddonHost.instance.call(
      widget.addonId,
      'signin',
      [KorieAddonUi.profileValue(widget.profile), widget.user, ctl.text],
      const Duration(seconds: 30),
    );
    if (!mounted) return;
    if (r == true) return Navigator.of(context).pop(true);
    setState(() {
      busy = false;
      error = r is String ? r : 'Wrong password, or the server did not answer.';
      ctl.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final g = geoOf(context);
    double m(double px) => px * g.h / 720;
    final user = '${widget.user['name'] ?? widget.profile.name}';
    final detail = widget.user['detail'];
    return Material(
      color: _bg,
      child: Align(
        // High, so the TV's keyboard below never covers it.
        alignment: const Alignment(0, -0.7),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Avatar(profile: widget.profile, size: m(84)),
              SizedBox(height: m(16)),
              Text('$user’s ${widget.addonName} Password', textAlign: TextAlign.center, style: tx(m(28), w: FontWeight.w700)),
              if (detail != null) ...[SizedBox(height: m(10)), Text('$detail', style: tx(m(15), opacity: 0.6))],
              SizedBox(height: m(20)),
              FreshPress(
                child: FocusScope(
                  autofocus: true,
                  child: Column(
                    children: [
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: m(420),
                            child: Shortcuts(
                              shortcuts: const {
                                SingleActivator(LogicalKeyboardKey.arrowDown): DirectionalFocusIntent(TraversalDirection.down, ignoreTextFields: false),
                                SingleActivator(LogicalKeyboardKey.arrowRight): DirectionalFocusIntent(TraversalDirection.right, ignoreTextFields: false),
                              },
                              child: TextField(
                                controller: ctl,
                                autofocus: true,
                                obscureText: hidden,
                                enabled: !busy,
                                keyboardType: TextInputType.visiblePassword,
                                autocorrect: false,
                                enableSuggestions: false,
                                style: tx(m(18)),
                                cursorColor: Colors.white,
                                textInputAction: TextInputAction.done,
                                onSubmitted: (_) => signIn(),
                                decoration: InputDecoration(
                                  hintText: 'Password',
                                  hintStyle: tx(m(18), opacity: 0.4),
                                  filled: true,
                                  fillColor: const Color(0xFF1E1E24),
                                  contentPadding: EdgeInsets.symmetric(horizontal: m(18), vertical: m(14)),
                                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(m(12)), borderSide: BorderSide.none),
                                  focusedBorder: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(m(12)),
                                    borderSide: BorderSide(color: Colors.white, width: m(2)),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          SizedBox(width: m(10)),
                          pill(g, hidden ? 'Show' : 'Hide', () => setState(() => hidden = !hidden)),
                        ],
                      ),
                      Container(height: m(26), alignment: Alignment.center, child: error == null ? null : Text(error!, style: tx(m(14), color: const Color(0xFFFF8A80)))),
                      SizedBox(height: m(8)),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          pill(g, 'Cancel', () => Navigator.of(context).pop(false)),
                          SizedBox(width: m(12)),
                          pill(g, busy ? 'Signing In…' : 'Sign In', signIn),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
