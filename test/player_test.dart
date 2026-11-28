import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:korie/player/player.dart';
import 'package:korie/player/video_screen.dart';
import 'package:material_ui/material_ui.dart';
import 'package:video_player_platform_interface/video_player_platform_interface.dart';

/// A video "device": 30 s long, plays as the clock (fake time) runs.
class FakeVideo extends VideoPlayerPlatform {
  final events = StreamController<VideoEvent>.broadcast();
  bool playing = false;
  Completer<void>? tracksLater; // set: the audio tracks are known only when it completes
  Duration pos = Duration.zero;
  final seeks = <Duration>[];
  int pauses = 0;

  @override
  Future<void> init() async {}
  @override
  Future<int?> createWithOptions(VideoCreationOptions options) async {
    return 1;
  }

  @override
  Stream<VideoEvent> videoEventsFor(int playerId) {
    // Ready once the player listens.
    Timer(const Duration(milliseconds: 5), () => events.add(VideoEvent(eventType: VideoEventType.initialized, duration: const Duration(seconds: 30), size: const Size(640, 360))));
    return events.stream;
  }
  @override
  Future<void> dispose(int playerId) async {}
  @override
  Future<void> setLooping(int playerId, bool looping) async {}
  @override
  Future<void> play(int playerId) async {
    playing = true;
    events.add(VideoEvent(eventType: VideoEventType.isPlayingStateUpdate, isPlaying: true));
  }

  @override
  Future<void> pause(int playerId) async {
    playing = false;
    pauses++;
    events.add(VideoEvent(eventType: VideoEventType.isPlayingStateUpdate, isPlaying: false));
  }

  @override
  Future<void> setVolume(int playerId, double volume) async {}
  @override
  Future<void> setPlaybackSpeed(int playerId, double speed) async {}
  @override
  Future<void> seekTo(int playerId, Duration position) async {
    seeks.add(position);
    pos = position;
  }

  @override
  Future<Duration> getPosition(int playerId) async => pos;
  @override
  Widget buildViewWithOptions(VideoViewOptions options) => const SizedBox.expand();
  @override
  Future<void> setMixWithOthers(bool mixWithOthers) async {}
  String? selected;
  @override
  Future<void> selectAudioTrack(int playerId, String trackId) async => selected = trackId;
  @override
  Future<List<VideoAudioTrack>> getAudioTracks(int playerId) async {
    await tracksLater?.future;
    return tracks;
  }

  List<VideoAudioTrack> tracks = const [
    VideoAudioTrack(id: 'a', label: 'English', language: 'en', isSelected: true),
    VideoAudioTrack(id: 'b', label: 'Dansk', language: 'da', isSelected: false),
  ];
  @override
  bool isAudioTrackSupportAvailable() => true;
}

Future<void> key(WidgetTester t, LogicalKeyboardKey k) async {
  await t.sendKeyEvent(k);
  await t.pump(const Duration(milliseconds: 50));
  await t.pump(const Duration(milliseconds: 50));
}

