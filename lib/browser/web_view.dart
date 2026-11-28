import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Korie's web page (KorieWebView.kt): the TV's own WebView shown as a real Android view in the
/// Flutter screen (hybrid composition), so it shows on every TV and can take keys directly.
class WebPage extends ChangeNotifier {
  MethodChannel? _ch;
  String _pending = '';
  String url = '', title = '';
  bool canBack = false, canForward = false, loading = false;
  int progress = 0;

  /// Called when a page has finished loading.
  VoidCallback? onFinished;

  /// Called when the page's renderer crashed; [reloaded] is false when it kept crashing and was
  /// left closed.
  void Function(bool reloaded)? onCrashed;

  void _attach(int id) => _attachTo('korie/web/$id');

  /// Opens this page full screen: a plain Android web view laid over Korie, as a browser shows
  /// it (Flutter does not draw it, so nothing of Korie can be on top of it). [resume]: a page
  /// from the background, as it was.
  Future<void> openFull(String url, {String? resume, String hint = ''}) async {
    _attachTo('korie/web/full');
    await const MethodChannel('korie/web').invokeMethod('fullOpen', {'url': url, 'resume': ?resume, 'hint': hint});
  }

  Future<void> closeFull() async => const MethodChannel('korie/web').invokeMethod('fullClose');

  void _attachTo(String name) {
    _ch = MethodChannel(name)..setMethodCallHandler(_event);
    if (_pending.isNotEmpty) {
      _ch!.invokeMethod('load', _pending);
      _pending = '';
    }
  }

  Future<void> _event(MethodCall call) async {
    final a = call.arguments is Map ? call.arguments as Map : const {};
    if (a['url'] is String) url = a['url'] as String;
    if (a['title'] is String && (a['title'] as String).isNotEmpty) title = a['title'] as String;
    if (a['back'] is bool) canBack = a['back'] as bool;
    if (a['forward'] is bool) canForward = a['forward'] as bool;
    switch (call.method) {
      case 'started':
        loading = true;
        progress = 0;
      case 'progress':
        progress = (a['progress'] as num?)?.toInt() ?? progress;
      case 'finished':
        loading = false;
        progress = 100;
        onFinished?.call();
      case 'crashed':
        loading = false;
        onCrashed?.call(a['reloaded'] == true);
    }
    notifyListeners();
  }

  /// The view went away (its page left the screen): the next view takes what is loaded next.
  void _detach(MethodChannel ch) {
    if (_ch != ch) return;
    ch.setMethodCallHandler(null);
    _ch = null;
  }

  Future<void> load(String address) async {
    url = address;
    title = '';
    final c = _ch;
    if (c == null) {
      _pending = address; // the view is being made: it loads this as soon as it is there
    } else {
      await c.invokeMethod('load', address);
    }
    notifyListeners();
  }

  Future<void> back() async => _ch?.invokeMethod('back');
  Future<void> forward() async => _ch?.invokeMethod('forward');
  Future<void> reload() async => _ch?.invokeMethod('reload');
  Future<void> focus() async => _ch?.invokeMethod('focus');

  /// Keeps this page running in the background under [key] when its view goes.
  Future<void> park(String key) async => _ch?.invokeMethod('park', key);
  /// A small JPEG of what the page shows now, for the tab list.
  Future<Uint8List?> picture() async => _ch?.invokeMethod<Uint8List>('picture');
  Future<int> scrollY() async => (await _ch?.invokeMethod<int>('scrollY')) ?? 0;
}

/// The page on screen. [url] is opened when the view is made (or what [WebPage.load] was given
/// before it was there). Made only while the page is to be seen: a view made under something
/// else stays blank on some TVs.
class WebPageView extends StatefulWidget {
  const WebPageView({super.key, required this.page, this.url = '', this.resume});
  final WebPage page;
  final String url;

  /// The key of a page in the background to show again as it is (instead of loading [url]).
  final String? resume;

  @override
  State<WebPageView> createState() => _WebPageViewState();
}

class _WebPageViewState extends State<WebPageView> {
  MethodChannel? _mine;

  WebPage get page => widget.page;

  @override
  void dispose() {
    final m = _mine;
    if (m != null) page._detach(m);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PlatformViewLink(
    viewType: 'korie/web',
    surfaceFactory: (context, controller) => AndroidViewSurface(
      controller: controller as AndroidViewController,
      // Every touch goes to the page (the pointer's taps and drags are touches too).
      gestureRecognizers: {Factory<OneSequenceGestureRecognizer>(() => EagerGestureRecognizer())},
      hitTestBehavior: PlatformViewHitTestBehavior.opaque,
    ),
    onCreatePlatformView: (params) {
      final c = PlatformViewsService.initSurfaceAndroidView(
        id: params.id,
        viewType: 'korie/web',
        layoutDirection: TextDirection.ltr,
        creationParams: {'url': widget.url, 'resume': ?widget.resume},
        creationParamsCodec: const StandardMessageCodec(),
        onFocus: () => params.onFocusChanged(true),
      );
      c.addOnPlatformViewCreatedListener(params.onPlatformViewCreated);
      c.addOnPlatformViewCreatedListener((id) {
        page._attach(id);
        _mine = page._ch;
      });
      c.create();
      return c;
    },
  );
}
