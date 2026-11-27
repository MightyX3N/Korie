import 'dart:convert';
import 'dart:io';

/// A place for the weather, the map and local radio.
class Place {
  Place(this.name, this.detail, this.lat, this.lon);
  final String name, detail;
  final double lat, lon;
  Map<String, Object?> toJson(String mode) => {'mode': mode, 'name': name, 'detail': detail, 'lat': lat, 'lon': lon};
}

/// Finds cities by name with Open-Meteo's free geocoding (GeoNames data, CC BY 4.0).
Future<List<Place>> searchCities(String text, {String language = 'en'}) async {
  final q = text.trim();
  if (q.isEmpty) return const [];
  final c = HttpClient()..findProxy = HttpClient.findProxyFromEnvironment;
  try {
    final uri = Uri.https('geocoding-api.open-meteo.com', '/v1/search', {'name': q, 'count': '10', 'language': language, 'format': 'json'});
    final rq = await c.getUrl(uri).timeout(const Duration(seconds: 10));
    final rs = await rq.close().timeout(const Duration(seconds: 10));
    final j = jsonDecode(await rs.transform(utf8.decoder).join()) as Map;
    return [
      for (final r in (j['results'] as List? ?? const []))
        if (r is Map && r['latitude'] is num)
          Place(
            '${r['name']}',
            [r['admin1'], r['country']].whereType<String>().join(', '),
            (r['latitude'] as num).toDouble(),
            (r['longitude'] as num).toDouble(),
          ),
    ];
  } finally {
    c.close();
  }
}
