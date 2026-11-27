import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../geo.dart';
import 'common.dart';
import 'menu.dart';

/// Korie's own question dialogs, in the look of the options menu: dark glass, white focus.
/// They work with a remote (Up/Down/Left/Right/OK, Back cancels) and by touch.

Geo geoOf(BuildContext context) {
  final s = MediaQuery.sizeOf(context);
  return Geo(s.width, s.height);
}

Widget _panel(Geo g, {required double width, required Widget child}) => Material(
  type: MaterialType.transparency,
  child: Container(
    width: width,
    padding: EdgeInsets.all(g.dp(20)),
    decoration: BoxDecoration(
      color: const Color(0xFF1C1C22),
      borderRadius: BorderRadius.circular(g.dp(20)),
      border: Border.all(color: const Color(0x33FFFFFF)),
      boxShadow: [BoxShadow(color: Colors.black54, blurRadius: g.dp(30), offset: Offset(0, g.dp(14)))],
    ),
    child: child,
  ),
);

Widget pill(Geo g, String label, VoidCallback onTap, {bool autofocus = false}) => Focusable(
  autofocus: autofocus,
  onTap: onTap,
  builder: (context, f) => Container(
    height: g.dp(32),
    padding: EdgeInsets.symmetric(horizontal: g.dp(18)),
    decoration: BoxDecoration(color: f ? Colors.white : const Color(0x47FFFFFF), borderRadius: BorderRadius.circular(g.dp(16))),
    child: Center(widthFactor: 1, child: Text(label, style: tx(g.dp(13), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white))),
  ),
);

/// A question with answers. With a [message] and up to three [choices], the choices are buttons;
/// otherwise they are a list. Returns the chosen index, or null when cancelled.
Future<int?> askChoice(BuildContext context, {required String title, String? message, required List<String> choices, int? selected}) {
  final g = geoOf(context);
  final asButtons = message != null && choices.length <= 3;
  return showGeneralDialog<int>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.black87,
    pageBuilder: (context, _, _) => Center(
      child: FreshPress(
        child: FocusScope(
          autofocus: true,
          child: _panel(
            g,
            width: g.dp(asButtons ? 420 : 380),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: tx(g.dp(18), w: FontWeight.w700)),
                if (message != null) ...[
                  SizedBox(height: g.dp(10)),
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: g.h * 0.45),
                    child: SingleChildScrollView(child: Text(message, style: tx(g.dp(13.5), opacity: 0.8, height: 1.4))),
                  ),
                ],
                SizedBox(height: g.dp(16)),
                if (asButtons)
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: g.dp(10),
                    runSpacing: g.dp(8),
                    children: [
                      for (final (i, c) in choices.indexed) pill(g, c, () => Navigator.of(context).pop(i), autofocus: i == choices.length - 1),
                    ],
                  )
                else
                  ConstrainedBox(
                    constraints: BoxConstraints(maxHeight: g.h * 0.6),
                    child: ListView(
                      shrinkWrap: true,
                      padding: EdgeInsets.symmetric(vertical: g.dp(4)),
                      children: [
                        for (final (i, c) in choices.indexed)
                          Padding(
                            padding: EdgeInsets.only(bottom: g.dp(4)),
                            child: Focusable(
                              autofocus: (selected == null || selected < 0 || selected >= choices.length) ? i == 0 : i == selected,
                              onTap: () => Navigator.of(context).pop(i),
                              builder: (context, f) => Container(
                                height: g.dp(36),
                                padding: EdgeInsets.symmetric(horizontal: g.dp(14)),
                                alignment: Alignment.centerLeft,
                                decoration: BoxDecoration(
                                  color: f ? Colors.white : const Color(0x14FFFFFF),
                                  borderRadius: BorderRadius.circular(g.dp(10)),
                                ),
                                child: Row(
                                  children: [
                                    Expanded(
                                      child: Text(c, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(14), color: f ? const Color(0xFF111114) : Colors.white)),
                                    ),
                                    if (i == selected) Icon(Icons.check_rounded, size: g.dp(18), color: const Color(0xFF34C759)),
                                  ],
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

/// Asks for text. Returns null when cancelled. [password] hides what is typed (any characters,
/// not only digits). [digits] shows the number keyboard.
Future<String?> askText(
  BuildContext context, {
  required String title,
  String? message,
  String value = '',
  String hint = '',
  bool password = false,
  bool digits = false,
  int? maxLength,
  String done = 'Save',
}) {
  final g = geoOf(context);
  final ctl = TextEditingController(text: value);
  var hidden = password;
  return showGeneralDialog<String>(
    context: context,
    barrierDismissible: true,
    barrierLabel: 'Close',
    barrierColor: Colors.black87,
    pageBuilder: (context, _, _) => Align(
      // High on the screen, so the TV's keyboard never covers the buttons.
      alignment: const Alignment(0, -0.75),
      child: FreshPress(
        child: StatefulBuilder(
          builder: (context, setState) => _panel(
            g,
            width: g.dp(400),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: tx(g.dp(18), w: FontWeight.w700)),
                if (message != null) ...[
                  SizedBox(height: g.dp(8)),
                  Text(message, style: tx(g.dp(13), opacity: 0.75, height: 1.35)),
                ],
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
                    maxLength: maxLength,
                    obscureText: hidden,
                    keyboardType: digits ? TextInputType.number : (password ? TextInputType.visiblePassword : TextInputType.text),
                    inputFormatters: digits ? [FilteringTextInputFormatter.digitsOnly] : null,
                    autocorrect: !password,
                    enableSuggestions: !password,
                    style: tx(g.dp(15)),
                    cursorColor: Colors.white,
                    textInputAction: TextInputAction.done,
                    onSubmitted: (v) => Navigator.of(context).pop(v),
                    decoration: InputDecoration(
                      hintText: hint,
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
                  children: [
                    if (password) pill(g, hidden ? 'Show' : 'Hide', () => setState(() => hidden = !hidden)),
                    const Spacer(),
                    pill(g, 'Cancel', () => Navigator.of(context).pop()),
                    SizedBox(width: g.dp(10)),
                    pill(g, done, () => Navigator.of(context).pop(ctl.text)),
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

/// A short message at the bottom of the screen for a few seconds.
void showToast(OverlayState overlay, String text) {
  late OverlayEntry e;
  e = OverlayEntry(
    builder: (context) {
      final g = geoOf(context);
      return Positioned(
        left: 0,
        right: 0,
        bottom: g.dp(40),
        child: IgnorePointer(
          child: Center(
            child: Container(
              constraints: BoxConstraints(maxWidth: g.w * 0.6),
              padding: EdgeInsets.symmetric(horizontal: g.dp(18), vertical: g.dp(10)),
              decoration: BoxDecoration(color: const Color(0xEB1A1A20), borderRadius: BorderRadius.circular(g.dp(18)), border: Border.all(color: const Color(0x33FFFFFF))),
              child: Text(text, textAlign: TextAlign.center, style: tx(g.dp(14))),
            ),
          ),
        ),
      );
    },
  );
  overlay.insert(e);
  Future<void>.delayed(const Duration(seconds: 3), e.remove);
}
