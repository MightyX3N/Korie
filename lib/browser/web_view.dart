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

  void _attach(int id) {
    _ch = MethodChannel('korie/web/$id')..setMethodCallHandler(_event);
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
  /// A small JPEG of what the page shows now, for the tab list.
  Future<Uint8List?> picture() async => _ch?.invokeMethod<Uint8List>('picture');
  Future<int> scrollY() async => (await _ch?.invokeMethod<int>('scrollY')) ?? 0;
}

/// The page on screen. [url] is opened when the view is made.
class WebPageView extends StatelessWidget {
  const WebPageView({super.key, required this.page, this.url = ''});
  final WebPage page;
  final String url;

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
        creationParams: {'url': url},
        creationParamsCodec: const StandardMessageCodec(),
        onFocus: () => params.onFocusChanged(true),
      );
      c.addOnPlatformViewCreatedListener(params.onPlatformViewCreated);
      c.addOnPlatformViewCreatedListener(page._attach);
      c.create();
      return c;
    },
  );
}
