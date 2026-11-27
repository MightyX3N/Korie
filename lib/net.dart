import 'dart:io';
import 'dart:typed_data';

final _cache = <String, Uint8List?>{};

/// A picture (poster, backdrop) from the web, kept for the session. Null when it can't be had.
Future<Uint8List?> fetchBytes(String url) async {
  if (_cache.containsKey(url)) return _cache[url];
  final c = HttpClient()
    ..findProxy = HttpClient.findProxyFromEnvironment
    ..connectionTimeout = const Duration(seconds: 8);
  try {
    final rq = await c.getUrl(Uri.parse(url));
    final rs = await rq.close().timeout(const Duration(seconds: 15));
    if (rs.statusCode != 200) return _cache[url] = null;
    final b = BytesBuilder(copy: false);
    await for (final chunk in rs.timeout(const Duration(seconds: 20))) {
      b.add(chunk);
      if (b.length > 8 << 20) return _cache[url] = null;
    }
    return _cache[url] = b.takeBytes();
  } catch (_) {
    return null;
  } finally {
    c.close();
  }
}