void main() {
  late FakeVideo video;
  setUp(() {
    video = FakeVideo();
    VideoPlayerPlatform.instance = video;
  });

  Future<VideoScreenState> open(WidgetTester t, {Map<String, Object?> more = const {}}) async {
    t.view.physicalSize = const Size(1920, 1080);
    t.view.devicePixelRatio = 1;
    addTearDown(t.view.reset);
    await t.pumpWidget(
      MaterialApp(
        home: VideoScreen(
          request: PlayRequest('test', {
            'url': 'http://localhost/v.mp4',
            'title': 'Dune',
            'segments': [
              {'type': 'intro', 'start': 2, 'end': 7},
            ],
            ...more,
          }),
        ),
      ),
    );
    for (var i = 0; i < 5; i++) {
      await t.pump(const Duration(milliseconds: 100));
    }
    return t.state<VideoScreenState>(find.byType(VideoScreen));
  }

  testWidgets('the remote in the player: controls hide, Down focuses play, arrows move along the buttons', (t) async {
    final s = await open(t);
    expect(video.playing, isTrue);
    expect(s.controls, isTrue, reason: 'shown at the start');
    await t.pump(const Duration(seconds: 6));
    expect(s.controls, isFalse, reason: 'hidden after a few seconds of playing');
    expect(s.root.hasPrimaryFocus, isTrue);

    await key(t, LogicalKeyboardKey.arrowDown);
    expect(s.controls, isTrue);
    expect(s.playNode.hasPrimaryFocus, isTrue, reason: 'Down shows the buttons with play focused');

    final before = video.seeks.length;
    await key(t, LogicalKeyboardKey.arrowRight);
    expect(s.playNode.hasFocus, isFalse, reason: 'Right moves to the next button');
    expect(s.root.hasPrimaryFocus, isFalse);
    expect(video.seeks.length, before, reason: 'and does not jump in the video');

    // Moving around keeps the controls; left alone they hide and the focus goes back.
    await t.pump(const Duration(seconds: 9));
    expect(s.controls, isFalse);
    expect(s.root.hasPrimaryFocus, isTrue);

    // Hidden: Left/Right jump 10 seconds.
    video.pos = const Duration(seconds: 15);
    await t.pump(const Duration(milliseconds: 600));
    await key(t, LogicalKeyboardKey.arrowRight);
    expect(video.seeks.last, const Duration(seconds: 25));
    await t.pump(const Duration(seconds: 6));

    // OK pauses (one press, one pause) and plays again.
    final p0 = video.pauses;
    await key(t, LogicalKeyboardKey.select);
    expect(video.pauses, p0 + 1);
    expect(video.playing, isFalse);
    expect(s.controls, isTrue, reason: 'paused: the controls stay');
    await t.pump(const Duration(seconds: 8));
    expect(s.controls, isTrue);
    await key(t, LogicalKeyboardKey.select);
    expect(video.playing, isTrue);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('Skip Intro: OK in the intro jumps past it and keeps playing', (t) async {
    final s = await open(t);
    await t.pump(const Duration(seconds: 6));
    expect(s.controls, isFalse);
    video.pos = const Duration(seconds: 3);
    await t.pump(const Duration(milliseconds: 600));
    expect(find.textContaining('Skip Intro'), findsOneWidget);
    final p0 = video.pauses;
    await key(t, LogicalKeyboardKey.select);
    expect(video.seeks.last, const Duration(seconds: 7));
    expect(video.pauses, p0, reason: 'skipping does not pause');
    expect(video.playing, isTrue);
    await t.pump(const Duration(milliseconds: 600));
    expect(find.textContaining('Skip Intro'), findsNothing);
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('a button that appears later (Audio) does not take the focus from the one beside it', (t) async {
    video.tracksLater = Completer();
    final s = await open(t, more: {
      'subtitles': [
        {'label': 'English', 'url': 'http://localhost/en.vtt'},
      ],
      'next': {'title': 'S1 E2'},
    });
    expect(find.text('Audio'), findsNothing);
    await key(t, LogicalKeyboardKey.arrowDown);
    for (var i = 0; i < 3; i++) {
      await key(t, LogicalKeyboardKey.arrowRight); // forward 10, Subtitles, Next Episode
    }
    Element focused() => FocusManager.instance.primaryFocus!.context! as Element;
    expect(find.descendant(of: find.byWidget(focused().widget), matching: find.text('Next Episode')), findsOneWidget);
    video.tracksLater!.complete();
    await t.pump(const Duration(milliseconds: 100));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Audio'), findsOneWidget);
    expect(s.root.hasPrimaryFocus, isFalse);
    expect(find.descendant(of: find.byWidget(focused().widget), matching: find.text('Next Episode')), findsOneWidget, reason: 'still on Next Episode');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('Subtitles: the panel takes the focus, English shows its captions; Audio switches the track', (t) async {
    HttpOverrides.global = null; // a real (local) server for the captions
    final srv = (await t.runAsync(() => HttpServer.bind(InternetAddress.loopbackIPv4, 0)))!;
    String? auth;
    srv.listen((rq) {
      auth = rq.headers.value('authorization');
      rq.response
        ..headers.contentType = ContentType('text', 'vtt')
        ..write('WEBVTT\n\n00:00:01.000 --> 00:00:09.000\nHello from the captions\n')
        ..close();
    });
    final s = await open(t, more: {
      'subtitles': [
        {'label': 'English', 'lang': 'en', 'url': 'http://127.0.0.1:${srv.port}/en.vtt'},
      ],
      'headers': {'Authorization': 'MediaBrowser Token="x"'},
    });
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.arrowRight);
    await key(t, LogicalKeyboardKey.arrowRight); // Subtitles
    await key(t, LogicalKeyboardKey.select);
    expect(s.panel, 'subs');
    String focusedText() => find
        .descendant(of: find.byWidget(FocusManager.instance.primaryFocus!.context!.widget), matching: find.byType(Text))
        .evaluate()
        .map((e) => (e.widget as Text).data)
        .join(' ');
    expect(focusedText(), 'Off', reason: 'the panel has the focus, on what is chosen (Off)');
    await key(t, LogicalKeyboardKey.arrowDown);
    expect(focusedText(), contains('English'));
    await key(t, LogicalKeyboardKey.select);
    expect(s.panel, isNull);
    expect(s.subtitle, 0);
    for (var i = 0; i < 10 && auth == null; i++) {
      await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      await t.pump();
    }
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await t.pump();
    video.pos = const Duration(seconds: 3);
    await t.pump(const Duration(milliseconds: 600));
    await t.pump(const Duration(milliseconds: 100));
    expect(find.text('Hello from the captions'), findsOneWidget);
    expect(auth, 'MediaBrowser Token="x"', reason: 'the add-on\'s headers go with the captions');

    // Audio: Right to the Audio button (focus is back on play), the panel, Dansk.
    expect(s.playNode.hasPrimaryFocus, isTrue);
    for (var i = 0; i < 3; i++) {
      await key(t, LogicalKeyboardKey.arrowRight); // forward 10, Subtitles, Audio
    }
    await key(t, LogicalKeyboardKey.select);
    expect(s.panel, 'audio');
    expect(focusedText(), 'English', reason: 'on the track playing');
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.select);
    expect(video.selected, 'b');
    // Back closes a panel, not the player.
    await key(t, LogicalKeyboardKey.select); // (focus is on play again: pauses)
    await t.pumpWidget(const SizedBox());
    await t.runAsync(() => srv.close(force: true));
  });

  testWidgets('Up Next: in the last 20 seconds, Play Now has the focus and counts down', (t) async {
    final s = await open(t, more: {
      'next': {'title': 'S1 E2'},
      'autonext': true,
    });
    await t.pump(const Duration(seconds: 6));
    video.pos = const Duration(seconds: 12);
    await t.pump(const Duration(milliseconds: 600));
    await t.pump(const Duration(milliseconds: 100));
    expect(s.countdown, 7);
    expect(find.text('NEXT EPISODE IN 7'), findsOneWidget);
    expect(find.descendant(of: find.byWidget(FocusManager.instance.primaryFocus!.context!.widget), matching: find.text('Play Now')), findsOneWidget);
    await t.pump(const Duration(seconds: 2));
    expect(s.countdown, 5);
    // Back: stays on the credits, no countdown, the player still open.
    await t.binding.handlePopRoute();
    await t.pump(const Duration(milliseconds: 100));
    expect(s.countdown, isNull);
    expect(find.byType(VideoScreen), findsOneWidget);
    await t.pump(const Duration(seconds: 8));
    expect(s.countdown, isNull, reason: 'dismissed: it does not come back');
    await t.pumpWidget(const SizedBox());
  });

  testWidgets('150 subtitles: the panel scrolls, opens on the chosen one, and every row is reachable', (t) async {
    video.tracks = [...video.tracks, const VideoAudioTrack(id: 'c', label: 'Commentary', language: 'en', isSelected: false)];
    final s = await open(t, more: {
      'subtitles': [
        for (var i = 0; i < 150; i++) {'id': 4 + i, 'label': 'Subtitle ${i + 1}', 'lang': 'eng', 'url': 'http://127.0.0.1:9/$i.vtt', if (i == 119) 'default': true},
        {'id': 154, 'label': 'Danish - PGSSUB', 'lang': 'dan'},
      ],
      'audios': [
        {'id': 1, 'label': 'English - AAC', 'lang': 'eng', 'selected': true, 'player': 0},
        {'id': 2, 'label': 'Dansk - AAC', 'lang': 'dan', 'player': 1},
        {'id': 3, 'label': 'Commentary - DTS - 5.1', 'lang': 'eng'},
      ],
    });
    expect(s.subtitle, 119, reason: "the add-on's default");
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.arrowRight);
    await key(t, LogicalKeyboardKey.arrowRight); // Subtitles
    await key(t, LogicalKeyboardKey.select);
    await t.pump(const Duration(milliseconds: 300));
    final screen = t.view.physicalSize.height;
    Rect focusedRect() => t.getRect(find.byWidget(FocusManager.instance.primaryFocus!.context!.widget));
    String focusedText() => find
        .descendant(of: find.byWidget(FocusManager.instance.primaryFocus!.context!.widget), matching: find.byType(Text))
        .evaluate()
        .map((e) => (e.widget as Text).data)
        .join(' ');
    expect(focusedText(), contains('Subtitle 120'));
    expect(focusedRect().top, greaterThanOrEqualTo(0));
    expect(focusedRect().bottom, lessThanOrEqualTo(screen), reason: 'scrolled into view');
    // All the way down to the picture subtitles at the end, each one on screen as it is reached.
    for (var i = 0; i < 31; i++) {
      await key(t, LogicalKeyboardKey.arrowDown);
      await t.pump(const Duration(milliseconds: 300));
      expect(focusedRect().bottom, lessThanOrEqualTo(screen));
    }
    expect(focusedText(), contains('Danish - PGSSUB'));
    expect(focusedText(), contains('PICTURE'));
    // And all the way up to Off.
    for (var i = 0; i < 151; i++) {
      await key(t, LogicalKeyboardKey.arrowUp);
    }
    await t.pump(const Duration(milliseconds: 300));
    expect(focusedText(), contains('Off'));
    expect(focusedRect().top, greaterThanOrEqualTo(0));
    await t.binding.handlePopRoute(); // Back closes the panel
    await t.pump(const Duration(milliseconds: 100));
    expect(s.panel, isNull);

    // Audio: all three of the add-on's tracks; Dansk is in the stream itself, so the player switches.
    await key(t, LogicalKeyboardKey.arrowDown);
    for (var i = 0; i < 3; i++) {
      await key(t, LogicalKeyboardKey.arrowRight);
    }
    await key(t, LogicalKeyboardKey.select);
    expect(s.panel, 'audio');
    expect(find.text('Commentary - DTS - 5.1'), findsOneWidget);
    expect(focusedText(), contains('English - AAC'));
    await key(t, LogicalKeyboardKey.arrowDown);
    await key(t, LogicalKeyboardKey.select);
    expect(video.selected, 'b', reason: "the stream's second track");
    await t.pumpWidget(const SizedBox());
  });
}
