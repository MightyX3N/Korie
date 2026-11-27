import 'package:material_ui/material_ui.dart';

import '../android.dart';
import '../geo.dart';
import '../store.dart';
import '../ui/common.dart';
import '../ui/menu.dart';
import '../ui/tile.dart';

/// More Apps: the hidden apps, in the same grid as Home. Back returns.
class Folder extends StatefulWidget {
  const Folder({super.key, required this.store, required this.apps});
  final Store store;
  final List<App> apps;
  @override
  State<Folder> createState() => _FolderState();
}

class _FolderState extends State<Folder> {
  double scroll = 0;

  @override
  void initState() {
    super.initState();
    widget.store.addListener(_changed);
  }

  @override
  void dispose() {
    widget.store.removeListener(_changed);
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    if (widget.apps.where((a) => widget.store.hidden.contains(a.id)).isEmpty) {
      Navigator.of(context).maybePop();
    } else {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final hidden = widget.store.hidden;
    final list = widget.apps.where((a) => hidden.contains(a.id)).toList()..sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return Material(
      color: Colors.black,
      child: LayoutBuilder(
        builder: (context, c) {
          final g = Geo(c.maxWidth, c.maxHeight);
          final top0 = g.h * 0.28;
          final rowH = g.rowH;
          return Stack(
            children: [
              Positioned.fill(
                child: DecoratedBox(decoration: BoxDecoration(gradient: wallpaperGradient(widget.store.wallpaper))),
              ),
              AnimatedPositioned(
                duration: const Duration(milliseconds: 260),
                curve: Curves.easeOutCubic,
                left: 0,
                top: -scroll,
                width: g.w,
                height: g.h,
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned(
                      left: g.side,
                      top: g.dp(52),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('More Apps', style: tx(g.dp(30), w: FontWeight.w800, spacing: -0.5)),
                          SizedBox(height: g.dp(6)),
                          Text('Back to return   ·   Hold OK for options', style: tx(g.dp(12), opacity: 0.7)),
                        ],
                      ),
                    ),
                    for (final (i, a) in list.indexed)
                      Positioned(
                        key: ValueKey(a.id),
                        left: g.colLeft(i % g.cols),
                        top: top0 + (i ~/ g.cols) * rowH,
                        child: AppCard(
                          look: CardLook(label: a.label, app: a),
                          geo: g,
                          autofocus: i == 0,
                          showLabel: true,
                          firstInRow: i % g.cols == 0,
                          lastInRow: i % g.cols == g.cols - 1 || i == list.length - 1,
                          onFocused: () {
                            final row = i ~/ g.cols;
                            // The whole row above stays visible at 17% from the top, as on Home.
                            // The row above sits just under the top edge; nothing is cut off.
                            final target = row == 0 ? 0.0 : (top0 + (row - 1) * rowH - (g.labelH + g.gap / 2 - g.dp(2))).clamp(0.0, double.infinity);
                            if (target != scroll) setState(() => scroll = target);
                          },
                          onOpen: () => Android.launch(a.id),
                          onHold: () => showOptions(
                            context,
                            geo: g,
                            anchor: Rect.fromLTWH(g.colLeft(i % g.cols), top0 + (i ~/ g.cols) * rowH - scroll, g.tileW, g.tileH),
                            title: a.label,
                            items: [
                              MenuItem('Open', () => Android.launch(a.id)),
                              MenuItem('Show on Home Screen', () => widget.store.setHidden(a.id, false)),
                              MenuItem('App Info', () => Android.appInfo(a.id)),
                              if (!a.system) MenuItem('Uninstall', () => Android.uninstall(a.id)),
                            ],
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
}
