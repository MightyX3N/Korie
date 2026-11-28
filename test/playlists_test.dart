import 'package:flutter_test/flutter_test.dart';
import 'package:korie/player/player.dart';
import 'package:korie/player/playlists.dart';
import 'package:korie/store.dart';
import 'package:shared_preferences/shared_preferences.dart';

PlayEntry film(String id, [String addon = 'jellyfin']) => PlayEntry(addon: addon, data: {'id': id}, title: 'Film $id');

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('playlists: per profile, no doubles, move, take out, kept after a restart', () async {
    SharedPreferences.setMockInitialValues({});
    final store = await Store.open();
    final pl = Playlists.instance..store = store;
    final anna = store.current;
    final mo = pl.create('Morning');
    expect(pl.add(mo, film('a')), isTrue);
    expect(pl.add(mo, film('b')), isTrue);
    expect(pl.add(mo, film('a')), isFalse, reason: 'already in it');
    expect(pl.add(mo, film('a', 'radio')), isTrue, reason: 'another add-on: another item');
    pl.move(mo, 0, 1);
    expect(mo.items.map((e) => e.key), ['jellyfin:b', 'jellyfin:a', 'radio:a']);
    pl.move(mo, 2, 1);
    expect(mo.items.last.key, 'radio:a', reason: 'the last stays last');
    pl.remove(mo, 2);
    pl.rename(mo, 'Mornings');

    // Another profile has its own (none yet).
    final ben = store.addProfile('Ben')!;
    store.choose(ben);
    expect(pl.lists, isEmpty);
    pl.create('Ben\'s');
    store.choose(anna);
    expect(pl.lists.map((p) => p.name), ['Mornings']);

    // A restart reads them back.
    final again = await Store.open();
    pl.store = again;
    again.choose(again.profiles.firstWhere((p) => p.id == anna.id));
    final back = pl.lists.single;
    expect(back.name, 'Mornings');
    expect(back.items.map((e) => e.title), ['Film b', 'Film a']);
    pl.delete(back);
    expect(pl.lists, isEmpty);
  });

  test('the play queue goes in order, ends at the end, and ends when something else is picked', () async {
    final q = PlayQueue.instance;
    final p = Playlist(id: '1', name: 'x', items: [film('a'), film('b'), film('c')]);
    await q.start(p, from: 1);
    expect(q.current?.key, 'jellyfin:b');
    expect(q.following?.key, 'jellyfin:c');
    expect(KoriePlayer.instance.entryFor('jellyfin')?.key, 'jellyfin:b', reason: 'the player knows what plays');
    expect(await q.next(), isTrue);
    expect(q.current?.key, 'jellyfin:c');
    expect(q.following, isNull);
    expect(await q.next(), isFalse);
    expect(q.active, isFalse);

    await q.start(p);
    expect(q.active, isTrue);
    KoriePlayer.instance.choose(film('z')); // picked in Korie TV, not from the playlist
    expect(q.active, isFalse);

    await q.start(p, shuffle: true);
    expect(q.items.map((e) => e.key).toSet(), {'jellyfin:a', 'jellyfin:b', 'jellyfin:c'});
    expect(q.index, 0);
    q.clear();
  });
}
