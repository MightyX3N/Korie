import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import '../android.dart';
import '../geo.dart';
import 'common.dart';

/// What an app card shows.
class CardLook {
  const CardLook({required this.label, this.app, this.icon, this.colors, this.caption});
  final String label;
  final App? app;
  final IconData? icon; // Korie's own cards (Settings, More Apps, Korie TV)
  final List<Color>? colors;

  /// Written on the card under the icon (Korie TV, an add-on's tile without a picture): the
  /// dock shows no names under its cards.
  final String? caption;
}

/// One app card on Home or in More Apps.
///
/// Key handling here is limited to what Hume does with its own key code and Flutter has no
/// standard behaviour for: OK opens on release and holding OK (or Menu) opens the options;
/// while the card is being moved the arrows move it. Arrow keys otherwise go to Flutter's focus.
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.look,
    required this.geo,
    required this.onOpen,
    required this.onHold,
    this.focusNode,
    this.autofocus = false,
    this.showLabel = false,
    this.moving = false,
    this.onMove,
    this.onMoveDone,
    this.onFocused,
    this.firstInRow = false,
    this.lastInRow = false,
  });
  final CardLook look;
  final Geo geo;
  final VoidCallback onOpen;
  final VoidCallback onHold;
  final FocusNode? focusNode;
  final bool autofocus;
  final bool showLabel;
  final bool moving;
  final void Function(TraversalDirection)? onMove;
  final VoidCallback? onMoveDone;
  final VoidCallback? onFocused;

  /// Left on the first card of a row and Right on the last one do nothing (as in Hume), so the
  /// focus never jumps off the row to something far away.
  final bool firstInRow, lastInRow;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> with SingleTickerProviderStateMixin {
  bool focused = false, hover = false;
  bool pressed = false, held = false, pressedWhileMoving = false;
  late final AnimationController wiggle = AnimationController(vsync: this, duration: const Duration(milliseconds: 130));

  static final _ok = {LogicalKeyboardKey.select, LogicalKeyboardKey.enter, LogicalKeyboardKey.numpadEnter, LogicalKeyboardKey.gameButtonA};

  @override
  void didUpdateWidget(AppCard old) {
    super.didUpdateWidget(old);
    _syncWiggle();
  }

  @override
  void initState() {
    super.initState();
    _syncWiggle();
  }

  void _syncWiggle() {
    if (widget.moving && !wiggle.isAnimating) {
      pressedWhileMoving = false;
      wiggle.repeat(reverse: true);
    } else if (!widget.moving && wiggle.isAnimating) {
      wiggle.stop();
      wiggle.value = 0.5;
    }
  }

  @override
  void dispose() {
    wiggle.dispose();
    super.dispose();
  }

  KeyEventResult _key(FocusNode n, KeyEvent e) {
    final k = e.logicalKey;
    if (widget.moving) {
      final dir = switch (k) {
        LogicalKeyboardKey.arrowLeft => TraversalDirection.left,
        LogicalKeyboardKey.arrowRight => TraversalDirection.right,
        LogicalKeyboardKey.arrowUp => TraversalDirection.up,
        LogicalKeyboardKey.arrowDown => TraversalDirection.down,
        _ => null,
      };
      if (dir != null) {
        if (e is! KeyUpEvent) widget.onMove?.call(dir);
        return KeyEventResult.handled;
      }
      if (_ok.contains(k)) {
        // Only an OK pressed while moving ends it (the release of the OK that chose "Move"
        // in the menu arrives here too and must not end it straight away).
        if (e is KeyDownEvent) {
          pressedWhileMoving = true;
        } else if (e is KeyUpEvent && pressedWhileMoving) {
          pressedWhileMoving = false;
          widget.onMoveDone?.call();
        }
        return KeyEventResult.handled;
      }
      return KeyEventResult.ignored;
    }
    if ((k == LogicalKeyboardKey.arrowLeft && widget.firstInRow) || (k == LogicalKeyboardKey.arrowRight && widget.lastInRow)) {
      return KeyEventResult.handled;
    }
    if (_ok.contains(k)) {
      if (e is KeyDownEvent) {
        pressed = true;
        held = false;
        setState(() {});
      } else if (e is KeyRepeatEvent) {
        if (pressed && !held) {
          held = true;
          setState(() {});
          widget.onHold();
        }
      } else if (e is KeyUpEvent) {
        final open = pressed && !held;
        pressed = false;
        held = false;
        setState(() {});
        if (open) widget.onOpen();
      }
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.contextMenu && e is KeyDownEvent) {
      widget.onHold();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.geo;
    final lit = focused || hover;
    final scale = pressed && !held ? 1.12 : (lit ? Geo.focus : 1.0);
    final look = widget.look;
    Widget face;
    if (look.app?.banner != null) {
      face = Image.memory(look.app!.banner!, fit: BoxFit.cover, width: g.tileW, height: g.tileH, gaplessPlayback: true, filterQuality: FilterQuality.medium);
    } else if (look.app?.icon != null) {
      face = Container(
        color: Color(look.app!.color),
        alignment: Alignment.center,
        child: Image.memory(look.app!.icon!, width: g.tileH * 0.56, height: g.tileH * 0.56, gaplessPlayback: true, filterQuality: FilterQuality.medium),
      );
    } else {
      face = Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: look.colors ?? const [Color(0xFF3A3A3C), Color(0xFF2C2C2E)],
          ),
        ),
        alignment: Alignment.center,
        child: look.caption == null
            ? Icon(look.icon ?? Icons.apps_rounded, size: g.tileH * 0.5, color: Colors.white)
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(look.icon ?? Icons.apps_rounded, size: g.tileH * 0.36, color: Colors.white),
                  SizedBox(height: g.tileH * 0.05),
                  Text(look.caption!, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.tileH * 0.16, w: FontWeight.w800, spacing: -0.2)),
                ],
              ),
      );
    }
    final card = AnimatedScale(
      scale: scale,
      duration: const Duration(milliseconds: 150),
      curve: Curves.easeOut,
      child: AnimatedBuilder(
        animation: wiggle,
        builder: (context, child) => Transform.rotate(angle: widget.moving ? (wiggle.value - 0.5) * 3 * math.pi / 180 : 0, child: child),
        child: Container(
          width: g.tileW,
          height: g.tileH,
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(g.radius),
            color: const Color(0xFF1C1C1E),
            boxShadow: [
              lit
                  ? BoxShadow(color: Colors.black.withValues(alpha: 0.5), blurRadius: g.dp(18), offset: Offset(0, g.dp(10)))
                  : BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: g.dp(4), offset: Offset(0, g.dp(2))),
            ],
          ),
          child: face,
        ),
      ),
    );
    return Focus(
      focusNode: widget.focusNode,
      autofocus: widget.autofocus,
      onKeyEvent: _key,
      onFocusChange: (v) {
        setState(() => focused = v);
        if (v) widget.onFocused?.call();
      },
      child: MouseRegion(
        onEnter: (_) => setState(() => hover = true),
        onExit: (_) => setState(() => hover = false),
        child: GestureDetector(
          onTap: widget.onOpen,
          onLongPress: widget.onHold,
          onSecondaryTap: widget.onHold,
          child: Semantics(
            button: true,
            label: look.label,
            child: SizedBox(
              width: g.tileW,
              height: g.tileH + (widget.showLabel ? g.labelH : 0),
              child: Stack(
                clipBehavior: Clip.none,
                alignment: Alignment.topCenter,
                children: [
                  card,
                  if (widget.showLabel)
                    Positioned(
                      top: g.tileH * (1 + (Geo.focus - 1) / 2) + g.dp(6),
                      left: -g.gap / 2,
                      right: -g.gap / 2,
                      child: AnimatedOpacity(
                        opacity: lit ? 1 : 0,
                        duration: const Duration(milliseconds: 150),
                        child: Text(look.label, textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(g.dp(13), opacity: 0.92)),
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
}
