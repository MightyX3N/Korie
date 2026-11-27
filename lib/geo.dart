import 'dart:math' as math;

/// Home screen geometry. Sizes follow Hume's tvOS measurements (a 960 x 540 design grid):
/// dock 24 from the edges, 21 inside, 25 between apps, 5:3 cards, focus 1.2x, dock top at 73%.
///
/// Apps are sized from the screen height (as on a 16:9 screen of that height) and as many fit in a
/// row as the width allows: 6 on 16:9, 8 on 21:9, 4 on 4:3. The dock is the first row.
class Geo {
  // Before Android has given the window its size, the screen is 0 x 0: a stand-in size keeps the
  // sums finite for that first frame (0 x 0 made a division by zero and Korie stayed black).
  Geo(double width, double height)
    : w = width.isFinite && width >= 100 ? width : 960,
      h = height.isFinite && height >= 100 ? height : 540 {
    u = h / 540;
    dockOuter = 24 * u;
    dockInset = 21 * u;
    side = dockOuter + dockInset;
    gap = 25 * u;
    final base = (h * 16 / 9 - 2 * side - 5 * gap) / 6;
    cols = math.max(3, ((w - 2 * side + gap) / (base + gap)).round());
    tileW = (w - 2 * side - (cols - 1) * gap) / cols;
    tileH = tileW * 3 / 5;
    labelH = 30 * u;
    radius = tileW * 0.071;
    dockPadV = 20 * u;
    gapBelow = 20 * u;
    // The next row peeks below the dock by the same share of the screen as on a 16:9 TV.
    final peek = h - (h * 0.73 + base * 3 / 5 + 2 * dockPadV + gapBelow);
    dockTop = h - peek - gapBelow - (tileH + 2 * dockPadV);
  }

  final double w, h;
  late final double u, dockOuter, dockInset, side, gap, tileW, tileH, labelH, radius, dockPadV, gapBelow, dockTop;
  late final int cols;

  static const focus = 1.2;

  double get dockH => tileH + 2 * dockPadV;
  double get rowH => tileH + labelH + gap / 2;

  /// Top of a row's cards, with the page not scrolled.
  double rowTop(int row) => row == 0 ? dockTop + dockPadV : dockTop + dockH + gapBelow + (row - 1) * rowH;

  double colLeft(int col) => side + col * (tileW + gap);

  /// Where the page scrolls to when a row has the focus. Nothing is ever cut by the top edge:
  /// - the dock row: no scroll (the carousel is above it);
  /// - the first row below the dock: the whole dock stays visible, 17% from the top (Hume);
  /// - deeper rows: the row above sits just under the top edge and everything above it is
  ///   completely off screen.
  double scrollFor(int row) {
    if (row == 0) return 0;
    if (row == 1) return math.max(0, dockTop - h * 0.17);
    final above = rowTop(row - 1);
    final room = row == 2 ? gapBelow * 0.9 : labelH + gap / 2 - dp(2);
    return math.max(0, above - room);
  }

  double dp(double v) => v * u;
}
