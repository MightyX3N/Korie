import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../geo.dart';
import 'common.dart';

class MenuItem {
  const MenuItem(this.label, this.action);
  final String label;
  final VoidCallback action;
}

/// Hume's options menu: a dark glass panel above the card with a small title and one row per
/// action; the focused row is a white pill. Up/Down/OK use Flutter's own focus; Back closes it.
Future<void> showOptions(BuildContext context, {required Geo geo, required Rect anchor, required String title, required List<MenuItem> items}) {
  return showGeneralDialog(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.black26,
    transitionDuration: const Duration(milliseconds: 140),
    pageBuilder: (context, _, _) {
      final g = geo;
      final w = g.dp(220);
      final rowH = g.dp(34);
      final h = g.dp(12) + g.dp(11) * 1.4 + g.dp(8) + rowH * items.length + g.dp(8);
      var left = anchor.left - g.dp(4);
      left = left.clamp(g.dockOuter, g.w - w - g.dockOuter);
      // Above the card when it fits, else below it; always fully on screen.
      final margin = g.dp(16);
      var top = anchor.top - h - g.dp(10);
      if (top < margin) top = anchor.bottom + g.dp(10);
      if (top + h > g.h - margin) top = g.h - margin - h;
      if (top < margin) top = margin;
      return Stack(
        children: [
          Positioned(
            left: left,
            top: top,
            width: w,
            child: Material(
              type: MaterialType.transparency,
              child: Container(
                padding: EdgeInsets.fromLTRB(g.dp(8), g.dp(12), g.dp(8), g.dp(8)),
                decoration: BoxDecoration(
                  color: const Color(0xEB1A1A20),
                  borderRadius: BorderRadius.circular(g.dp(20)),
                  border: Border.all(color: const Color(0x33FFFFFF)),
                  boxShadow: [BoxShadow(color: Colors.black54, blurRadius: g.dp(30), offset: Offset(0, g.dp(14)))],
                ),
                child: FreshPress(
                  child: FocusScope(
                    autofocus: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Padding(
                          padding: EdgeInsets.fromLTRB(g.dp(12), 0, g.dp(12), g.dp(8)),
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: tx(g.dp(11), w: FontWeight.w600, opacity: 0.55),
                          ),
                        ),
                        for (final (i, it) in items.indexed)
                          Focusable(
                            autofocus: i == 0,
                            onTap: () {
                              Navigator.of(context).pop();
                              it.action();
                            },
                            builder: (context, f) => Container(
                              height: rowH,
                              alignment: Alignment.centerLeft,
                              padding: EdgeInsets.symmetric(horizontal: g.dp(12)),
                              decoration: BoxDecoration(color: f ? Colors.white : Colors.transparent, borderRadius: BorderRadius.circular(g.dp(12))),
                              child: Text(it.label, style: tx(g.dp(14), color: f ? const Color(0xFF111114) : Colors.white)),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      );
    },
  );
}

/// The OK key that opened a menu is usually still held: a remote keeps sending it while held.
/// This ignores OK until it has been let go and pressed again, so holding OK on an app opens the
/// menu and nothing in it.
class FreshPress extends StatefulWidget {
  const FreshPress({super.key, required this.child});
  final Widget child;
  @override
  State<FreshPress> createState() => _FreshPressState();
}

class _FreshPressState extends State<FreshPress> {
  bool fresh = false;
  static final _ok = {LogicalKeyboardKey.select, LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter, LogicalKeyboardKey.gameButtonA};
  @override
  Widget build(BuildContext context) => Focus(
    canRequestFocus: false,
    skipTraversal: true,
    onKeyEvent: (n, e) {
      if (!_ok.contains(e.logicalKey)) return KeyEventResult.ignored;
      if (e is KeyDownEvent) {
        fresh = true;
        return KeyEventResult.ignored; // a new press: let the row act on it
      }
      if (e is KeyRepeatEvent) return KeyEventResult.handled; // never act on a held key
      if (!fresh) return KeyEventResult.handled; // the release of the press that opened us
      return KeyEventResult.ignored;
    },
    child: widget.child,
  );
}

/// Asks for a name. Returns null when cancelled.
Future<String?> askName(BuildContext context, Geo g, {required String title, String start = ''}) {
  final ctl = TextEditingController(text: start);
  return showGeneralDialog<String>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.black54,
    pageBuilder: (context, _, _) => Align(
      // High on the screen, so the TV's keyboard never covers Save.
      alignment: const Alignment(0, -0.75),
      child: FreshPress(
        child: Material(
          type: MaterialType.transparency,
          child: Container(
            width: g.dp(360),
            padding: EdgeInsets.all(g.dp(20)),
            decoration: BoxDecoration(
              color: const Color(0xF21A1A20),
              borderRadius: BorderRadius.circular(g.dp(20)),
              border: Border.all(color: const Color(0x33FFFFFF)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: tx(g.dp(18), w: FontWeight.w700)),
                SizedBox(height: g.dp(14)),
                // A text field keeps Up/Down for its cursor; on a remote they must move to the buttons.
                Shortcuts(
                  shortcuts: const {
                    SingleActivator(LogicalKeyboardKey.arrowDown): DirectionalFocusIntent(TraversalDirection.down, ignoreTextFields: false),
                    SingleActivator(LogicalKeyboardKey.arrowUp): DirectionalFocusIntent(TraversalDirection.up, ignoreTextFields: false),
                  },
                  child: TextField(
                    controller: ctl,
                    autofocus: true,
                    maxLength: 20,
                    style: tx(g.dp(15)),
                    cursorColor: Colors.white,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (v) => Navigator.of(context).pop(v),
                    decoration: InputDecoration(
                      hintText: 'Name',
                      hintStyle: tx(g.dp(15), opacity: 0.5),
                      counterStyle: tx(g.dp(10), opacity: 0.6),
                      filled: true,
                      fillColor: Colors.white.withValues(alpha: 0.1),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(g.dp(10)), borderSide: BorderSide.none),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(g.dp(10)),
                        borderSide: BorderSide(color: Colors.white, width: g.dp(1.5)),
                      ),
                    ),
                  ),
                ),
                SizedBox(height: g.dp(10)),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    _pill(g, 'Cancel', () => Navigator.of(context).pop()),
                    SizedBox(width: g.dp(10)),
                    _pill(g, 'Save', () => Navigator.of(context).pop(ctl.text)),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

Widget _pill(Geo g, String label, VoidCallback onTap) => Focusable(
  onTap: onTap,
  builder: (context, f) => Container(
    height: g.dp(32),
    padding: EdgeInsets.symmetric(horizontal: g.dp(18)),
    alignment: Alignment.center,
    decoration: BoxDecoration(color: f ? Colors.white : const Color(0x47FFFFFF), borderRadius: BorderRadius.circular(g.dp(16))),
    child: Text(
      label,
      style: tx(g.dp(13), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white),
    ),
  ),
);
