// Choose a City in setup: the real geocoding service.
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/places.dart';

void main() {
  test('finds Copenhagen', () async {
    final r = await searchCities('Copenhagen');
    // ignore: avoid_print
    print([for (final p in r.take(3)) '${p.name} · ${p.detail} (${p.lat.toStringAsFixed(2)}, ${p.lon.toStringAsFixed(2)})']);
    expect(r.first.name, 'Copenhagen');
    expect(r.first.detail, contains('Denmark'));
    expect(r.first.lat, closeTo(55.68, 0.1));
  });
}
