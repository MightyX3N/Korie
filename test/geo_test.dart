import 'package:flutter_test/flutter_test.dart';
import 'package:korie/geo.dart';

void main() {
  test('a 0 x 0 window (before Android sizes it) gives finite sizes', () {
    final g = Geo(0, 0);
    expect(g.cols, greaterThanOrEqualTo(3));
    expect(g.tileW.isFinite && g.dockTop.isFinite, true);
  });
  test('16:9 has 6 apps per row, 21:9 more', () {
    expect(Geo(1920, 1080).cols, 6);
    expect(Geo(2560, 1080).cols, greaterThan(6));
  });
}
