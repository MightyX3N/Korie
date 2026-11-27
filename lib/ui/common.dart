import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../store.dart';

TextStyle tx(double size, {FontWeight w = FontWeight.w500, double opacity = 1, Color color = Colors.white, double? height, double spacing = 0}) => TextStyle(
  fontFamily: 'Inter',
  fontSize: size,
  fontWeight: w,
  color: color.withValues(alpha: opacity),
  height: height,
  letterSpacing: spacing,
  decoration: TextDecoration.none,
);

/// Home backgrounds (per profile), drawn as gradients: no image to load, nothing to blur each frame.
Gradient wallpaperGradient(String name) {
  switch (name) {
    case 'Midnight':
      return const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF1B2140), Color(0xFF0B0D1A), Color(0xFF05060C)]);
    case 'Sunset':
      return const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF8A3A22), Color(0xFF5A2440), Color(0xFF1C1420)]);
    case 'Ocean':
      return const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF0E4A6B), Color(0xFF0B2A44), Color(0xFF06121F)]);
    case 'Graphite':
      return const LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(0xFF3A3B40), Color(0xFF1E1F23), Color(0xFF111114)]);
    default: // Aurora
      return const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFF6B2E63), Color(0xFF3B2A5A), Color(0xFF1C1430)]);
  }
}

/// A tiny decoded copy of an image, drawn stretched: it looks like a strong blur but costs one
/// small texture (the trick Hume uses for its glass), so the dock never blurs live.
Future<ui.Image?> tinyImage(Uint8List? bytes) async {
  if (bytes == null) return null;
  try {
    final codec = await ui.instantiateImageCodec(bytes, targetWidth: 40);
    return (await codec.getNextFrame()).image;
  } catch (_) {
    return null;
  }
}

/// Frosted glass panel that shows a blurred copy of whatever is behind it (the artwork or the
/// background), aligned to where the panel is on screen.
class GlassPanel extends StatelessWidget {
  const GlassPanel({super.key, required this.rect, required this.screen, required this.radius, this.blurred, this.wallpaper});
  final Rect rect;
  final Size screen;
  final double radius;
  final ui.Image? blurred;
  final Gradient? wallpaper;

