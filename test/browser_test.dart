// The browser's address box: addresses and searches.
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/browser/browser.dart';

void main() {
  test('what is typed becomes an address or a search', () {
    expect(addressFor('dr.dk/drtv'), 'https://dr.dk/drtv');
    expect(addressFor('http://10.0.2.2:8096/'), 'http://10.0.2.2:8096/');
    expect(addressFor('  wikipedia.org '), 'https://wikipedia.org');
    expect(addressFor('breaking bad'), 'https://www.google.com/search?q=breaking+bad');
    expect(addressFor('weather'), 'https://www.google.com/search?q=weather');
    expect(addressFor(''), '');
    expect(addressFor('10.0.2.2:8096/web/'), 'http://10.0.2.2:8096/web/');
    expect(addressFor('nas.local:8080'), 'http://nas.local:8080');
    expect(hostOf('https://www.dr.dk/drtv'), 'dr.dk');
  });
}
