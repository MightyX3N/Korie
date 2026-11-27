import 'package:material_ui/material_ui.dart';

import '../ui/common.dart';
import '../ui/menu.dart';

/// One row of a setup page.
class SetupRow {
  const SetupRow(this.id, this.title, {this.sub, this.value, this.check = false, this.leading, this.chips = const [], this.enabled = true});
  final String id, title;
  final String? sub, value;
  final bool check, enabled;
  final Widget? leading;
  final List<({String label, Color color})> chips;

  /// A row an add-on described: {id, title, sub, value, check}.
  static SetupRow fromAddon(Map m) => SetupRow(
    '${m['id'] ?? m['title']}',
    '${m['title'] ?? ''}',
    sub: m['sub'] == null ? null : '${m['sub']}',
    value: m['value'] == null ? null : '${m['value']}',
    check: m['check'] == true,
  );
}

/// The look of every setup page (Korie's own and those add-ons add): a big title, a line under
/// it, rounded rows in the middle (the focused one white), and the page dots at the bottom.
/// Remote: Up/Down/OK with Flutter's own focus; Back goes back a page.
class SetupPage extends StatelessWidget {
  const SetupPage({
    super.key,
    required this.title,
    this.message,
    required this.rows,
    required this.onChoose,
    this.onBack,
    this.dot,
    this.dots = 8,
    this.background,
    this.busy = false,
    this.focusId,
    this.onFocusRow,
    this.titleWidget,
  });

  final String title;
  final String? message;
  final List<SetupRow> rows;
  final ValueChanged<String> onChoose;
  final VoidCallback? onBack;
  final int? dot;
  final int dots;
  final Gradient? background;
  final bool busy;
  final String? focusId;
  final ValueChanged<String>? onFocusRow;
  final Widget? titleWidget;

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    onPopInvokedWithResult: (didPop, _) {
      if (!didPop) onBack?.call();
    },
    child: Material(
      color: Colors.black,
      child: LayoutBuilder(
        builder: (context, c) {
          // Sizes are those of the mockups at 1280×720, scaled to the screen's height.
          double m(double px) => px * c.maxHeight / 720;
          final width = (m(600)).clamp(0.0, c.maxWidth - m(48));
          final autofocusId = focusId ?? rows.where((r) => r.enabled).firstOrNull?.id;
          return Stack(
            children: [
              Positioned.fill(
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 400),
                  decoration: BoxDecoration(color: Colors.black, gradient: background),
                ),
              ),
              Positioned.fill(
                bottom: m(60),
                child: Center(
                  child: SingleChildScrollView(
                    padding: EdgeInsets.symmetric(vertical: m(40), horizontal: m(24)),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        titleWidget ??
                            Text(title, textAlign: TextAlign.center, style: tx(m(42), w: FontWeight.w800, spacing: -0.8)),
                        if (message != null) ...[
                          SizedBox(height: m(10)),
                          ConstrainedBox(
                            constraints: BoxConstraints(maxWidth: m(640)),
                            child: Text(message!, textAlign: TextAlign.center, style: tx(m(17), opacity: 0.65, height: 1.4)),
                          ),
                        ],
                        SizedBox(height: m(28)),
                        FreshPress(
                          child: FocusScope(
                            autofocus: true,
                            child: AnimatedOpacity(
                              opacity: busy ? 0.4 : 1,
                              duration: const Duration(milliseconds: 150),
                              // While an add-on works the rows stay focusable (see onTap below): taking the
                              // focus away would move it here, out of a question shown on top.
                              child: IgnorePointer(
                                ignoring: busy,
                                child: Column(
                                  children: [
                                    for (final r in rows)
                                      Padding(
                                        padding: EdgeInsets.only(bottom: m(8)),
                                        child: _Row(row: r, width: width, m: m, autofocus: r.id == autofocusId, onTap: !r.enabled ? null : () {
                                          if (!busy) onChoose(r.id);
                                        }, onFocus: onFocusRow),
                                      ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        SizedBox(height: m(20), child: busy ? Text('Working…', style: tx(m(14), opacity: 0.6)) : null),
                      ],
                    ),
                  ),
                ),
              ),
              if (dot != null)
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: m(30),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      for (var i = 0; i < dots; i++)
                        Container(
                          width: m(6),
                          height: m(6),
                          margin: EdgeInsets.symmetric(horizontal: m(3)),
                          decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white.withValues(alpha: i == dot ? 1 : 0.3)),
                        ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    ),
  );
}

class _Row extends StatelessWidget {
  const _Row({required this.row, required this.width, required this.m, required this.autofocus, required this.onTap, this.onFocus});
  final SetupRow row;
  final double width;
  final double Function(double) m;
  final bool autofocus;
  final VoidCallback? onTap;
  final ValueChanged<String>? onFocus;

  @override
  Widget build(BuildContext context) {
    final r = row;
    return Focusable(
      autofocus: autofocus,
      onTap: onTap,
      onFocus: (v) {
        if (v) onFocus?.call(r.id);
      },
      builder: (context, f) {
        final fg = f ? const Color(0xFF111114) : Colors.white;
        return AnimatedScale(
          scale: f ? 1.03 : 1,
          duration: const Duration(milliseconds: 120),
          child: Container(
            width: width,
            constraints: BoxConstraints(minHeight: m(r.sub == null && r.chips.isEmpty ? 48 : 58)),
            padding: EdgeInsets.symmetric(horizontal: m(18), vertical: m(10)),
            decoration: BoxDecoration(
              color: f ? const Color(0xFFF2F2F4) : const Color(0xFF2C2C30),
              borderRadius: BorderRadius.circular(m(12)),
              boxShadow: f ? [BoxShadow(color: Colors.black45, blurRadius: m(26), offset: Offset(0, m(10)))] : null,
            ),
            child: Opacity(
              opacity: r.enabled ? 1 : 0.45,
              child: Row(
                children: [
                  if (r.leading != null) ...[r.leading!, SizedBox(width: m(14))],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Row(
                          children: [
                            Flexible(child: Text(r.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: tx(m(17), w: FontWeight.w600, color: fg))),
                            for (final c in r.chips) ...[SizedBox(width: m(8)), _chip(c, f)],
                          ],
                        ),
                        if (r.sub != null) ...[
                          SizedBox(height: m(3)),
                          Text(r.sub!, maxLines: 2, overflow: TextOverflow.ellipsis, style: tx(m(14), color: fg, opacity: 0.6)),
                        ],
                      ],
                    ),
                  ),
                  if (r.value != null && r.value!.isNotEmpty) ...[SizedBox(width: m(12)), Text(r.value!, style: tx(m(15), color: fg, opacity: 0.65))],
                  if (r.check) ...[SizedBox(width: m(12)), Icon(Icons.check_rounded, size: m(20), color: f ? const Color(0xFF1E9E4A) : const Color(0xFF34C759))],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _chip(({String label, Color color}) c, bool f) => Container(
    padding: EdgeInsets.symmetric(horizontal: m(10), vertical: m(4)),
    decoration: BoxDecoration(color: (f ? Colors.black : Colors.white).withValues(alpha: 0.08), borderRadius: BorderRadius.circular(m(12))),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(width: m(9), height: m(9), decoration: BoxDecoration(color: c.color, borderRadius: BorderRadius.circular(m(2)))),
        SizedBox(width: m(6)),
        Text(c.label, style: tx(m(14), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white)),
      ],
    ),
  );
}
