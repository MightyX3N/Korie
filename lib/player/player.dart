import 'dart:async';

import 'package:just_audio/just_audio.dart';
import 'package:material_ui/material_ui.dart';

import '../addons/host.dart';
import '../island.dart';
import '../ui/ask.dart';
import 'now_playing.dart';
import 'playlists.dart';
import 'video_screen.dart';

/// What an add-on asked to play (korie.play{...}).
class PlayRequest {
  PlayRequest(this.addon, this.raw);
  final String addon;
  final Map<String, Object?> raw;

  String get url => '${raw['url'] ?? ''}';
  String get title => '${raw['title'] ?? ''}';
  String get subtitle => '${raw['subtitle'] ?? ''}';
  String get image => '${raw['image'] ?? ''}';
  bool get audio => raw['audio'] == true;
  Object? get ref => raw['ref'];
  double get start => (raw['start'] as num?)?.toDouble() ?? 0;
  bool get autonext => raw['autonext'] == true;
  Map<String, Object?>? get next => raw['next'] is Map ? (raw['next'] as Map).cast<String, Object?>() : null;
  Map<String, String> get headers => {for (final e in ((raw['headers'] as Map?) ?? const {}).entries) '${e.key}': '${e.value}'};
  List<Map> get segments => [
    for (final s in (raw['segments'] as List? ?? const []))
      if (s is Map) s,
  ];

  /// [{label, lang, url, default}]: subtitles as files (WebVTT or SubRip) the player fetches.
  /// Text subtitles carry a `url` (the player shows them); picture ones (PGS, VobSub) only an `id`:
  /// the add-on has them drawn into the picture when chosen. `selected`: the one drawn in now.
  List<Map> get subtitles => [
    for (final s in (raw['subtitles'] as List? ?? const []))
      if (s is Map && (s['url'] is String || s['id'] != null)) s,
  ];

  /// The add-on's own list of sound tracks ({id, label, lang, selected, player}): all of them, also
  /// when the stream it sent carries only one. `player`: where the track is in the stream itself,
  /// when the player can switch to it there; otherwise the add-on is asked to send that track.
  List<Map> get audios => [
    for (final a in (raw['audios'] as List? ?? const []))
      if (a is Map && a['id'] != null) a,
  ];
}

/// Korie's own player: video full screen, sound in the background (the island shows it). Reports
/// to the add-on that asked ("playback": playing every 10 s, paused, stopped, ended).
class KoriePlayer {
  KoriePlayer._();
  static final instance = KoriePlayer._();

  GlobalKey<NavigatorState>? navigator;

  /// What Korie asked an add-on to play last (a film or an episode chosen in Korie TV): the
  /// player's Playlist button adds it, and its picture shows on Now Playing.
  PlayEntry? chosen;
  DateTime? _chosenAt;

  /// What the person picked to play. Picked outside a playlist, the playlist that was playing ends.
  void choose(PlayEntry e, {bool queued = false}) {
    if (!queued) PlayQueue.instance.clear();
    chosen = e;
    _chosenAt = DateTime.now();
  }

  /// [chosen], when it is what [addon] is playing now (chosen in the last minute).
  PlayEntry? entryFor(String addon) {
    final c = chosen, at = _chosenAt;
    if (c == null || at == null || c.addon != addon || DateTime.now().difference(at) > const Duration(minutes: 1)) return null;
    return c;
  }

  static void report(String addon, Object? ref, String state, double position, double duration) {
    AddonHost.instance.call(addon, 'playback', [
      ref,
      {'state': state, 'position': position.roundToDouble(), 'duration': duration.roundToDouble()},
    ]);
  }

  VideoScreenState? video; // the video player on screen, if any

  Future<List<Object?>> play(String addon, Map<String, Object?> raw) async {
    final r = PlayRequest(addon, raw);
    debugPrint('korie: play ${r.audio ? 'sound' : 'video'} from $addon: ${r.title}');
    if (r.url.isEmpty) return const [null, 'no url'];
    if (r.audio) {
      final v = video;
      if (v != null && v.mounted) v.close();
      return audio.play(r, entryFor(addon));
    }
    await audio.stop(keepQueue: true); // a video stops the music
    final v = video;
    if (v != null && v.mounted) {
      unawaited(v.replace(r)); // the add-on's call returns at once; the screen opens it
      return const [true];
    }
    final nav = navigator?.currentState;
    if (nav == null) return const [null, 'no screen'];
    nav.push(
      PageRouteBuilder(
        pageBuilder: (_, _, _) => VideoScreen(request: r),
        transitionDuration: Duration.zero,
        reverseTransitionDuration: Duration.zero,
      ),
    );
    return const [true];
  }

