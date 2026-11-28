import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:video_player/video_player.dart';

import '../addons/host.dart';
import '../tv/widgets.dart';
import '../ui/ask.dart';
import '../ui/common.dart';
import 'player.dart';
import 'playlists.dart';

/// Korie's video player, full screen. Without the controls: OK pauses and plays, Left/Right
/// jump 10 seconds, Up/Down show the controls (the buttons: back/forward, play, Subtitles, Audio,
/// Playlist, Next Episode), Back stops. The controls hide after a few seconds; the buttons use
/// the normal focus (arrows and OK).
class VideoScreen extends StatefulWidget {
  const VideoScreen({super.key, required this.request});
  final PlayRequest request;
  @override
  State<VideoScreen> createState() => VideoScreenState();
}

class VideoScreenState extends State<VideoScreen> {
  late PlayRequest req = widget.request;
  VideoPlayerController? ctl;
  String? error;
  bool controls = true;
  String? panel; // 'subs' | 'audio'
  int subtitle = -1; // index in req.subtitles, -1 off
  Object? _audioSel; // the add-on's track chosen here (switched in the stream itself)
  Object? _keepSub; // the text subtitle to show again after the add-on sent another stream
  bool switching = false; // asked the add-on for another track; the new stream is on its way
  List<VideoAudioTrack> tracks = const [];
  Timer? _hide, _tick, _count;
  int? countdown; // Up Next counting down
  bool upNextGone = false; // Back on Up Next: stay on the credits
  bool _ended = false;
  // The whole screen: it has the focus while the controls are hidden, but the arrows never move
  // onto it (its middle would beat the buttons at the far right).
  final root = FocusNode(debugLabel: 'player', skipTraversal: true);
  final playNode = FocusNode(debugLabel: 'player.play');
  final backNode = FocusNode(debugLabel: 'player.back'); // on "could not be played"
  final panelNode = FocusNode(debugLabel: 'player.panel'); // the chosen row of an open panel
  final _panelScroll = ScrollController();
  int _panelOn = 0, _panelRows = 1; // the chosen row, and how many rows the open panel has
  final upNode = FocusNode(debugLabel: 'player.upnext');
  PlayEntry? entry;

  @override
  void initState() {
    super.initState();
    KoriePlayer.instance.video = this;
    _open(req);
  }

  @override
  void dispose() {
    _report('stopped');
    if (KoriePlayer.instance.video == this) KoriePlayer.instance.video = null;
    _hide?.cancel();
    _tick?.cancel();
    _count?.cancel();
    ctl?.dispose();
    root.dispose();
    playNode.dispose();
    upNode.dispose();
    backNode.dispose();
    panelNode.dispose();
    _panelScroll.dispose();
    super.dispose();
  }

  /// The add-on started something else (the next episode): it plays here.
  Future<void> replace(PlayRequest r) async {
    _report('stopped');
    final old = ctl;
    setState(() {
      req = r;
      ctl = null;
      error = null;
      panel = null;
      subtitle = -1;
      tracks = const [];
      _audioSel = null;
      switching = false;
      countdown = null;
      upNextGone = false;
      _ended = false;
      _held = false;
    });
    _count?.cancel();
    await old?.dispose();
    await _open(r);
  }