  @override
  Widget build(BuildContext context) {
    Widget behind;
    if (blurred != null) {
      behind = Positioned(
        left: -rect.left,
        top: -rect.top,
        width: screen.width,
        height: screen.height,
        // The same shading Home puts over the artwork, so the glass is as dark as what is
        // around it and does not stand out (Hume bakes it into the image under its glass too).
        child: Stack(
          fit: StackFit.expand,
          children: [
            RawImage(image: blurred, fit: BoxFit.cover, filterQuality: FilterQuality.medium),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [Color(0xCC000000), Color(0x66000000), Color(0x00000000)], stops: [0, 0.375, 0.75]),
              ),
            ),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Color(0x14000000), Color(0x40000000), Color(0xB3000000)],
                ),
              ),
            ),
          ],
        ),
      );
    } else {
      behind = Positioned(
        left: -rect.left,
        top: -rect.top,
        width: screen.width,
        height: screen.height,
        child: DecoratedBox(decoration: BoxDecoration(gradient: wallpaper)),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: Stack(
        clipBehavior: Clip.hardEdge,
        children: [
          behind,
          // Hume's dock: a faint white tint (0x0F) over the backdrop, and a faint rim.
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: const Color(0x0FFFFFFF),
                borderRadius: BorderRadius.circular(radius),
                border: Border.all(color: const Color(0x1FFFFFFF)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Clock in the status capsule.
class Clock extends StatefulWidget {
  const Clock({super.key, required this.style});
  final TextStyle style;
  @override
  State<Clock> createState() => _ClockState();
}

class _ClockState extends State<Clock> {
  late final Timer t;
  @override
  void initState() {
    super.initState();
    t = Timer.periodic(const Duration(seconds: 10), (_) => setState(() {}));
  }

  @override
  void dispose() {
    t.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final n = DateTime.now();
    String two(int v) => v.toString().padLeft(2, '0');
    return Text('${two(n.hour)}:${two(n.minute)}', style: widget.style);
  }
}

/// Profile picture: coloured circle with the first letter.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.profile, required this.size});
  final Profile profile;
  final double size;
  static const colors = [
    [0xFFF2A65A, 0xFFD9733A, 0xFF3A1E08],
    [0xFF6FB6FF, 0xFF2E6FE0, 0xFFFFFFFF],
    [0xFFC59BFF, 0xFF7A4FE0, 0xFFFFFFFF],
    [0xFF7EE0A8, 0xFF2FA866, 0xFF0C3A20],
    [0xFFFF8FA6, 0xFFD9365A, 0xFFFFFFFF],
    [0xFFFFE08A, 0xFFE0A82E, 0xFF3A2A06],
    [0xFF8FE3F0, 0xFF2BA3B8, 0xFF07323A],
    [0xFFD0D4DC, 0xFF8A92A3, 0xFF1A1F2B],
  ];
  @override
  Widget build(BuildContext context) {
    final c = colors[profile.color % colors.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [Color(c[0]), Color(c[1])]),
      ),
      child: Text(
        profile.name.isEmpty ? '?' : profile.name.characters.first.toUpperCase(),
        style: tx(size * 0.42, w: FontWeight.w800, color: Color(c[2])),
      ),
    );
  }
}

/// A focusable thing that uses Flutter's own focus: arrows move to it, OK/Enter presses it.
class Focusable extends StatefulWidget {
  const Focusable({super.key, required this.onTap, required this.builder, this.autofocus = false, this.focusNode, this.onFocus});
  final VoidCallback? onTap;
  final Widget Function(BuildContext, bool focused) builder;
  final bool autofocus;
  final FocusNode? focusNode;
  final ValueChanged<bool>? onFocus;
  @override
  State<Focusable> createState() => _FocusableState();
}

class _FocusableState extends State<Focusable> {
  bool f = false, hover = false;
  @override
  Widget build(BuildContext context) => InkWell(
    onTap: widget.onTap,
    autofocus: widget.autofocus,
    focusNode: widget.focusNode,
    onFocusChange: (v) {
      setState(() => f = v);
      widget.onFocus?.call(v);
    },
    onHover: (v) => setState(() => hover = v),
    focusColor: Colors.transparent,
    hoverColor: Colors.transparent,
    highlightColor: Colors.transparent,
    splashColor: Colors.transparent,
    child: widget.builder(context, f || hover),
  );
}

/// Like [Focusable], plus holding OK (or the Menu key) for options, as Hume's profiles and
/// carousel do. OK acts when it is released, so a hold never also opens the item.
class HoldFocusable extends StatefulWidget {
  const HoldFocusable({super.key, required this.onTap, required this.onHold, required this.builder, this.autofocus = false});
  final VoidCallback onTap;
  final VoidCallback? onHold;
  final Widget Function(BuildContext, bool focused) builder;
  final bool autofocus;
  @override
  State<HoldFocusable> createState() => _HoldFocusableState();
}

class _HoldFocusableState extends State<HoldFocusable> {
  bool f = false, pressed = false, held = false;
  static final _ok = {LogicalKeyboardKey.select, LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter, LogicalKeyboardKey.gameButtonA};

  KeyEventResult _key(FocusNode n, KeyEvent e) {
    if (_ok.contains(e.logicalKey)) {
      if (e is KeyDownEvent) {
        pressed = true;
        held = false;
      } else if (e is KeyRepeatEvent && pressed && !held && widget.onHold != null) {
        held = true;
        widget.onHold!();
      } else if (e is KeyUpEvent) {
        if (pressed && !held) widget.onTap();
        pressed = false;
      }
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.contextMenu && e is KeyDownEvent && widget.onHold != null) {
      widget.onHold!();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) => Focus(
    autofocus: widget.autofocus,
    onKeyEvent: _key,
    onFocusChange: (v) => setState(() => f = v),
    child: GestureDetector(onTap: widget.onTap, onLongPress: widget.onHold, onSecondaryTap: widget.onHold, child: widget.builder(context, f)),
  );
}