  Future<List<Object?>> stop() async {
    await audio.stop();
    return const [true];
  }

  final audio = AudioPlayback._();
}

/// Sound in the background (radio, music): never takes the screen; the island shows it (OK opens
/// Now Playing, the button beside it pauses, holding OK stops).
class AudioPlayback extends ChangeNotifier {
  AudioPlayback._();

  AudioPlayer? _p;
  PlayRequest? now;
  PlayEntry? entry;
  bool playing = false;
  bool buffering = false;
  Timer? _tick;
  StreamSubscription? _sub;

  Future<List<Object?>> play(PlayRequest r, PlayEntry? e) async {
    await stop(keepQueue: true);
    now = r;
    entry = e;
    final p = AudioPlayer();
    _p = p;
    _sub = p.playerStateStream.listen((s) {
      final was = playing;
      playing = s.playing && s.processingState != ProcessingState.completed;
      buffering = s.processingState == ProcessingState.loading || s.processingState == ProcessingState.buffering;
      if (s.processingState == ProcessingState.completed) {
        _report('ended');
        // A playlist goes on with the next; otherwise it is done.
        stop(report: false, keepQueue: true).then((_) => PlayQueue.instance.next());
        return;
      }
      if (was != playing) _report(playing ? 'playing' : 'paused');
      _show();
    }, onError: (Object err, StackTrace _) => _failed(r, p, err));
    try {
      // Headers only when there are some: just_audio sends the sound through a local proxy then.
      await p.setAudioSource(AudioSource.uri(Uri.parse(r.url), headers: r.headers.isEmpty ? null : r.headers));
      if (r.start > 0) await p.seek(Duration(milliseconds: (r.start * 1000).round()));
      p.play();
    } catch (err) {
      final o = KoriePlayer.instance.navigator?.currentState?.overlay;
      await stop(report: false, keepQueue: true);
      if (o != null) showToast(o, 'Could not play ${r.title.isEmpty ? 'this' : r.title}');
      return [null, '$err'];
    }
    _tick = Timer.periodic(const Duration(seconds: 10), (_) {
      if (playing) _report('playing');
    });
    _show();
    return const [true];
  }

  /// The stream broke while playing (the station went away, the network dropped): say so,
  /// and a playlist goes on with the next.
  Future<void> _failed(PlayRequest r, AudioPlayer p, Object err) async {
    if (_p != p) return;
    debugPrint('korie: sound stopped: $err');
    final o = KoriePlayer.instance.navigator?.currentState?.overlay;
    await stop(keepQueue: true);
    if (o != null && o.mounted) showToast(o, '${r.title.isEmpty ? 'This' : r.title} stopped playing');
    await PlayQueue.instance.next(); // the next in a playlist; at the end (or none) it is done
  }

  double get position => (_p?.position.inMilliseconds ?? 0) / 1000;
  double get duration => (_p?.duration?.inMilliseconds ?? 0) / 1000;

  void _report(String state) {
    final r = now;
    if (r != null) KoriePlayer.report(r.addon, r.ref, state, position, duration);
  }

  Future<void> toggle() async {
    final p = _p;
    if (p == null) return;
    if (p.playing) {
      await p.pause();
    } else {
      await p.play();
    }
  }

  /// Stopped by the person (Stop, holding OK on the island): a playlist playing ends too.
  Future<void> stop({bool report = true, bool keepQueue = false}) async {
    if (!keepQueue) PlayQueue.instance.clear();
    final p = _p;
    if (p == null) return;
    if (report) _report('stopped');
    _p = null;
    _tick?.cancel();
    await _sub?.cancel();
    await p.dispose();
    now = null;
    entry = null;
    playing = false;
    _show();
  }

  void _show() {
    final r = now;
    Island.instance.set('player', [
      if (r != null)
        IslandItem(
          key: 'player',
          title: r.title.isEmpty ? 'Playing' : r.title,
          sub: buffering ? 'Loading…' : (r.subtitle.isNotEmpty ? r.subtitle : (AddonHost.instance.installed[r.addon]?.manifest.name ?? '')),
          image: r.image.isNotEmpty ? r.image : (entry?.image.isNotEmpty == true ? entry!.image : null),
          playing: playing,
          rank: 30,
          onOk: () async => openNowPlaying(),
          onToggle: toggle,
          onHold: () => stop(),
        ),
    ]);
    notifyListeners();
  }

  void openNowPlaying() {
    final nav = KoriePlayer.instance.navigator?.currentState;
    if (nav == null || now == null) return;
    nav.push(PageRouteBuilder(pageBuilder: (_, _, _) => const NowPlaying(), transitionDuration: Duration.zero, reverseTransitionDuration: Duration.zero));
  }
}