  Future<void> _open(PlayRequest r) async {
    entry = KoriePlayer.instance.entryFor(r.addon);
    // A Flutter texture. (Korie runs on Skia, not Impeller: see AndroidManifest.xml. Impeller drops
    // the decoder's crop, which on TV chips shows the picture small with green around it.)
    final c = VideoPlayerController.networkUrl(
      Uri.parse(r.url),
      httpHeaders: r.headers,
      formatHint: r.raw['mime'] == 'application/x-mpegURL' ? VideoFormat.hls : null,
    );
    ctl = c;
    try {
      await c.initialize();
    } catch (e) {
      debugPrint('korie: the player could not open ${r.url}: $e');
      // This TV can't play it as it is (a format its decoder lacks): ask the add-on, once, for it
      // converted (the server makes something the TV plays). The new stream replaces this one.
      final id = r.ref is Map ? (r.ref as Map)['id'] : r.url;
      if (mounted && ctl == c && _converting != id && AddonHost.instance.handlersOf('switch').any((a) => a.id == r.addon)) {
        _converting = id;
        setState(() => switching = true);
        final ok = await AddonHost.instance.call(r.addon, 'switch', [
          r.ref,
          {'audio': _audioNow, 'subtitle': _drawn, 'position': r.start, 'convert': true},
        ], const Duration(seconds: 30));
        if (ok == true && (!mounted || ctl != c)) return; // the converted stream is playing instead
        if (mounted) setState(() => switching = false);
      }
      if (mounted && ctl == c) {
        setState(() => error = 'This could not be played.');
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) backNode.requestFocus();
        });
      }
      return;
    }
    if (!mounted || ctl != c) return;
    if (r.start > 0) await c.seekTo(Duration(milliseconds: (r.start * 1000).round()));
    c.addListener(_changed);
    await c.play();
    // Which subtitles show: those drawn into this stream, the text ones chosen before the stream
    // changed, or the add-on's default.
    var def = r.subtitles.indexWhere((s) => s['url'] is! String && s['selected'] == true);
    if (def < 0 && _keepSub != null) def = r.subtitles.indexWhere((s) => s['url'] is String && s['id'] == _keepSub);
    if (def < 0) def = r.subtitles.indexWhere((s) => s['url'] is String && s['default'] == true);
    _keepSub = null;
    if (def >= 0) _setSubtitle(def, quiet: true);
    await _loadTracks(c);
    _tick?.cancel();
    _tick = Timer.periodic(const Duration(seconds: 10), (_) {
      if (!_held && ctl?.value.isCompleted != true) _report('playing');
    });
    _report('playing');
    _showControls();
    if (mounted) setState(() {});
  }

  bool _wasPlaying = false;
  void _changed() {
    final c = ctl;
    if (c == null || !mounted) return;
    final v = c.value;
    // ExoPlayer stops "playing" while it buffers; only a pause from the remote counts as paused.
    if (v.isPlaying != _wasPlaying) {
      _wasPlaying = v.isPlaying;
      if (mounted) setState(() {});
    }
    if (v.isCompleted && !_ended) {
      _ended = true;
      _report('ended');
      if (_hasNext) {
        _goNext();
      } else {
        Navigator.of(context).maybePop();
      }
    }
    // Up Next: from the credits (or the last 20 seconds) when something follows.
    if (_hasNext && !upNextGone && countdown == null && _inCredits) {
      _startUpNext();
    }
    // The player reports many times a second; the screen changes only with these.
    final look = Object.hash(controls ? v.position.inSeconds : -1, _skip == null, v.caption.text, v.isBuffering, v.isInitialized, v.size, v.buffered.length);
    if (look != _look) {
      _look = look;
      setState(() {});
    }
  }

  int? _look;

  /// The video Korie already asked the add-on to convert (so a failing conversion is not asked again).
  Object? _converting;

  double get pos => (ctl?.value.position.inMilliseconds ?? 0) / 1000;
  double get dur => (ctl?.value.duration.inMilliseconds ?? 0) / 1000;

  void _report(String state) {
    if (ctl?.value.isInitialized != true) return;
    KoriePlayer.report(req.addon, req.ref, state, pos, dur);
  }

  // ------------------------------------------------------------------ what comes next

  PlayEntry? get _queued => PlayQueue.instance.following;
  bool get _hasNext => req.next != null || _queued != null;

  String get _nextTitle {
    final q = _queued;
    if (q != null) return q.sub.isEmpty ? q.title : '${q.title} · ${q.sub}';
    final n = req.next;
    return '${n?['title'] ?? 'Next'}';
  }

  String get _nextImage => _queued?.image ?? '${req.next?['image'] ?? ''}';

  bool get _inCredits {
    if (dur <= 0) return false;
    for (final s in req.segments) {
      if (s['type'] == 'credits' && s['start'] is num && pos >= (s['start'] as num)) return true;
    }
    return dur - pos <= 20;
  }

  void _startUpNext() {
    // A series with autonext, and any playlist, count down; else Up Next just waits.
    final counts = req.autonext || _queued != null;
    setState(() => countdown = counts ? 7 : -1);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) upNode.requestFocus();
    });
    if (!counts) return;
    _count?.cancel();
    _count = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || countdown == null) return t.cancel();
      if (countdown! <= 1) {
        t.cancel();
        _goNext();
      } else {
        setState(() => countdown = countdown! - 1);
      }
    });
  }

  Future<void> _goNext() async {
    _count?.cancel();
    setState(() => countdown = null);
    if (PlayQueue.instance.following != null) {
      await PlayQueue.instance.next();
    } else if (req.next != null) {
      await AddonHost.instance.call(req.addon, 'next', [req.ref]);
    } else if (mounted) {
      Navigator.of(context).maybePop();
    }
  }

  // ------------------------------------------------------------------ subtitles and sound

  /// The sound tracks the stream has. They can be known a moment after it starts playing.
  Future<void> _loadTracks(VideoPlayerController c) async {
    for (var i = 0; i < 6 && mounted && ctl == c; i++) {
      try {
        final t = await c.getAudioTracks();
        if (mounted && ctl == c) setState(() => tracks = t);
        if (t.isNotEmpty) return;
      } catch (_) {
        return;
      }
      await Future<void>.delayed(const Duration(milliseconds: 700));
    }
  }

  bool _picture(Map s) => s['url'] is! String;

  /// The picture subtitles drawn into this stream, if any.
  Object? get _drawn {
    for (final s in req.subtitles) {
      if (_picture(s) && s['selected'] == true) return s['id'];
    }
    return null;
  }

  /// The add-on's sound track playing now.
  Object? get _audioNow {
    if (_audioSel != null) return _audioSel;
    for (final a in req.audios) {
      if (a['selected'] == true) return a['id'];
    }
    return req.audios.isEmpty ? null : req.audios.first['id'];
  }

  Future<void> _setSubtitle(int i, {bool quiet = false}) async {
    final c = ctl;
    if (c == null) return;
    final s = i < 0 ? null : req.subtitles[i];
    if (!quiet && s != null && _picture(s)) {
      if (s['selected'] != true) await _switch(audio: _audioNow, subtitle: s['id']);
      return;
    }
    if (!quiet && _drawn != null) {
      // Leaving picture subtitles: the add-on sends the stream without them.
      _keepSub = s?['id'];
      await _switch(audio: _audioNow, subtitle: null);
      return;
    }
    setState(() => subtitle = i);
    if (s == null || _picture(s)) {
      await c.setClosedCaptionFile(null);
      return;
    }
    await c.setClosedCaptionFile(_captionsOrNone(s, c));
  }

  Future<void> _setAudio(Map a) async {
    if (a['id'] == _audioNow) return;
    final at = a['player'];
    // In the stream itself when the player has every one of the add-on's tracks.
    if (at is int && tracks.length == req.audios.length && at >= 0 && at < tracks.length) {
      await ctl?.selectAudioTrack(tracks[at].id);
      if (mounted) setState(() => _audioSel = a['id']);
      return;
    }
    if (subtitle >= 0 && !_picture(req.subtitles[subtitle])) _keepSub = req.subtitles[subtitle]['id'];
    await _switch(audio: a['id'], subtitle: _drawn);
  }

  /// Asks the add-on for the same video with another sound track or picture subtitles, from here.
  Future<void> _switch({Object? audio, Object? subtitle}) async {
    final c = ctl;
    if (c == null) return;
    setState(() => switching = true);
    final r = await AddonHost.instance.call(req.addon, 'switch', [
      req.ref,
      {'audio': audio, 'subtitle': subtitle, 'position': c.value.position.inMilliseconds / 1000},
    ], const Duration(seconds: 30));
    // The add-on answers with a new korie.play (which replaces this stream); otherwise it could not.
    if (mounted && ctl == c && switching) {
      setState(() => switching = false);
      if (r == false || r == null) {
        final o = Overlay.maybeOf(context);
        if (o != null) showToast(o, "That track can't be played here");
      }
    }
  }

  /// The subtitles; when they can't be fetched, none, and the person is told.
  Future<ClosedCaptionFile> _captionsOrNone(Map s, VideoPlayerController c) async {
    try {
      return await _fetchCaptions('${s['url']}', req.headers);
    } catch (e) {
      debugPrint('korie: subtitles not loaded: $e');
      if (mounted && ctl == c) {
        setState(() => subtitle = -1);
        final o = Overlay.maybeOf(context);
        if (o != null) showToast(o, "${s['label'] ?? 'The subtitles'} could not be loaded");
      }
      return WebVTTCaptionFile('WEBVTT');
    }
  }

  static Future<ClosedCaptionFile> _fetchCaptions(String url, Map<String, String> headers) async {
    final client = HttpClient();
    try {
      final rq = await client.getUrl(Uri.parse(url)).timeout(const Duration(seconds: 15));
      headers.forEach(rq.headers.set);
      final rs = await rq.close().timeout(const Duration(seconds: 15));
      if (rs.statusCode != 200) throw HttpException('status ${rs.statusCode}', uri: Uri.parse(url));
      final text = await rs.transform(utf8.decoder).join();
      return text.trimLeft().startsWith('WEBVTT') ? WebVTTCaptionFile(text) : SubRipCaptionFile(text);
    } finally {
      client.close();
    }
  }

  String _trackName(VideoAudioTrack t, int i) {
    final parts = [
      if (t.label != null && t.label!.isNotEmpty) t.label! else if (t.language != null && t.language != 'und') t.language!.toUpperCase() else 'Track ${i + 1}',
      if (t.channelCount != null)
        switch (t.channelCount!) {
          1 => 'Mono',
          2 => 'Stereo',
          6 => '5.1',
          8 => '7.1',
          _ => '${t.channelCount} ch',
        },
    ];
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ the remote

  /// Paused with the remote: the controls stay until it plays again.
  bool _held = false;

  void _showControls({bool focusPlay = false}) {
    setState(() => controls = true);
    _hideLater();
    if (focusPlay) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) playNode.requestFocus();
      });
    }
  }

  void _hideLater() {
    _hide?.cancel();
    // Longer while a button has the focus: the person is choosing.
    _hide = Timer(Duration(seconds: root.hasPrimaryFocus ? 5 : 8), () {
      if (!mounted || panel != null || _held || !controls) return;
      // Still starting or buffering: wait for the picture rather than leave the controls up.
      if (ctl?.value.isInitialized != true) return _hideLater();
      setState(() => controls = false);
      root.requestFocus();
    });
  }

  Future<void> _toggle() async {
    final c = ctl;
    if (c == null) return;
    if (!_held) {
      _held = true;
      await c.pause();
      _report('paused');
    } else {
      _held = false;
      await c.play();
      _report('playing');
    }
    _showControls();
  }

  Future<void> _seek(double by) async {
    final c = ctl;
    if (c == null || !c.value.isInitialized) return;
    final to = (pos + by).clamp(0.0, dur > 0 ? dur - 1 : 0.0);
    await c.seekTo(Duration(milliseconds: (to * 1000).round()));
    _showControls();
  }

  Map? get _skip {
    for (final s in req.segments) {
      final t = s['type'];
      if ((t == 'intro' || t == 'recap') && s['start'] is num && s['end'] is num && pos >= (s['start'] as num) && pos < (s['end'] as num) - 1) return s;
    }
    return null;
  }

  static final _ok = {
    LogicalKeyboardKey.select,
    LogicalKeyboardKey.enter,
    LogicalKeyboardKey.numpadEnter,
    LogicalKeyboardKey.gameButtonA,
    LogicalKeyboardKey.mediaPlayPause,
  };

  /// Keys while nothing on screen has the focus (the controls are hidden).
  KeyEventResult _key(FocusNode n, KeyEvent e) {
    if (!root.hasPrimaryFocus || e is KeyUpEvent) return KeyEventResult.ignored;
    final k = e.logicalKey;
    if (_ok.contains(k) && e is KeyDownEvent) {
      final s = _skip;
      if (s != null) {
        ctl?.seekTo(Duration(milliseconds: ((s['end'] as num) * 1000).round()));
      } else {
        _toggle();
      }
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.arrowLeft || k == LogicalKeyboardKey.mediaRewind) {
      _seek(-10);
      return KeyEventResult.handled;
    }
    if (k == LogicalKeyboardKey.arrowRight || k == LogicalKeyboardKey.mediaFastForward) {
      _seek(10);
      return KeyEventResult.handled;
    }
    if ((k == LogicalKeyboardKey.arrowDown || k == LogicalKeyboardKey.arrowUp) && e is KeyDownEvent) {
      _showControls(focusPlay: true);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  void _back() {
    if (panel != null) {
      setState(() => panel = null);
      _showControls(focusPlay: true);
      return;
    }
    if (countdown != null) {
      // Stay on the credits.
      _count?.cancel();
      setState(() {
        countdown = null;
        upNextGone = true;
      });
      root.requestFocus();
      return;
    }
    PlayQueue.instance.clear(); // stopped by the person: a playlist ends here
    Navigator.of(context).pop();
  }

  /// Something to listen to took over (the next in a playlist is sound): this page goes.
  void close() {
    final route = ModalRoute.of(context);
    if (route == null || !route.isActive) return;
    if (route.isCurrent) {
      Navigator.of(context).pop();
    } else {
      Navigator.of(context).removeRoute(route);
    }
  }

  String _time(double s) {
    final t = s.round();
    final h = t ~/ 3600, m = (t % 3600) ~/ 60, sec = t % 60;
    String two(int v) => v.toString().padLeft(2, '0');
    return h > 0 ? '$h:${two(m)}:${two(sec)}' : '${two(m)}:${two(sec)}';
  }

  // ------------------------------------------------------------------ the screen

  @override
  Widget build(BuildContext context) {
    final c = ctl;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Material(
        color: Colors.black,
        child: LayoutBuilder(
          builder: (context, cons) {
            final g = TvGeo(cons.maxWidth, cons.maxHeight);
            final ready = c != null && c.value.isInitialized;
            return Focus(
              focusNode: root,
              autofocus: true,
              onKeyEvent: _key,
              child: Stack(
                children: [
                  if (ready)
                    Center(
                      child: AspectRatio(
                        aspectRatio: c.value.aspectRatio <= 0 ? 16 / 9 : c.value.aspectRatio,
                        child: ExcludeFocus(child: VideoPlayer(c)),
                      ), // the picture never takes the remote's focus
                    )
                  else if (error == null)
                    const Center(
                      child: SizedBox(width: 44, height: 44, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3)),
                    ),
                  if (ready && subtitle >= 0)
                    Positioned(
                      left: g.dp(80),
                      right: g.dp(80),
                      bottom: controls ? g.dp(190) : g.dp(56),
                      child: ClosedCaption(
                        text: c.value.caption.text,
                        textStyle: TextStyle(
                          fontFamily: 'Inter',
                          fontSize: g.dp(30),
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                          shadows: [
                            Shadow(blurRadius: g.dp(6), color: Colors.black),
                            Shadow(blurRadius: g.dp(2), color: Colors.black),
                          ],
                        ),
                      ),
                    ),
                  if (error != null) _error(g),
                  if (controls && error == null) ..._controls(g, c),
                  if (_skip != null && !controls && countdown == null) _skipButton(g),
                  if (countdown != null) _upNext(g),
                  if (panel != null) _panel(g),
                  if (switching)
                    Positioned(
                      top: g.dp(40),
                      right: g.dp(48),
                      child: Container(
                        padding: EdgeInsets.symmetric(horizontal: g.dp(18), vertical: g.dp(10)),
                        decoration: BoxDecoration(color: const Color(0xEE1C1C22), borderRadius: BorderRadius.circular(g.dp(99))),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: g.dp(16),
                              height: g.dp(16),
                              child: const CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                            ),
                            SizedBox(width: g.dp(10)),
                            Text('Changing track…', style: tx(g.dp(15), w: FontWeight.w600)),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _error(TvGeo g) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(req.title, style: tx(g.dp(26), w: FontWeight.w800)),
        SizedBox(height: g.dp(10)),
        Text(error!, style: tx(g.dp(17), opacity: 0.8)),
        SizedBox(height: g.dp(22)),
        TvPill(g: g, label: 'Back', focusNode: backNode, onTap: () => Navigator.of(context).pop()),
      ],
    ),
  );

  List<Widget> _controls(TvGeo g, VideoPlayerController? c) {
    final playing = c != null && !_held;
    final p = dur > 0 ? (pos / dur).clamp(0.0, 1.0) : 0.0;
    final buffered = c == null || dur <= 0 || c.value.buffered.isEmpty ? p : (c.value.buffered.last.end.inMilliseconds / 1000 / dur).clamp(0.0, 1.0);
    final left = dur - pos;
    final ends = DateTime.now().add(Duration(seconds: left.round()));
    final hasSubs = req.subtitles.isNotEmpty;
    final hasAudio = req.audios.length > 1 || tracks.length > 1;
    final canList = entry != null;
    return [
      // Darker at the top and bottom, where the words are.
      Positioned.fill(
        child: IgnorePointer(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: const [Color(0xA6000000), Color(0x00000000), Color(0x00000000), Color(0xE0000000)],
                stops: const [0, 0.22, 0.5, 1],
              ),
            ),
          ),
        ),
      ),
      Positioned(
        left: g.dp(64),
        top: g.dp(40),
        right: g.dp(200),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              req.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: tx(g.dp(26), w: FontWeight.w800),
            ),
            if (req.subtitle.isNotEmpty || _source.isNotEmpty)
              Text(
                [req.subtitle, _source].where((s) => s.isNotEmpty).join('  ·  '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: tx(g.dp(15), w: FontWeight.w600, opacity: 0.8),
              ),
          ],
        ),
      ),
      Positioned(
        right: g.dp(64),
        top: g.dp(44),
        child: Clock(style: tx(g.dp(20), w: FontWeight.w600)),
      ),
      Positioned(
        left: g.dp(64),
        right: g.dp(64),
        bottom: g.dp(126),
        child: Column(
          children: [
            SizedBox(
              height: g.dp(16),
              child: LayoutBuilder(
                builder: (context, b) => Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.centerLeft,
                  children: [
                    Container(
                      height: g.dp(6),
                      decoration: BoxDecoration(color: const Color(0x40FFFFFF), borderRadius: BorderRadius.circular(g.dp(3))),
                    ),
                    Container(
                      width: b.maxWidth * buffered,
                      height: g.dp(6),
                      decoration: BoxDecoration(color: const Color(0x66FFFFFF), borderRadius: BorderRadius.circular(g.dp(3))),
                    ),
                    Container(
                      width: b.maxWidth * p,
                      height: g.dp(6),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(g.dp(3))),
                    ),
                    Positioned(
                      left: b.maxWidth * p - g.dp(8),
                      child: Container(
                        width: g.dp(16),
                        height: g.dp(16),
                        decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SizedBox(height: g.dp(10)),
            Row(
              children: [
                Text(_time(pos), style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.85)),
                const Spacer(),
                if (dur > 0)
                  Text(
                    '${_time(left)} left · ends ${ends.hour.toString().padLeft(2, '0')}:${ends.minute.toString().padLeft(2, '0')}',
                    style: tx(g.dp(14), w: FontWeight.w600, opacity: 0.85),
                  ),
              ],
            ),
          ],
        ),
      ),
      Positioned(
        left: g.dp(64),
        right: g.dp(64),
        bottom: g.dp(46),
        child: FocusTraversalGroup(
          policy: tvTraversal,
          child: Row(
            children: [
              _round(g, Icons.replay_10_rounded, () => _seek(-10), id: 'back10'),
              SizedBox(width: g.dp(14)),
              _round(g, playing ? Icons.pause_rounded : Icons.play_arrow_rounded, _toggle, size: 60, node: playNode, id: 'play'),
              SizedBox(width: g.dp(14)),
              _round(g, Icons.forward_10_rounded, () => _seek(10), id: 'fwd10'),
              const Spacer(),
              if (hasSubs) ...[_pill(g, Icons.closed_caption_outlined, 'Subtitles', () => _openPanel('subs'), id: 'subs'), SizedBox(width: g.dp(12))],
              if (hasAudio) ...[_pill(g, Icons.volume_up_outlined, 'Audio', () => _openPanel('audio'), id: 'audio'), SizedBox(width: g.dp(12))],
              if (canList) ...[
                _pill(g, Icons.playlist_add_rounded, 'Playlist', () => addToPlaylist(context, entry!), id: 'playlist'),
                SizedBox(width: g.dp(12)),
              ],
              if (_hasNext) _pill(g, Icons.skip_next_rounded, _queued != null ? 'Next' : 'Next Episode', _goNext, id: 'next'),
            ],
          ),
        ),
      ),
      Positioned(
        left: 0,
        right: 0,
        bottom: g.dp(14),
        child: Center(
          child: Text('OK: pause/play  ·  Left/Right: 10 seconds  ·  Down: the buttons  ·  Back: stop', style: tx(g.dp(13), w: FontWeight.w600, opacity: 0.55)),
        ),
      ),
    ];
  }

  String get _source => AddonHost.instance.installed[req.addon]?.manifest.name ?? '';

  void _openPanel(String which) {
    _hide?.cancel();
    setState(() => panel = which);
    // The panel takes the focus, on what is chosen now.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || panel != which || !_panelScroll.hasClients) return;
      // Far down a long list: scroll it into the middle first (rows are built as they come into view).
      final p = _panelScroll.position;
      final extent = p.maxScrollExtent + p.viewportDimension;
      final row = (extent / _panelRows).clamp(1, double.infinity);
      _panelScroll.jumpTo((_panelOn * row - p.viewportDimension / 2 + row / 2).clamp(0, p.maxScrollExtent).toDouble());
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && panel == which) panelNode.requestFocus();
      });
    });
  }

  // Keyed: buttons that appear later (Audio, once the tracks are known) must not take the
  // place, and the focus, of the one beside them.
  Widget _round(TvGeo g, IconData icon, VoidCallback onTap, {double size = 52, FocusNode? node, required String id}) => Focusable(
    key: ValueKey('player.$id'),
    focusNode: node,
    onTap: onTap,
    onFocus: (v) {
      if (v) _showControls();
    },
    builder: (context, f) => AnimatedScale(
      scale: f ? 1.08 : 1,
      duration: const Duration(milliseconds: 120),
      child: Container(
        width: g.dp(size),
        height: g.dp(size),
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: f ? const Color(0xFFF2F2F4) : const Color(0x6B161A24),
          border: Border.all(color: f ? Colors.white : const Color(0x38FFFFFF)),
        ),
        child: Icon(icon, size: g.dp(size * 0.48), color: f ? const Color(0xFF111114) : Colors.white),
      ),
    ),
  );

  Widget _pill(TvGeo g, IconData icon, String label, VoidCallback onTap, {required String id}) => Focusable(
    key: ValueKey('player.$id'),
    onTap: onTap,
    onFocus: (v) {
      if (v) _showControls();
    },
    builder: (context, f) => AnimatedScale(
      scale: f ? 1.05 : 1,
      duration: const Duration(milliseconds: 120),
      child: Container(
        height: g.dp(46),
        padding: EdgeInsets.only(left: g.dp(14), right: g.dp(18)),
        decoration: BoxDecoration(
          color: f ? const Color(0xFFF2F2F4) : const Color(0x6B161A24),
          borderRadius: BorderRadius.circular(g.dp(23)),
          border: Border.all(color: f ? Colors.white : const Color(0x38FFFFFF)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: g.dp(20), color: f ? const Color(0xFF111114) : Colors.white),
            SizedBox(width: g.dp(8)),
            Text(
              label,
              style: tx(g.dp(16), w: FontWeight.w700, color: f ? const Color(0xFF111114) : Colors.white),
            ),
          ],
        ),
      ),
    ),
  );

  Widget _skipButton(TvGeo g) {
    final t = _skip!['type'] == 'recap' ? 'Skip Recap' : 'Skip Intro';
    return Positioned(
      right: g.dp(64),
      bottom: g.dp(64),
      child: Container(
        height: g.dp(50),
        padding: EdgeInsets.symmetric(horizontal: g.dp(24)),
        alignment: Alignment.center,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(g.dp(25))),
        child: Text(
          '$t  ·  OK',
          style: tx(g.dp(17), w: FontWeight.w700, color: const Color(0xFF111114)),
        ),
      ),
    );
  }

  Widget _upNext(TvGeo g) {
    final img = _nextImage;
    return Positioned(
      right: g.dp(64),
      bottom: g.dp(64),
      child: Container(
        width: g.dp(img.isEmpty ? 460 : 560),
        padding: EdgeInsets.all(g.dp(18)),
        decoration: BoxDecoration(
          color: const Color(0xD9161A24),
          borderRadius: BorderRadius.circular(g.dp(24)),
          border: Border.all(color: const Color(0x38FFFFFF)),
        ),
        child: Row(
          children: [
            // The next one's picture, when the add-on gave one.
            if (img.isNotEmpty) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(g.dp(12)),
                child: SizedBox(
                  width: g.dp(190),
                  height: g.dp(107),
                  child: TvImage(img, width: g.dp(190), height: g.dp(107)),
                ),
              ),
              SizedBox(width: g.dp(18)),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    countdown != null && countdown! > 0
                        ? (_queued != null ? 'NEXT IN $countdown' : 'NEXT EPISODE IN $countdown')
                        : (_queued != null ? 'UP NEXT' : 'NEXT EPISODE'),
                    style: tx(g.dp(13), w: FontWeight.w700, opacity: 0.65),
                  ),
                  SizedBox(height: g.dp(6)),
                  Text(
                    _nextTitle,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: tx(g.dp(19), w: FontWeight.w800),
                  ),
                  SizedBox(height: g.dp(12)),
                  Row(
                    children: [
                      TvPill(g: g, label: 'Play Now', icon: Icons.play_arrow_rounded, focusNode: upNode, onTap: _goNext),
                      SizedBox(width: g.dp(10)),
                      TvPill(g: g, label: 'Back', onTap: _back),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _panel(TvGeo g) {
    final subs = panel == 'subs';
    final rows = <({String label, String sub, bool on, VoidCallback tap})>[
      if (subs) ...[
        (label: 'Off', sub: '', on: subtitle < 0, tap: () => _setSubtitle(-1)),
        for (final (i, s) in req.subtitles.indexed)
          (
            label: '${s['label'] ?? s['lang'] ?? 'Subtitles ${i + 1}'}',
            // Picture subtitles are drawn into the video by the server: changing them takes a moment.
            sub: _picture(s) ? 'PICTURE' : '${s['lang'] ?? ''}'.toUpperCase(),
            on: _picture(s) ? s['selected'] == true : subtitle == i,
            tap: () => _setSubtitle(i),
          ),
      ] else if (req.audios.isNotEmpty)
        for (final a in req.audios)
          (label: '${a['label'] ?? a['lang'] ?? 'Track'}', sub: '${a['lang'] ?? ''}'.toUpperCase(), on: a['id'] == _audioNow, tap: () => _setAudio(a))
      else
        for (final (i, t) in tracks.indexed)
          (
            label: _trackName(t, i),
            sub: t.codec ?? '',
            on: t.isSelected,
            tap: () async {
              await ctl?.selectAudioTrack(t.id);
              final v = await ctl?.getAudioTracks();
              if (mounted && v != null) setState(() => tracks = v);
            },
          ),
    ];
    final on = rows.indexWhere((r) => r.on);
    _panelOn = on < 0 ? 0 : on;
    _panelRows = rows.isEmpty ? 1 : rows.length;
    return Positioned(
      right: g.dp(64),
      bottom: g.dp(110),
      top: g.dp(60),
      child: FocusTraversalGroup(
        policy: ReadingOrderTraversalPolicy(), // the normal one: moving the focus scrolls the list to it
        child: Align(
          alignment: Alignment.bottomRight,
          child: Container(
            width: g.dp(420),
            padding: EdgeInsets.all(g.dp(14)),
            decoration: BoxDecoration(
              color: const Color(0xEE1C1C22),
              borderRadius: BorderRadius.circular(g.dp(24)),
              border: Border.all(color: const Color(0x38FFFFFF)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Padding(
                  padding: EdgeInsets.fromLTRB(g.dp(16), g.dp(6), g.dp(16), g.dp(10)),
                  child: Text(subs ? 'Subtitles' : 'Audio', style: tx(g.dp(14), w: FontWeight.w700, opacity: 0.6)),
                ),
                // Films can have hundreds of subtitles: the list scrolls (only the rows in view are
                // built), and the focused row stays in view.
                Flexible(
                  child: ListView.builder(
                    controller: _panelScroll,
                    shrinkWrap: true,
                    itemExtent: g.dp(50),
                    itemCount: rows.length,
                    itemBuilder: (context, i) {
                      final r = rows[i];
                      return Focusable(
                        focusNode: i == _panelOn ? panelNode : null,
                        onTap: () {
                          r.tap();
                          setState(() => panel = null);
                          _showControls(focusPlay: true);
                        },
                        builder: (context, f) => Container(
                          height: g.dp(50),
                          padding: EdgeInsets.symmetric(horizontal: g.dp(16)),
                          decoration: BoxDecoration(color: f ? const Color(0xFFF2F2F4) : Colors.transparent, borderRadius: BorderRadius.circular(g.dp(14))),
                          child: Row(
                            children: [
                              SizedBox(
                                width: g.dp(26),
                                child: r.on ? Icon(Icons.check_rounded, size: g.dp(20), color: f ? const Color(0xFF111114) : Colors.white) : null,
                              ),
                              Expanded(
                                child: Text(
                                  r.label,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: tx(g.dp(17), w: FontWeight.w600, color: f ? const Color(0xFF111114) : Colors.white),
                                ),
                              ),
                              if (r.sub.isNotEmpty)
                                Text(
                                  r.sub,
                                  style: tx(g.dp(13), w: FontWeight.w500, opacity: 0.6, color: f ? const Color(0xFF111114) : Colors.white),
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
